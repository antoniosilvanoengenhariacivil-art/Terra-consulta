import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { FEDERAIS, ESTADUAIS, AVISO } from './sources.js';

// statement_timeout: consulta lenta vira erro visível em vez de travar a tela.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 15000 });
const app = Fastify({ logger: true });
// CORS opcional: defina CORS_ORIGIN (ex.: https://seu-app.workers.dev) quando a página ficar em outro endereço.
if (process.env.CORS_ORIGIN) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN);
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') return reply.code(204).header('Access-Control-Allow-Methods', 'GET,OPTIONS').send();
  });
}
app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  const msg = /statement timeout/i.test(err.message) ? 'A consulta ao banco demorou demais e foi cancelada.'
    : /does not exist/i.test(err.message) ? `Banco incompleto: ${err.message} (PostGIS/tabelas não instalados? rode db/diagnostico_embargos.sql)`
    : err.message;
  reply.code(err.statusCode ?? 500).send({ erro: msg });
});

// A página (web/) é servida por este servidor só se a pasta existir (Docker local).
// No Render, com a página em outro endereço, o servidor roda como API pura.
const webDir = [process.env.WEB_DIR, 'web', '../web'].filter(Boolean).map((p) => path.resolve(p))
  .find((p) => fs.existsSync(path.join(p, 'index.html')));
if (webDir) await app.register(fastifyStatic, { root: webDir, prefix: '/' });
else app.log.info('Pasta web/ não encontrada: rodando apenas como API.');

app.get('/api/aviso', async () => ({ aviso: AVISO }));

// Catálogo de fontes com status real (quantas feições carregadas por camada)
app.get('/api/fontes', async () => {
  const { rows } = await pool.query(
    'SELECT layer_id, count(*)::int AS n, max(uf) AS uf FROM layer_features GROUP BY layer_id'
  );
  const counts = Object.fromEntries(rows.map((r) => [r.layer_id, r.n]));
  const mk = (l) => ({ ...l, feicoes: counts[l.id] ?? 0, status: counts[l.id] ? 'ativo' : 'pendente' });
  return { aviso: AVISO, federais: FEDERAIS.map(mk), estaduais: ESTADUAIS.map(mk) };
});

// Busca por código CAR, nome da propriedade ou município
app.get('/api/busca', async (req, reply) => {
  const q = String(req.query.q ?? '').trim();
  const uf = req.query.uf ? String(req.query.uf).toUpperCase() : null;
  if (q.length < 3) return reply.code(400).send({ erro: 'Digite ao menos 3 caracteres.' });
  const { rows } = await pool.query(
    `SELECT id, layer_id, codigo, nome, municipio, uf,
            ST_AsGeoJSON(ST_Centroid(geom))::json AS centro,
            ST_AsGeoJSON(ST_Envelope(geom))::json AS bbox
       FROM layer_features
      WHERE layer_id IN ('car', 'embargos_termos')
        AND ($2::text IS NULL OR uf = $2)
        AND (codigo ILIKE $1 OR nome ILIKE $1 OR municipio ILIKE $1)
      ORDER BY (layer_id = 'car') DESC, nome
      LIMIT 50`,
    [`%${q}%`, uf]
  );
  return { aviso: AVISO, resultados: rows };
});

// Geometria de uma feição (para destacar no mapa)
app.get('/api/feicao/:id', async (req, reply) => {
  const { rows } = await pool.query(
    `SELECT id, layer_id, codigo, nome, municipio, uf, props,
            ST_AsGeoJSON(geom)::json AS geometry,
            ST_Area(geom::geography)/10000 AS area_ha
       FROM layer_features WHERE id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return reply.code(404).send({ erro: 'Não encontrada' });
  return { aviso: AVISO, feicao: rows[0] };
});

// Identificação: o que existe sob um ponto clicado, em todas as camadas
app.get('/api/identificar', async (req, reply) => {
  const lng = Number(req.query.lng);
  const lat = Number(req.query.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat))
    return reply.code(400).send({ erro: 'lng/lat inválidos' });
  const { rows } = await pool.query(
    `SELECT id, layer_id, codigo, nome, municipio, uf, props
       FROM layer_features
      WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1,$2),4674))
      LIMIT 100`,
    [lng, lat]
  );
  return { aviso: AVISO, resultados: rows };
});

// Sobreposições de uma feição (CAR) com as demais camadas
app.get('/api/feicao/:id/sobreposicoes', async (req) => {
  const { rows } = await pool.query(
    `SELECT o.layer_id, o.codigo, o.nome, o.uf,
            ST_Area(ST_Intersection(a.geom, o.geom)::geography)/10000 AS area_ha
       FROM layer_features a
       JOIN layer_features o ON o.id <> a.id AND ST_Intersects(a.geom, o.geom)
      WHERE a.id = $1
      ORDER BY area_ha DESC
      LIMIT 200`,
    [req.params.id]
  );
  return { aviso: AVISO, sobreposicoes: rows };
});

// Camada por bbox (GeoJSON), para renderizar no MapLibre
app.get('/api/camadas/:layer/geojson', async (req, reply) => {
  const [w, s, e, n] = String(req.query.bbox ?? '').split(',').map(Number);
  if ([w, s, e, n].some((v) => !Number.isFinite(v)))
    return reply.code(400).send({ erro: 'bbox inválido (w,s,e,n)' });
  const { rows } = await pool.query(
    `SELECT jsonb_build_object('type','FeatureCollection','features',
              coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',id,
                'properties', jsonb_build_object('codigo',codigo,'nome',nome,'uf',uf),
                'geometry', ST_AsGeoJSON(ST_Simplify(geom, 0.0001))::jsonb)), '[]'::jsonb)) AS fc
       FROM (SELECT * FROM layer_features
              WHERE layer_id = $1 AND geom && ST_MakeEnvelope($2,$3,$4,$5,4674)
              LIMIT 2000) t`,
    [req.params.layer, w, s, e, n]
  );
  return rows[0].fc;
});

// Diagnóstico: mostra o que de fato está no banco (PostGIS, geometrias, camada, índices)
app.get('/api/diagnostico', async () => {
  const q = async (sql) => (await pool.query(sql)).rows;
  const postgis = (await q(`SELECT extversion FROM pg_extension WHERE extname='postgis'`))[0]?.extversion ?? null;
  const tabelas = (await q(`SELECT to_regclass('embargo_poligonos') IS NOT NULL AS poligonos,
                                   to_regclass('layer_features') IS NOT NULL AS features`))[0];
  const out = { postgis, tabelas };
  if (tabelas.poligonos) {
    out.embargo_poligonos = (await q(`SELECT tipo_geom, count(*)::int AS n,
        count(*) FILTER (WHERE geom IS NOT NULL)::int AS com_geom FROM embargo_poligonos GROUP BY 1`));
  }
  if (tabelas.features) {
    out.layer_features = await q(`SELECT layer_id, count(*)::int AS n FROM layer_features GROUP BY 1 ORDER BY 1`);
    out.indices = (await q(`SELECT indexname FROM pg_indexes WHERE tablename='layer_features' ORDER BY 1`)).map((r) => r.indexname);
  }
  out.camada_registrada = (await q(`SELECT id, atualizado_em FROM layers WHERE id='embargos_termos'`))[0] ?? null;
  return out;
});

app.get('/api/saude', async () => ({ ok: true }));

await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });

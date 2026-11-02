// Ingestão genérica de uma camada a partir de uma URL WFS (GeoJSON) ou arquivo GeoJSON local.
// Uso:  node src/ingest.js <layer_id> <url-ou-arquivo.geojson> [UF] [campoCodigo] [campoNome] [campoMunicipio]
// Para shapefiles (SICAR, INCRA), converta antes com ogr2ogr:
//   ogr2ogr -f GeoJSON -t_srs EPSG:4674 saida.geojson entrada.shp
import fs from 'node:fs/promises';
import pg from 'pg';
import { FEDERAIS, ESTADUAIS } from './sources.js';

const [layerId, origem, uf = null, fCodigo = 'cod_imovel', fNome = 'nome', fMun = 'municipio'] =
  process.argv.slice(2);
if (!layerId || !origem) {
  console.error('Uso: node src/ingest.js <layer_id> <url|arquivo> [UF] [campoCodigo] [campoNome] [campoMunicipio]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const texto = origem.startsWith('http')
  ? await (await fetch(origem)).text()
  : await fs.readFile(origem, 'utf8');
const fc = JSON.parse(texto);

const def = [...FEDERAIS.map((l) => ({ ...l, esfera: 'federal', uf: null })), ...ESTADUAIS].find((l) => l.id === layerId);
if (!def) { console.error(`Camada desconhecida: ${layerId} (veja src/sources.js)`); process.exit(1); }
await pool.query(
  `INSERT INTO layers (id, nome, esfera, uf, fonte, tipo_acesso, url) VALUES ($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT (id) DO NOTHING`,
  [def.id, def.nome, def.esfera, def.uf, def.fonte, def.tipo_acesso, def.url]
);

await pool.query('DELETE FROM layer_features WHERE layer_id = $1 AND ($2::text IS NULL OR uf = $2)', [layerId, uf]);

let n = 0;
for (const f of fc.features ?? []) {
  const p = f.properties ?? {};
  await pool.query(
    `INSERT INTO layer_features (layer_id, uf, codigo, nome, municipio, props, geom)
     VALUES ($1,$2,$3,$4,$5,$6,
       ST_Multi(ST_SetSRID(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON($7)),3),4674)))`,
    [layerId, uf ?? p.uf ?? null, p[fCodigo] ?? null, p[fNome] ?? null, p[fMun] ?? null, p, JSON.stringify(f.geometry)]
  );
  n++;
}
await pool.query('UPDATE layers SET atualizado_em = now() WHERE id = $1', [layerId]);
console.log(`${n} feições carregadas em ${layerId}${uf ? ' / ' + uf : ''}`);
await pool.end();

// Importa termo_de_embargo_coordenadas.json (ou o .zip que o contém) para PostgreSQL/PostGIS.
// Sem dependências npm: precisa apenas de Node 18+, `psql` e `unzip` no PATH.
//
//   DATABASE_URL=postgres://usuario:senha@host:5432/banco node src/import_embargos.js <arquivo.json|.zip> [--force]
//
// Fluxo (tudo em UMA transação; se algo falhar, nada é gravado):
//   valida o arquivo -> limpa coordenadas -> cria tabelas -> carrega pontos (\copy)
//   -> monta polígonos -> se houver PostGIS: cria geometrias e publica a camada 'embargos_termos'.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const force = args.includes('--force');
const entrada = args.find((a) => !a.startsWith('--'));
const url = process.env.DATABASE_URL;
if (!entrada || !url) {
  console.error('Uso: DATABASE_URL=postgres://... node src/import_embargos.js <arquivo.json|.zip> [--force]');
  process.exit(1);
}

const serverDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const psql = (extra, opts = {}) =>
  execFileSync('psql', [url, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra], { cwd: serverDir, encoding: 'utf8', ...opts });

// --- leitura -----------------------------------------------------------------
const tmp = await fs.mkdtemp('/tmp/embargos-');
let arquivo = entrada;
if (entrada.toLowerCase().endsWith('.zip')) {
  execFileSync('unzip', ['-o', '-q', entrada, '-d', tmp]);
  const json = (await fs.readdir(tmp)).find((f) => f.toLowerCase().endsWith('.json'));
  if (!json) throw new Error('Nenhum .json dentro do zip.');
  arquivo = path.join(tmp, json);
}
const bruto = await fs.readFile(arquivo);
const sha256 = crypto.createHash('sha256').update(bruto).digest('hex');
const dados = JSON.parse(bruto.toString('utf8'));
if (!Array.isArray(dados) || !dados.length) throw new Error('JSON vazio ou fora do formato esperado (lista de registros).');
for (const c of ['NUM_TAD', 'LONGITUDE', 'LATITUDE']) {
  if (!(c in dados[0])) throw new Error(`Campo obrigatório ausente: ${c}`);
}

if (!force) {
  const existe = psql(['-At', '-c', `SELECT to_regclass('embargo_import') IS NOT NULL`]).trim() === 't';
  if (existe) {
    const igual = psql(['-At', '-c', `SELECT importado_em FROM embargo_import WHERE sha256='${sha256}' LIMIT 1`]).trim();
    if (igual) {
      console.log(`Arquivo idêntico já importado em ${igual}. Use --force para refazer.`);
      process.exit(0);
    }
  }
}

// --- limpeza de coordenadas --------------------------------------------------
// O arquivo traz vírgula decimal e alguns pontos com sinal trocado, lat/lon invertidos ou 0,0.
// Valores originais ficam guardados; `qualidade` registra o que foi feito.
const num = (s) => (s == null || s === '' ? null : Number(String(s).replace(',', '.')));
const int = (s) => (s == null || s === '' ? null : Number.parseInt(String(s), 10));
const noBrasil = (lo, la) => lo >= -74.5 && lo <= -32 && la >= -34.5 && la <= 5.5;
function corrigir(lon, lat) {
  if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) return [null, null, 'invalido'];
  if (noBrasil(lon, lat)) return [lon, lat, 'ok'];
  if (noBrasil(lon, -lat)) return [lon, -lat, 'lat_sinal_corrigido'];
  if (noBrasil(-lon, lat)) return [-lon, lat, 'lon_sinal_corrigido'];
  if (noBrasil(-lon, -lat)) return [-lon, -lat, 'sinais_corrigidos'];
  if (noBrasil(lat, lon)) return [lat, lon, 'lon_lat_trocados'];
  return [lon, lat, 'invalido'];
}
const csvCell = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
const cols = ['linha','num_tad','seq_tad','seq_poligono','sq_poligono_aiemob','no_area','area_poligono_txt',
  'seq_ponto_poligono','sq_coordenada_aiemob','ordem','lon_orig','lat_orig','lon','lat','qualidade','ultima_atualizacao'];
const saida = [cols.join(',')];
dados.forEach((r, i) => {
  const [lon, lat, qualidade] = corrigir(num(r.LONGITUDE), num(r.LATITUDE));
  saida.push([
    i + 1, r.NUM_TAD, int(r.SEQ_TAD), int(r.SEQ_POLIGONO), int(r.SQ_POLIGONO_AIEMOB),
    r.NO_AREA?.trim() || null, r.AREA_POLIGONO, int(r.SEQ_PONTO_POLIGONO), int(r.SQ_COORDENADA_AIEMOB), int(r.ORDEM),
    r.LONGITUDE, r.LATITUDE, lon, lat, qualidade,
    r.ULTIMA_ATUALIZACAO_RELATORIO ? r.ULTIMA_ATUALIZACAO_RELATORIO + '-03' : null, // horário de Brasília
  ].map(csvCell).join(','));
});
const csv = path.join(tmp, 'pontos.csv');
await fs.writeFile(csv, saida.join('\n') + '\n');

// --- carga -------------------------------------------------------------------
let resumo;
try {
  // \copy não interpola variáveis do psql: o caminho do CSV entra direto no script temporário.
  const script = (await fs.readFile(path.join(serverDir, 'sql/embargos_import.psql'), 'utf8')).replaceAll(":'csv'", `'${csv}'`);
  const scriptTmp = path.join(serverDir, 'sql', `.import-${process.pid}.psql`);
  await fs.writeFile(scriptTmp, script);
  try {
    resumo = psql(['-At', '--single-transaction', '-v', `sha=${sha256}`,
      '-v', `arquivo=${path.basename(arquivo)}`, '-v', `linhas=${dados.length}`, '-f', scriptTmp]);
  } finally { await fs.rm(scriptTmp, { force: true }); }
} catch (e) {
  console.error('Falha na importação (nada foi gravado):\n' + (e.stderr || e.message));
  process.exit(1);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
const r = JSON.parse(resumo.trim().split('\n').pop());
console.log(JSON.stringify({ arquivo: path.basename(arquivo), linhas: dados.length, ...r }, null, 2));
if (!r.postgis) console.warn('\nPostGIS não encontrado: pontos e WKT foram carregados, mas as geometrias NÃO foram criadas.\nRode CREATE EXTENSION postgis; e importe de novo com --force.');

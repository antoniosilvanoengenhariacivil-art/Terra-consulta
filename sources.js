// Registro de fontes de dados. Os endpoints marcados com `url: null` precisam ser
// confirmados no portal oficial antes da ingestão; o sistema mostra o status real
// de cada fonte (nunca finge cobertura que não existe).
export const FEDERAIS = [
  { id: 'car',             nome: 'CAR / SICAR (imóveis)',            fonte: 'SFB / SICAR',   tipo_acesso: 'shapefile', url: null },
  { id: 'ibama_embargos',  nome: 'Embargos IBAMA',                   fonte: 'IBAMA',         tipo_acesso: 'wfs',       url: null },
  { id: 'icmbio_embargos', nome: 'Embargos ICMBio',                  fonte: 'ICMBio',        tipo_acesso: 'wfs',       url: null },
  { id: 'autos_ibama',     nome: 'Autos de infração federais',       fonte: 'IBAMA',         tipo_acesso: 'api',       url: null },
  { id: 'prodes',          nome: 'Desmatamento PRODES',              fonte: 'INPE TerraBrasilis', tipo_acesso: 'wfs',  url: null },
  { id: 'deter',           nome: 'Alertas DETER',                    fonte: 'INPE TerraBrasilis', tipo_acesso: 'wfs',  url: null },
  { id: 'terras_indigenas',nome: 'Terras Indígenas',                 fonte: 'FUNAI',         tipo_acesso: 'wfs',       url: null },
  { id: 'ucs_federais',    nome: 'Unidades de Conservação federais', fonte: 'ICMBio / MMA',  tipo_acesso: 'wfs',       url: null },
  { id: 'assentamentos',   nome: 'Assentamentos rurais',             fonte: 'INCRA',         tipo_acesso: 'shapefile', url: null },
  { id: 'sigef',           nome: 'Imóveis certificados SIGEF',       fonte: 'INCRA',         tipo_acesso: 'shapefile', url: null },
  { id: 'snci',            nome: 'Imóveis certificados SNCI',        fonte: 'INCRA',         tipo_acesso: 'shapefile', url: null },
  // Arquivo recebido do usuário (termo_de_embargo_coordenadas.json); abrangência nacional, origem a confirmar.
  { id: 'embargos_termos', nome: 'Termos de embargo (arquivo importado)', fonte: 'Arquivo do usuário', tipo_acesso: 'arquivo', url: null },
];

// Uma camada de embargos por UF; começa "pendente" até o adaptador ser validado.
export const UFS = [
  ['AC','IMAC'],['AL','IMA/AL'],['AP','IMAP / SEMA-AP'],['AM','IPAAM'],['BA','INEMA'],
  ['CE','SEMACE'],['DF','IBRAM'],['ES','IEMA'],['GO','SEMAD-GO'],['MA','SEMA-MA'],
  ['MT','SEMA-MT'],['MS','IMASUL'],['MG','SEMAD-MG / IEF'],['PA','SEMAS-PA'],['PB','SUDEMA'],
  ['PR','IAT'],['PE','CPRH'],['PI','SEMARH-PI'],['RJ','INEA'],['RN','IDEMA'],
  ['RS','FEPAM / SEMA-RS'],['RO','SEDAM'],['RR','FEMARH'],['SC','IMA-SC'],['SP','SIMA / CETESB'],
  ['SE','ADEMA'],['TO','NATURATINS'],
];

export const ESTADUAIS = UFS.map(([uf, orgao]) => ({
  id: `${uf.toLowerCase()}_embargos`,
  nome: `Embargos estaduais — ${uf}`,
  esfera: 'estadual',
  uf,
  fonte: orgao,
  tipo_acesso: 'manual',
  url: null,
}));

export const AVISO =
  'Consulta meramente indicativa. Este sistema não substitui certidões, laudos ou consultas oficiais ' +
  'emitidos pelos órgãos ambientais e fundiários competentes de cada estado e da União.';

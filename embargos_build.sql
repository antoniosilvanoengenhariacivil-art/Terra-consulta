-- Monta embargo_poligonos a partir de embargo_pontos (vértices na ordem correta,
-- sem vértices consecutivos repetidos, anel fechado). Sem funções PostGIS.
TRUNCATE embargo_poligonos;

INSERT INTO embargo_poligonos
  (chave, num_tad, seq_tad, seq_poligono, sq_poligono_aiemob, no_area, area_poligono_txt,
   tipo_geom, n_vertices, tem_correcao, wkt)
WITH base AS (
  SELECT *,
         CASE WHEN seq_poligono IS NOT NULL THEN 'A:' || seq_poligono
              ELSE 'B:' || sq_poligono_aiemob END AS chave,
         COALESCE(seq_ponto_poligono, ordem, linha) AS ord
    FROM embargo_pontos
   WHERE qualidade <> 'invalido'
     AND (seq_poligono IS NOT NULL OR sq_poligono_aiemob IS NOT NULL)
), seq AS (
  SELECT b.*,
         lag(lon) OVER w AS plon, lag(lat) OVER w AS plat
    FROM base b
  WINDOW w AS (PARTITION BY chave ORDER BY ord, linha)
), uniq AS (
  SELECT * FROM seq WHERE plon IS DISTINCT FROM lon OR plat IS DISTINCT FROM lat
), agg AS (
  SELECT chave,
         max(num_tad) AS num_tad, max(seq_tad) AS seq_tad,
         max(seq_poligono) AS seq_poligono, max(sq_poligono_aiemob) AS sq_poligono_aiemob,
         max(no_area) AS no_area, max(area_poligono_txt) AS area_poligono_txt,
         count(*) AS n,
         bool_or(qualidade <> 'ok') AS tem_correcao,
         string_agg(lon::text || ' ' || lat::text, ',' ORDER BY ord, linha) AS coords,
         (array_agg(lon::text || ' ' || lat::text ORDER BY ord, linha))[1] AS primeiro,
         (array_agg(lon::text || ' ' || lat::text ORDER BY ord DESC, linha DESC))[1] AS ultimo
    FROM uniq GROUP BY chave
)
SELECT chave, num_tad, seq_tad, seq_poligono, sq_poligono_aiemob, no_area, area_poligono_txt,
       CASE WHEN n >= 3 THEN 'poligono' WHEN n = 2 THEN 'linha' ELSE 'ponto' END,
       n, tem_correcao,
       CASE WHEN n >= 3 THEN 'POLYGON((' || coords || CASE WHEN primeiro = ultimo THEN '' ELSE ',' || primeiro END || '))'
            WHEN n = 2 THEN 'LINESTRING(' || coords || ')'
            ELSE 'POINT(' || coords || ')' END
  FROM agg;

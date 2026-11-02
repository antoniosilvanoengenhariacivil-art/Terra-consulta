-- Passo PostGIS: geometrias + publicação dos polígonos válidos na camada consultável.
UPDATE embargo_poligonos
   SET geom = CASE WHEN tipo_geom = 'poligono'
                   THEN ST_MakeValid(ST_GeomFromText(wkt, 4674))
                   ELSE ST_GeomFromText(wkt, 4674) END;

INSERT INTO layers (id, nome, esfera, uf, fonte, tipo_acesso)
VALUES ('embargos_termos', 'Termos de embargo (arquivo importado)', 'federal', NULL,
        'termo_de_embargo_coordenadas.json — origem a confirmar', 'arquivo')
ON CONFLICT (id) DO NOTHING;

DELETE FROM layer_features WHERE layer_id = 'embargos_termos';
INSERT INTO layer_features (layer_id, uf, codigo, nome, municipio, props, geom)
SELECT 'embargos_termos', uf, num_tad, no_area, NULL,
       jsonb_build_object('chave', chave, 'seq_tad', seq_tad, 'area_declarada', area_poligono_txt,
                          'n_vertices', n_vertices, 'tem_correcao', tem_correcao),
       ST_Multi(ST_CollectionExtract(geom, 3))
  FROM embargo_poligonos
 WHERE tipo_geom = 'poligono' AND NOT ST_IsEmpty(ST_CollectionExtract(geom, 3));
UPDATE layers SET atualizado_em = now() WHERE id = 'embargos_termos';

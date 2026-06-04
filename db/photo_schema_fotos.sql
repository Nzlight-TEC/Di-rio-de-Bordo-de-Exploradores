-- =============================================================
-- Photo schema (PostgreSQL)
-- =============================================================
-- Objetivo: armazenar fotos referenciadas por caminho/URL externo,
--            com metadados categoria, título e descrição.
-- Notas:
-- - A imagem em si NÃO é armazenada no banco, apenas a referência (uri).
-- - Escalabilidade: normalização para categorias e textos.
-- - Compatível com uso em produção (constraints + índices).
-- =============================================================

-- Extensões opcionais (p/ UUID). Se preferir, remova e troque para BIGSERIAL.
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------
-- 1) Categorias
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_categories (
  id              BIGSERIAL PRIMARY KEY,
  -- slug ajuda em queries e evita duplicidade lógica
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_photo_categories_slug UNIQUE (slug),
  CONSTRAINT chk_photo_categories_slug_format CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT chk_photo_categories_name_len CHECK (
    length(name) BETWEEN 1 AND 120
  )
);

CREATE INDEX IF NOT EXISTS idx_photo_categories_name ON photo_categories(name);

-- -------------------------------------------------------------
-- 2) Fotos (apenas referência + categoria)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id              BIGSERIAL PRIMARY KEY,
  category_id    BIGINT NOT NULL,

  -- Caminho/URL no storage externo (S3, filesystem, CDN, etc.)
  -- Ex.: 'https://cdn.../foto123.jpg' ou '/uploads/...'
  uri             TEXT NOT NULL,
  rarity          TEXT NOT NULL DEFAULT 'comum',

  -- Metadados técnicos opcionais (útil p/ evoluir sem refazer schema)
  mime_type       TEXT,
  file_size_bytes BIGINT,

  -- Auditoria
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Integridade
  CONSTRAINT fk_photos_category
    FOREIGN KEY (category_id) REFERENCES photo_categories(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  CONSTRAINT uq_photos_uri UNIQUE (uri),
  CONSTRAINT chk_photos_uri_len CHECK (length(uri) BETWEEN 1 AND 2048),
  CONSTRAINT photos_rarity_valid CHECK (rarity IN ('comum', 'rara', 'muito_rara')),
  CONSTRAINT chk_photos_file_size_nonneg CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_photos_category_id ON photos(category_id);
CREATE INDEX IF NOT EXISTS idx_photos_rarity ON photos(rarity);
CREATE INDEX IF NOT EXISTS idx_photos_updated_at ON photos(updated_at);

-- -------------------------------------------------------------
-- 3) Títulos e descrições (separado para atender requisito)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_texts (
  id              BIGSERIAL PRIMARY KEY,
  photo_id        BIGINT NOT NULL,

  title           TEXT NOT NULL,
  description     TEXT NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_photo_texts_photo
    FOREIGN KEY (photo_id) REFERENCES photos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  -- Para garantir 1 conjunto de textos por foto (normalização simples)
  CONSTRAINT uq_photo_texts_photo UNIQUE (photo_id),

  CONSTRAINT chk_photo_texts_title_len CHECK (length(title) BETWEEN 1 AND 160),
  CONSTRAINT chk_photo_texts_description_len CHECK (length(description) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_photo_texts_title ON photo_texts(title);
CREATE INDEX IF NOT EXISTS idx_photo_texts_updated_at ON photo_texts(updated_at);

-- -------------------------------------------------------------
-- Trigger opcional para updated_at (se quiser automatizar)
-- (PostgreSQL exige função + trigger)
-- -------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_photo_categories_updated_at ON photo_categories;
CREATE TRIGGER trg_photo_categories_updated_at
BEFORE UPDATE ON photo_categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_photos_updated_at ON photos;
CREATE TRIGGER trg_photos_updated_at
BEFORE UPDATE ON photos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_photo_texts_updated_at ON photo_texts;
CREATE TRIGGER trg_photo_texts_updated_at
BEFORE UPDATE ON photo_texts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- Exemplos de uso (INSERT)
-- =============================================================

-- 1) Inserir categoria
INSERT INTO photo_categories (slug, name)
VALUES ('flora', 'Flora')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

-- 2) Inserir foto (associando a categoria)
WITH cat AS (
  SELECT id FROM photo_categories WHERE slug = 'flora'
)
INSERT INTO photos (category_id, uri, rarity, mime_type, file_size_bytes)
SELECT cat.id,
       'https://cdn.exemplo.com/fotos/plant-001.jpg',
       'rara',
       'image/jpeg',
       245678
FROM cat
RETURNING id;

-- 3) Inserir textos
-- (assumindo que você sabe o id da foto recém-criada)
-- Ex.: suponha que a foto tenha id = 1
-- INSERT INTO photo_texts (photo_id, title, description)
-- VALUES (1, 'Planta 001', 'Uma descrição curta da planta.');

-- =============================================================
-- Exemplos de queries (SELECT)
-- =============================================================

-- A) Buscar fotos por categoria (slug)
SELECT
  p.id,
  p.uri,
  c.slug AS category_slug,
  p.rarity,
  t.title,
  t.description,
  p.created_at,
  p.updated_at
FROM photos p
JOIN photo_categories c ON c.id = p.category_id
JOIN photo_texts t ON t.photo_id = p.id
WHERE c.slug = 'flora'
ORDER BY p.updated_at DESC;

-- B) Buscar por título (prefixo ou LIKE)
SELECT
  p.id,
  p.uri,
  c.slug AS category_slug,
  p.rarity,
  t.title,
  t.description
FROM photos p
JOIN photo_categories c ON c.id = p.category_id
JOIN photo_texts t ON t.photo_id = p.id
WHERE t.title ILIKE '%plant%'
ORDER BY p.created_at DESC;


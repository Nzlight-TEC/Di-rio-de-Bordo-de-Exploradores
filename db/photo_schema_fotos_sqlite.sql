-- =============================================================
-- Photo schema (SQLite)
-- =============================================================
-- Objetivo: armazenar fotos referenciadas por caminho/URL externo,
--            com metadados categoria, título e descrição.
-- Notas:
-- - SQLite NÃO possui schemas / triggers tão ricos quanto PostgreSQL.
-- - Para auditoria: mantemos updated_at via aplicação ou via trigger simples.
-- - Este script é compatível com SQLite 3.x (inclui constraints e índices).
-- =============================================================

PRAGMA foreign_keys = ON;

-- -------------------------------------------------------------
-- 1) Categorias
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(slug),
  CHECK(length(slug) >= 1),
  CHECK(length(name) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_photo_categories_name ON photo_categories(name);

-- -------------------------------------------------------------
-- 2) Fotos (apenas referência + categoria)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id     INTEGER NOT NULL,
  uri              TEXT NOT NULL,

  mime_type        TEXT,
  file_size_bytes INTEGER,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (category_id) REFERENCES photo_categories(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,

  UNIQUE(uri),
  CHECK(length(uri) BETWEEN 1 AND 2048),
  CHECK(file_size_bytes IS NULL OR file_size_bytes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_photos_category_id ON photos(category_id);
CREATE INDEX IF NOT EXISTS idx_photos_updated_at ON photos(updated_at);

-- -------------------------------------------------------------
-- 3) Títulos e descrições (separado)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_texts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id         INTEGER NOT NULL,

  title            TEXT NOT NULL,
  description      TEXT NOT NULL,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (photo_id) REFERENCES photos(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,

  UNIQUE(photo_id),

  CHECK(length(title) BETWEEN 1 AND 160),
  CHECK(length(description) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_photo_texts_title ON photo_texts(title);
CREATE INDEX IF NOT EXISTS idx_photo_texts_updated_at ON photo_texts(updated_at);

-- -------------------------------------------------------------
-- Triggers simples para updated_at
-- -------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_photo_categories_updated_at
AFTER UPDATE ON photo_categories
FOR EACH ROW
BEGIN
  UPDATE photo_categories
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_photos_updated_at
AFTER UPDATE ON photos
FOR EACH ROW
BEGIN
  UPDATE photos
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_photo_texts_updated_at
AFTER UPDATE ON photo_texts
FOR EACH ROW
BEGIN
  UPDATE photo_texts
  SET updated_at = datetime('now')
  WHERE id = OLD.id;
END;

-- =============================================================
-- Exemplos de uso (INSERT)
-- =============================================================

-- 1) Inserir categoria
INSERT INTO photo_categories (slug, name)
VALUES ('flora', 'Flora')
ON CONFLICT(slug) DO UPDATE SET name = excluded.name;

-- 2) Inserir foto
INSERT INTO photos (category_id, uri, mime_type, file_size_bytes)
SELECT id,
       'https://cdn.exemplo.com/fotos/plant-001.jpg',
       'image/jpeg',
       245678
FROM photo_categories
WHERE slug = 'flora';

-- 3) Inserir textos
-- Para usar a foto recém-criada, normalmente você recupera o last_insert_rowid().
-- Exemplo:
-- INSERT INTO photo_texts (photo_id, title, description)
-- VALUES (last_insert_rowid(), 'Planta 001', 'Uma descrição curta da planta.');

-- =============================================================
-- Exemplos de queries (SELECT)
-- =============================================================

-- A) Buscar fotos por categoria
SELECT
  p.id,
  p.uri,
  c.slug AS category_slug,
  t.title,
  t.description,
  p.created_at,
  p.updated_at
FROM photos p
JOIN photo_categories c ON c.id = p.category_id
JOIN photo_texts t ON t.photo_id = p.id
WHERE c.slug = 'flora'
ORDER BY p.updated_at DESC;

-- B) Buscar por título (contém)
SELECT
  p.id,
  p.uri,
  c.slug AS category_slug,
  t.title,
  t.description
FROM photos p
JOIN photo_categories c ON c.id = p.category_id
JOIN photo_texts t ON t.photo_id = p.id
WHERE t.title LIKE '%plant%'
ORDER BY p.created_at DESC;


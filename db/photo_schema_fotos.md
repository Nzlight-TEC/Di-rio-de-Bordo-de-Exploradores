# Banco de Dados de Fotos (Schema SQL)

## Relacionamentos (diagrama textual)

- `photo_categories (1) ─── (N) photos`
- `photos (1) ─── (1) photo_texts`

Ou seja:
- Cada **foto** pertence a **uma categoria**.
- Cada **foto** possui **um registro de textos** (título + descrição). Os textos são separados para atender o requisito e facilitar evolução futura.

## Tabelas e propósito

### 1) `photo_categories`
Armazena as categorias das fotos.
- `id` (PK)
- `slug` (UNIQUE): identificador estável para evitar duplicidade lógica
- `name`
- `created_at`, `updated_at`

### 2) `photos`
Armazena as fotos como **referências** para um storage externo.
- `id` (PK)
- `category_id` (FK → `photo_categories.id`)
- `uri` (UNIQUE): caminho/URL do arquivo no storage externo
- `rarity`: classificação obrigatória (`comum`, `rara`, `muito_rara`)
- `mime_type` (opcional)
- `file_size_bytes` (opcional)
- `created_at`, `updated_at`

Índices:
- `idx_photos_category_id` (consulta por categoria)
- `idx_photos_rarity` (consulta por raridade)
- `idx_photos_updated_at` (ordenação/recência)

### 3) `photo_texts`
Armazena título e descrição.
- `id` (PK)
- `photo_id` (FK → `photos.id`, UNIQUE): garante 1 registro de textos por foto
- `title`
- `description`
- `created_at`, `updated_at`

Índice:
- `idx_photo_texts_title` (consulta por título)

## Constraints e integridade
- `NOT NULL` em campos essenciais
- `UNIQUE` em `photo_categories.slug` e `photos.uri`
- `CHECK` para tamanhos mínimos/máximos (título/descrição/uri)
- `CHECK` para limitar `rarity` a Comum, Rara e Muito Rara
- `FOREIGN KEY` com políticas adequadas:
  - categoria: `ON DELETE RESTRICT` (evita remover categoria sem gerenciar fotos)
  - textos: `ON DELETE CASCADE` (se a foto for removida, textos removidos junto)

## Arquivos entregues
- `db/photo_schema_fotos.sql` (PostgreSQL)
- `db/photo_schema_fotos_sqlite.sql` (SQLite)
- `db/supabase_rf05_rarity_patch.sql` (migração RF05 para tabelas existentes no Supabase)

Cada arquivo contém:
- `CREATE TABLE` com constraints e índices
- triggers opcionais para `updated_at` (quando aplicável)
- exemplos de `INSERT` e `SELECT`


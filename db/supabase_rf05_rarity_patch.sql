-- Patch RF05: classificacao obrigatoria de raridade.
-- Valores permitidos:
-- - comum      -> Comum
-- - rara       -> Rara
-- - muito_rara -> Muito Rara
--
-- Cole este arquivo no Supabase SQL Editor.
-- Ele atualiza a tabela principal do app (`discoveries`) e tambem a tabela
-- `photos`, caso voce esteja usando o schema de fotos que ja existia.

DO $$
BEGIN
  IF to_regclass('public.discoveries') IS NOT NULL THEN
    ALTER TABLE public.discoveries
      ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'comum';

    UPDATE public.discoveries
    SET rarity = 'comum'
    WHERE rarity IS NULL
       OR rarity NOT IN ('comum', 'rara', 'muito_rara');

    ALTER TABLE public.discoveries
      ALTER COLUMN rarity SET DEFAULT 'comum',
      ALTER COLUMN rarity SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'discoveries_rarity_valid'
        AND conrelid = 'public.discoveries'::regclass
    ) THEN
      ALTER TABLE public.discoveries
        ADD CONSTRAINT discoveries_rarity_valid
        CHECK (rarity IN ('comum', 'rara', 'muito_rara'));
    END IF;

    CREATE INDEX IF NOT EXISTS idx_discoveries_rarity
      ON public.discoveries(rarity);
  END IF;

  IF to_regclass('public.photos') IS NOT NULL THEN
    ALTER TABLE public.photos
      ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'comum';

    UPDATE public.photos
    SET rarity = 'comum'
    WHERE rarity IS NULL
       OR rarity NOT IN ('comum', 'rara', 'muito_rara');

    ALTER TABLE public.photos
      ALTER COLUMN rarity SET DEFAULT 'comum',
      ALTER COLUMN rarity SET NOT NULL;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'photos_rarity_valid'
        AND conrelid = 'public.photos'::regclass
    ) THEN
      ALTER TABLE public.photos
        ADD CONSTRAINT photos_rarity_valid
        CHECK (rarity IN ('comum', 'rara', 'muito_rara'));
    END IF;

    CREATE INDEX IF NOT EXISTS idx_photos_rarity
      ON public.photos(rarity);
  END IF;
END;
$$;

-- Cole este arquivo no Supabase SQL Editor.
-- Ele cria a base central usada pela API em server/.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.devices (
  id TEXT PRIMARY KEY,
  authorized BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT devices_revoked_requires_unauthorized
    CHECK (revoked_at IS NULL OR authorized = FALSE)
);

CREATE TABLE IF NOT EXISTS public.discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES public.devices(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 800),
  category TEXT NOT NULL CHECK (
    category IN (
      'flora',
      'fauna',
      'fungi',
      'mineral',
      'fossil',
      'rock',
      'water',
      'artifact',
      'other'
    )
  ),
  discovered_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, local_id)
);

CREATE TABLE IF NOT EXISTS public.discovery_photos (
  id TEXT PRIMARY KEY,
  discovery_id UUID NOT NULL REFERENCES public.discoveries(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL CHECK (mime_type LIKE 'image/%'),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (char_length(sha256) = 64),
  content_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.discovery_versions (
  id BIGSERIAL PRIMARY KEY,
  discovery_id UUID NOT NULL REFERENCES public.discoveries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content_hash TEXT NOT NULL CHECK (char_length(content_hash) = 64),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discovery_id, version)
);

CREATE TABLE IF NOT EXISTS public.sync_audit (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  accepted_hash TEXT NOT NULL CHECK (char_length(accepted_hash) = 64),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'conflict', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discoveries_device_local
  ON public.discoveries(device_id, local_id);

CREATE INDEX IF NOT EXISTS idx_discoveries_updated_at
  ON public.discoveries(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_photos_discovery
  ON public.discovery_photos(discovery_id);

CREATE INDEX IF NOT EXISTS idx_versions_discovery
  ON public.discovery_versions(discovery_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_sync_audit_created_at
  ON public.sync_audit(created_at DESC);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovery_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_audit ENABLE ROW LEVEL SECURITY;

-- A API deve acessar o banco com a connection string do Supabase.
-- Nao criamos policy publica porque o app movel nao deve gravar direto nas tabelas.

CREATE OR REPLACE FUNCTION public.register_device(device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.devices (id, authorized)
  VALUES (device_id, TRUE)
  ON CONFLICT (id)
  DO UPDATE SET authorized = TRUE, revoked_at = NULL;
END;
$$;

COMMENT ON TABLE public.devices IS 'Dispositivos autorizados a sincronizar dados.';
COMMENT ON TABLE public.discoveries IS 'Registros centrais sincronizados a partir do app offline-first.';
COMMENT ON TABLE public.discovery_photos IS 'Fotos em Base64 com metadados e hash de integridade.';
COMMENT ON TABLE public.discovery_versions IS 'Historico versionado para rollback e conciliacao.';
COMMENT ON TABLE public.sync_audit IS 'Auditoria de tentativas de sincronizacao aceitas ou conflitantes.';

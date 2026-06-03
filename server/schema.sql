CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  authorized BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS discoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 800),
  category TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, local_id)
);

CREATE TABLE IF NOT EXISTS discovery_versions (
  id BIGSERIAL PRIMARY KEY,
  discovery_id UUID NOT NULL REFERENCES discoveries(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discovery_id, version)
);

CREATE TABLE IF NOT EXISTS discovery_photos (
  id TEXT PRIMARY KEY,
  discovery_id UUID NOT NULL REFERENCES discoveries(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_audit (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  local_id TEXT NOT NULL,
  accepted_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discoveries_device_local ON discoveries(device_id, local_id);
CREATE INDEX IF NOT EXISTS idx_versions_discovery ON discovery_versions(discovery_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_sync_audit_created_at ON sync_audit(created_at DESC);

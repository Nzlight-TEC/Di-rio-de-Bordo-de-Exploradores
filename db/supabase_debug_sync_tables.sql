-- Debug sync tables for Supabase/Postgres
-- Objetivo: criar tabelas simples para verificar se o POST `/sync/discoveries` está sendo gravado.
-- Rode no SQL Editor do Supabase.

BEGIN;

-- 1) Descobertas recebidas (debug)
CREATE TABLE IF NOT EXISTS sync_discoveries_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  local_id text NOT NULL,
  title text,
  category text,
  rarity text,
  version integer,
  content_hash text,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, local_id)
);

-- 2) Payload audit (debug)
CREATE TABLE IF NOT EXISTS sync_payload_audit_debug (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  local_id text NOT NULL,
  accepted_hash text,
  payload_hash text,
  status text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_payload_audit_debug_device_local
  ON sync_payload_audit_debug (device_id, local_id);

COMMIT;


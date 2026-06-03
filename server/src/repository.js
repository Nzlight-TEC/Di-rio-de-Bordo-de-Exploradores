import { Pool } from 'pg';

import { httpError } from './security.js';

export function createRepository(connectionString) {
  if (!connectionString) {
    throw new Error('DATABASE_URL nao configurada.');
  }

  const pool = new Pool({
    connectionString,
    max: 10,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined
  });

  return {
    close: () => pool.end(),
    syncDiscovery: (payload, acceptedHash) => syncDiscovery(pool, payload, acceptedHash)
  };
}

async function syncDiscovery(pool, payload, acceptedHash) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureAuthorizedDevice(client, payload.deviceId);

    const existing = await client.query(
      `SELECT id, version, content_hash, updated_at
       FROM discoveries
       WHERE device_id = $1 AND local_id = $2
       FOR UPDATE`,
      [payload.deviceId, payload.localId]
    );

    if (existing.rowCount > 0) {
      const current = existing.rows[0];

      if (current.version > payload.version && current.content_hash !== payload.contentHash) {
        await audit(client, payload, acceptedHash, 'conflict');
        await client.query('COMMIT');
        return {
          remoteId: current.id,
          version: current.version,
          updatedAt: current.updated_at,
          status: 'conflict',
          conflictNote: 'Versao central mais recente que a versao local.',
          acceptedHash
        };
      }

      await client.query(
        `UPDATE discoveries
         SET title = $1,
             description = $2,
             category = $3,
             discovered_at = $4,
             updated_at = $5,
             favorite = $6,
             version = $7,
             content_hash = $8,
             last_synced_at = now()
         WHERE id = $9`,
        [
          payload.title,
          payload.description,
          payload.category,
          payload.discoveredAt,
          payload.updatedAt,
          payload.favorite,
          payload.version,
          payload.contentHash,
          current.id
        ]
      );
      await replacePhotos(client, current.id, payload.photos);
      await saveVersion(client, current.id, payload);
      await audit(client, payload, acceptedHash, 'accepted');
      await client.query('COMMIT');
      return accepted(current.id, payload, acceptedHash);
    }

    const created = await client.query(
      `INSERT INTO discoveries (
        local_id, device_id, title, description, category, discovered_at, updated_at,
        favorite, version, content_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        payload.localId,
        payload.deviceId,
        payload.title,
        payload.description,
        payload.category,
        payload.discoveredAt,
        payload.updatedAt,
        payload.favorite,
        payload.version,
        payload.contentHash
      ]
    );
    const remoteId = created.rows[0].id;
    await replacePhotos(client, remoteId, payload.photos);
    await saveVersion(client, remoteId, payload);
    await audit(client, payload, acceptedHash, 'accepted');
    await client.query('COMMIT');
    return accepted(remoteId, payload, acceptedHash);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function ensureAuthorizedDevice(client, deviceId) {
  const device = await client.query(
    'SELECT authorized, revoked_at FROM devices WHERE id = $1',
    [deviceId]
  );

  if (device.rowCount === 0) {
    if (process.env.ALLOW_DEVICE_AUTO_ENROLLMENT !== 'true') {
      throw httpError(403, 'Dispositivo nao cadastrado.');
    }

    await client.query('INSERT INTO devices (id, authorized) VALUES ($1, TRUE)', [deviceId]);
    return;
  }

  if (!device.rows[0].authorized || device.rows[0].revoked_at) {
    throw httpError(403, 'Dispositivo nao autorizado.');
  }
}

async function replacePhotos(client, discoveryId, photos) {
  await client.query('DELETE FROM discovery_photos WHERE discovery_id = $1', [discoveryId]);

  for (const photo of photos) {
    await client.query(
      `INSERT INTO discovery_photos (
        id, discovery_id, mime_type, byte_size, sha256, content_base64, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        photo.id,
        discoveryId,
        photo.mimeType,
        photo.byteSize,
        photo.sha256,
        photo.base64,
        photo.createdAt
      ]
    );
  }
}

async function saveVersion(client, discoveryId, payload) {
  await client.query(
    `INSERT INTO discovery_versions (discovery_id, version, content_hash, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (discovery_id, version)
     DO UPDATE SET content_hash = EXCLUDED.content_hash, payload = EXCLUDED.payload`,
    [discoveryId, payload.version, payload.contentHash, payload]
  );
}

async function audit(client, payload, acceptedHash, status) {
  await client.query(
    `INSERT INTO sync_audit (device_id, local_id, accepted_hash, status)
     VALUES ($1, $2, $3, $4)`,
    [payload.deviceId, payload.localId, acceptedHash, status]
  );
}

function accepted(remoteId, payload, acceptedHash) {
  return {
    remoteId,
    version: payload.version,
    updatedAt: payload.updatedAt,
    status: 'accepted',
    acceptedHash
  };
}

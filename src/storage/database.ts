import * as SQLite from 'expo-sqlite';

import type {
  DashboardMetrics,
  Discovery,
  DiscoveryCategory,
  DiscoveryFilter,
  DiscoveryInput,
  DiscoveryPhoto,
  NetworkSnapshot,
  StoredPhotoInput,
  SyncOperation,
  SyncStatus
} from '../types';
import { CATEGORIES } from '../constants';
import { buildStoredPhotoInput } from '../services/photoStorage';
import { makeId } from '../utils/id';
import { hashCanonicalJson } from '../services/integrity';

type DiscoveryRow = Omit<Discovery, 'favorite' | 'photos'> & {
  favorite: number;
};

type CountRow = {
  count: number;
};

type CategoryCountRow = {
  category: DiscoveryCategory;
  count: number;
};

type SyncQueueRow = {
  id: number;
  discoveryId: string;
  operation: SyncOperation;
  attempts: number;
  availableAt: string;
};

type NetworkEventRow = {
  online: number;
  type: string | null;
  createdAt: string;
};

export type SyncQueueItem = SyncQueueRow & {
  discovery: Discovery;
};

let database: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) {
    return database;
  }

  database = await SQLite.openDatabaseAsync('explorer_mobile.db');
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS discoveries (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      deviceId TEXT NOT NULL DEFAULT 'unknown',
      contentHash TEXT NOT NULL DEFAULT '',
      discoveredAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      syncStatus TEXT NOT NULL DEFAULT 'pending',
      syncError TEXT,
      remoteId TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      lastSyncedAt TEXT,
      conflictNote TEXT
    );

    CREATE TABLE IF NOT EXISTS discovery_photos (
      id TEXT PRIMARY KEY NOT NULL,
      discoveryId TEXT NOT NULL,
      uri TEXT NOT NULL,
      optimizedUri TEXT,
      mimeType TEXT NOT NULL DEFAULT 'image/jpeg',
      byteSize INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (discoveryId) REFERENCES discoveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discoveryId TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert',
      attempts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      availableAt TEXT NOT NULL,
      lastError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (discoveryId) REFERENCES discoveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discoveryId TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discoveryId TEXT NOT NULL,
      remoteId TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      version INTEGER NOT NULL,
      syncedAt TEXT NOT NULL,
      FOREIGN KEY (discoveryId) REFERENCES discoveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS network_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      online INTEGER NOT NULL,
      type TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_discoveries_sync_status ON discoveries(syncStatus);
    CREATE INDEX IF NOT EXISTS idx_discoveries_category ON discoveries(category);
    CREATE INDEX IF NOT EXISTS idx_discoveries_favorite ON discoveries(favorite);
    CREATE INDEX IF NOT EXISTS idx_photos_discovery ON discovery_photos(discoveryId);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status_available ON sync_queue(status, availableAt);
    CREATE INDEX IF NOT EXISTS idx_network_events_created_at ON network_events(createdAt);
  `);

  await migrateDatabase(database);

  return database;
}

export async function createDiscovery(input: DiscoveryInput): Promise<string> {
  const db = await getDatabase();
  const normalized = validateDiscoveryInput(input);
  const now = new Date().toISOString();
  const id = makeId('disc');
  const deviceId = await getOrCreateDeviceId();
  const photos: StoredPhotoInput[] = [];

  for (const uri of normalized.photoUris) {
    photos.push(await buildStoredPhotoInput(uri));
  }

  const contentHash = await calculateDiscoveryContentHash({
    id,
    title: normalized.title,
    description: normalized.description,
    category: normalized.category,
    favorite: false,
    updatedAt: now,
    version: 1,
    deviceId,
    photos
  });

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO discoveries (
        id, title, description, category, deviceId, contentHash, discoveredAt, createdAt, updatedAt, syncStatus, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
      [
        id,
        normalized.title,
        normalized.description,
        normalized.category,
        deviceId,
        contentHash,
        now,
        now,
        now
      ]
    );

    for (const photo of photos) {
      await addPhotoInsideTransaction(db, id, photo, now);
    }

    await enqueueDiscoveryInsideTransaction(db, id, 'upsert', now);
    await addSyncEventInsideTransaction(db, id, 'Criado localmente e adicionado a fila de sincronizacao.', now);
  });

  return id;
}

export async function listDiscoveries(filter: DiscoveryFilter): Promise<Discovery[]> {
  const db = await getDatabase();
  const params: SQLite.SQLiteBindParams = {};
  const clauses: string[] = [];

  if (filter.search.trim()) {
    params.$search = `%${filter.search.trim()}%`;
    clauses.push('(title LIKE $search OR description LIKE $search OR category LIKE $search)');
  }

  if (filter.favoritesOnly) {
    clauses.push('favorite = 1');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await db.getAllAsync<DiscoveryRow>(
    `SELECT * FROM discoveries ${where} ORDER BY favorite DESC, datetime(updatedAt) DESC`,
    params
  );

  return hydrateDiscoveries(rows);
}

export async function getPendingDiscoveries(): Promise<Discovery[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DiscoveryRow>(
    `SELECT * FROM discoveries
     WHERE syncStatus IN ('pending', 'error', 'syncing')
     ORDER BY datetime(updatedAt) ASC`
  );

  return hydrateDiscoveries(rows);
}

export async function getSyncQueueBatch(limit = 10): Promise<SyncQueueItem[]> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const queueRows = await db.getAllAsync<SyncQueueRow>(
    `SELECT id, discoveryId, operation, attempts, availableAt
     FROM sync_queue
     WHERE status IN ('queued', 'retry')
       AND datetime(availableAt) <= datetime(?)
     ORDER BY datetime(availableAt) ASC, id ASC
     LIMIT ?`,
    [now, limit]
  );
  const items: SyncQueueItem[] = [];

  for (const row of queueRows) {
    const discovery = await getDiscoveryById(row.discoveryId);
    if (discovery) {
      items.push({ ...row, discovery });
    }
  }

  return items;
}

export async function markQueueProcessing(queueId: number): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'processing', updatedAt = ?
     WHERE id = ?`,
    [now, queueId]
  );
}

export async function toggleFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const current = await getDiscoveryById(id);

  if (!current) {
    throw new Error('Registro local nao encontrado.');
  }

  const nextVersion = current.version + 1;
  const contentHash = await calculateDiscoveryContentHash({
    ...current,
    favorite,
    updatedAt: now,
    version: nextVersion,
    photos: current.photos
  });

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries
       SET favorite = ?, updatedAt = ?, syncStatus = 'pending', syncError = NULL, version = ?, contentHash = ?
       WHERE id = ?`,
      [favorite ? 1 : 0, now, nextVersion, contentHash, id]
    );
    await enqueueDiscoveryInsideTransaction(db, id, 'upsert', now);
    await addSyncEventInsideTransaction(db, id, favorite ? 'Marcado como favorito.' : 'Removido dos favoritos.', now);
  });
}

export async function markSyncing(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE discoveries SET syncStatus = 'syncing', syncError = NULL WHERE id = ?`,
    id
  );
}

export async function markSynced(id: string, remoteId: string, version: number): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const discovery = await getDiscoveryById(id);

  if (!discovery) {
    throw new Error('Registro sincronizado nao encontrado localmente.');
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries
       SET syncStatus = 'synced', syncError = NULL, remoteId = ?, version = ?, lastSyncedAt = ?, conflictNote = NULL
       WHERE id = ?`,
      [remoteId, version, now, id]
    );
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'done', updatedAt = ?
       WHERE discoveryId = ? AND status IN ('queued', 'processing', 'retry')`,
      [now, id]
    );
    await db.runAsync(
      `INSERT INTO sync_history (discoveryId, remoteId, contentHash, version, syncedAt)
       VALUES (?, ?, ?, ?, ?)`,
      [id, remoteId, discovery.contentHash, version, now]
    );
    await addSyncEventInsideTransaction(db, id, 'Sincronizado com a nuvem.', now);
  });
}

export async function markConflict(id: string, note: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries
       SET syncStatus = 'conflict', syncError = NULL, conflictNote = ?
       WHERE id = ?`,
      [note, id]
    );
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'conflict', lastError = ?, updatedAt = ?
       WHERE discoveryId = ? AND status IN ('queued', 'processing', 'retry')`,
      [note, now, id]
    );
    await addSyncEventInsideTransaction(db, id, `Conflito detectado: ${note}`, now);
  });
}

export async function markSyncError(id: string, message: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries SET syncStatus = 'error', syncError = ? WHERE id = ?`,
      [message, id]
    );
    await db.runAsync(
      `UPDATE sync_queue
       SET status = 'retry',
           attempts = attempts + 1,
           lastError = ?,
           availableAt = ?,
           updatedAt = ?
       WHERE discoveryId = ? AND status IN ('queued', 'processing', 'retry')`,
      [message, calculateRetryTimestamp(now), now, id]
    );
    await addSyncEventInsideTransaction(db, id, `Falha de sincronizacao: ${message}`, now);
  });
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = await getDatabase();
  const total = await db.getFirstAsync<CountRow>('SELECT COUNT(*) as count FROM discoveries');
  const synced = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) as count FROM discoveries WHERE syncStatus = 'synced'`
  );
  const pending = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) as count FROM discoveries WHERE syncStatus IN ('pending', 'syncing', 'error')`
  );
  const conflicted = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) as count FROM discoveries WHERE syncStatus = 'conflict'`
  );
  const byCategory = await db.getAllAsync<CategoryCountRow>(
    `SELECT category, COUNT(*) as count
     FROM discoveries
     GROUP BY category
     ORDER BY count DESC`
  );

  return {
    total: total?.count ?? 0,
    synced: synced?.count ?? 0,
    pending: pending?.count ?? 0,
    conflicted: conflicted?.count ?? 0,
    byCategory
  };
}

export async function recordNetworkState(online: boolean, type: string | null): Promise<NetworkSnapshot> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const last = await db.getFirstAsync<NetworkEventRow>(
    `SELECT online, type, createdAt
     FROM network_events
     ORDER BY datetime(createdAt) DESC, id DESC
     LIMIT 1`
  );

  if (!last || last.online !== (online ? 1 : 0) || last.type !== type) {
    await db.runAsync(
      'INSERT INTO network_events (online, type, createdAt) VALUES (?, ?, ?)',
      [online ? 1 : 0, type, now]
    );
  }

  return getNetworkSnapshot();
}

export async function getNetworkSnapshot(): Promise<NetworkSnapshot> {
  const db = await getDatabase();
  const last = await db.getFirstAsync<NetworkEventRow>(
    `SELECT online, type, createdAt
     FROM network_events
     ORDER BY datetime(createdAt) DESC, id DESC
     LIMIT 1`
  );
  const lastOnline = await db.getFirstAsync<NetworkEventRow>(
    `SELECT online, type, createdAt
     FROM network_events
     WHERE online = 1
     ORDER BY datetime(createdAt) DESC, id DESC
     LIMIT 1`
  );
  const lastOffline = await db.getFirstAsync<NetworkEventRow>(
    `SELECT online, type, createdAt
     FROM network_events
     WHERE online = 0
     ORDER BY datetime(createdAt) DESC, id DESC
     LIMIT 1`
  );

  return {
    online: last?.online === 1,
    type: last?.type ?? null,
    changedAt: last?.createdAt ?? new Date().toISOString(),
    lastOnlineAt: lastOnline?.createdAt ?? null,
    lastOfflineAt: lastOffline?.createdAt ?? null
  };
}

async function hydrateDiscoveries(rows: DiscoveryRow[]): Promise<Discovery[]> {
  const db = await getDatabase();
  const discoveries: Discovery[] = [];

  for (const row of rows) {
    const photos = await db.getAllAsync<DiscoveryPhoto>(
      'SELECT * FROM discovery_photos WHERE discoveryId = ? ORDER BY datetime(createdAt) ASC',
      row.id
    );
    discoveries.push({
      ...row,
      favorite: row.favorite === 1,
      syncStatus: row.syncStatus as SyncStatus,
      photos
    });
  }

  return discoveries;
}

async function addPhotoInsideTransaction(
  db: SQLite.SQLiteDatabase,
  discoveryId: string,
  photo: StoredPhotoInput,
  createdAt: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO discovery_photos (
      id, discoveryId, uri, optimizedUri, mimeType, byteSize, sha256, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      makeId('photo'),
      discoveryId,
      photo.uri,
      photo.optimizedUri,
      photo.mimeType,
      photo.byteSize,
      photo.sha256,
      createdAt
    ]
  );
}

async function addSyncEventInsideTransaction(
  db: SQLite.SQLiteDatabase,
  discoveryId: string,
  message: string,
  createdAt: string
): Promise<void> {
  await db.runAsync(
    'INSERT INTO sync_events (discoveryId, message, createdAt) VALUES (?, ?, ?)',
    [discoveryId, message, createdAt]
  );
}

async function enqueueDiscoveryInsideTransaction(
  db: SQLite.SQLiteDatabase,
  discoveryId: string,
  operation: SyncOperation,
  now: string
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id
     FROM sync_queue
     WHERE discoveryId = ? AND status IN ('queued', 'processing', 'retry')
     LIMIT 1`,
    discoveryId
  );

  if (existing) {
    await db.runAsync(
      `UPDATE sync_queue
       SET operation = ?, status = 'queued', availableAt = ?, lastError = NULL, updatedAt = ?
       WHERE id = ?`,
      [operation, now, now, existing.id]
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO sync_queue (
      discoveryId, operation, attempts, status, availableAt, createdAt, updatedAt
    ) VALUES (?, ?, 0, 'queued', ?, ?, ?)`,
    [discoveryId, operation, now, now, now]
  );
}

async function getDiscoveryById(id: string): Promise<Discovery | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<DiscoveryRow>(
    'SELECT * FROM discoveries WHERE id = ? LIMIT 1',
    id
  );

  if (!row) {
    return null;
  }

  const [discovery] = await hydrateDiscoveries([row]);
  return discovery ?? null;
}

async function getOrCreateDeviceId(): Promise<string> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_state WHERE key = 'deviceId' LIMIT 1"
  );

  if (existing?.value) {
    return existing.value;
  }

  const now = new Date().toISOString();
  const deviceId = makeId('device');
  await db.runAsync(
    'INSERT INTO device_state (key, value, updatedAt) VALUES (?, ?, ?)',
    ['deviceId', deviceId, now]
  );
  return deviceId;
}

async function calculateDiscoveryContentHash(value: {
  id: string;
  title: string;
  description: string;
  category: DiscoveryCategory;
  favorite: boolean;
  updatedAt: string;
  version: number;
  deviceId: string;
  photos: Array<Pick<DiscoveryPhoto, 'id' | 'sha256' | 'byteSize' | 'mimeType'> | StoredPhotoInput>;
}): Promise<string> {
  return hashCanonicalJson({
    id: value.id,
    title: value.title,
    description: value.description,
    category: value.category,
    favorite: value.favorite,
    updatedAt: value.updatedAt,
    version: value.version,
    deviceId: value.deviceId,
    photos: value.photos.map((photo) => ({
      byteSize: photo.byteSize,
      mimeType: photo.mimeType,
      sha256: photo.sha256
    }))
  });
}

function validateDiscoveryInput(input: DiscoveryInput): {
  title: string;
  description: string;
  category: DiscoveryCategory;
  photoUris: string[];
} {
  const title = input.title.trim();
  const description = input.description.trim();
  const validCategory = CATEGORIES.some((category) => category.value === input.category);

  if (!title || title.length > 80) {
    throw new Error('Titulo deve ter entre 1 e 80 caracteres.');
  }

  if (!description || description.length > 800) {
    throw new Error('Descricao deve ter entre 1 e 800 caracteres.');
  }

  if (!validCategory) {
    throw new Error('Categoria invalida.');
  }

  if (input.photoUris.length > 3) {
    throw new Error('Limite de fotos excedido.');
  }

  return {
    title,
    description,
    category: input.category,
    photoUris: input.photoUris.filter((uri) => uri.trim().length > 0)
  };
}

function calculateRetryTimestamp(fromIso: string): string {
  return new Date(new Date(fromIso).getTime() + 60000).toISOString();
}

async function migrateDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureColumn(db, 'discoveries', 'deviceId', "TEXT NOT NULL DEFAULT 'unknown'");
  await ensureColumn(db, 'discoveries', 'contentHash', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, 'discovery_photos', 'optimizedUri', 'TEXT');
  await ensureColumn(db, 'discovery_photos', 'mimeType', "TEXT NOT NULL DEFAULT 'image/jpeg'");
  await ensureColumn(db, 'discovery_photos', 'byteSize', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn(db, 'discovery_photos', 'sha256', "TEXT NOT NULL DEFAULT ''");
  await backfillPhotoMetadata(db);
  await backfillDiscoveryHashes(db);
}

async function ensureColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  definition: string
): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    await db.runAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function backfillPhotoMetadata(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; uri: string }>(
    `SELECT id, uri
     FROM discovery_photos
     WHERE sha256 = '' OR byteSize = 0 OR optimizedUri IS NULL`
  );

  for (const row of rows) {
    try {
      const metadata = await buildStoredPhotoInput(row.uri);
      await db.runAsync(
        `UPDATE discovery_photos
         SET optimizedUri = ?, mimeType = ?, byteSize = ?, sha256 = ?
         WHERE id = ?`,
        [metadata.optimizedUri, metadata.mimeType, metadata.byteSize, metadata.sha256, row.id]
      );
    } catch {
      await db.runAsync(
        `UPDATE discovery_photos
         SET optimizedUri = COALESCE(optimizedUri, uri)
         WHERE id = ?`,
        row.id
      );
    }
  }
}

async function backfillDiscoveryHashes(db: SQLite.SQLiteDatabase): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  await db.runAsync(
    "UPDATE discoveries SET deviceId = ? WHERE deviceId = 'unknown'",
    deviceId
  );

  const rows = await db.getAllAsync<DiscoveryRow>(
    "SELECT * FROM discoveries WHERE contentHash = ''"
  );

  for (const row of rows) {
    const [discovery] = await hydrateDiscoveries([row]);

    if (discovery) {
      const contentHash = await calculateDiscoveryContentHash(discovery);
      await db.runAsync(
        'UPDATE discoveries SET contentHash = ? WHERE id = ?',
        [contentHash, discovery.id]
      );
    }
  }
}

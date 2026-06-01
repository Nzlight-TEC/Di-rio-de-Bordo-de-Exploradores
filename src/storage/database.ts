import * as SQLite from 'expo-sqlite';

import type {
  DashboardMetrics,
  Discovery,
  DiscoveryCategory,
  DiscoveryFilter,
  DiscoveryInput,
  DiscoveryPhoto,
  SyncStatus
} from '../types';
import { makeId } from '../utils/id';

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
      createdAt TEXT NOT NULL,
      FOREIGN KEY (discoveryId) REFERENCES discoveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discoveryId TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_discoveries_sync_status ON discoveries(syncStatus);
    CREATE INDEX IF NOT EXISTS idx_discoveries_category ON discoveries(category);
    CREATE INDEX IF NOT EXISTS idx_discoveries_favorite ON discoveries(favorite);
    CREATE INDEX IF NOT EXISTS idx_photos_discovery ON discovery_photos(discoveryId);
  `);

  return database;
}

export async function createDiscovery(input: DiscoveryInput): Promise<string> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const id = makeId('disc');

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO discoveries (
        id, title, description, category, discoveredAt, createdAt, updatedAt, syncStatus, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1)`,
      [
        id,
        input.title.trim(),
        input.description.trim(),
        input.category,
        now,
        now,
        now
      ]
    );

    for (const uri of input.photoUris) {
      await addPhotoInsideTransaction(db, id, uri, now);
    }

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

export async function toggleFavorite(id: string, favorite: boolean): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries
       SET favorite = ?, updatedAt = ?, syncStatus = 'pending', syncError = NULL, version = version + 1
       WHERE id = ?`,
      [favorite ? 1 : 0, now, id]
    );
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
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE discoveries
       SET syncStatus = 'synced', syncError = NULL, remoteId = ?, version = ?, lastSyncedAt = ?, conflictNote = NULL
       WHERE id = ?`,
      [remoteId, version, now, id]
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
  uri: string,
  createdAt: string
): Promise<void> {
  await db.runAsync(
    'INSERT INTO discovery_photos (id, discoveryId, uri, createdAt) VALUES (?, ?, ?, ?)',
    [makeId('photo'), discoveryId, uri, createdAt]
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

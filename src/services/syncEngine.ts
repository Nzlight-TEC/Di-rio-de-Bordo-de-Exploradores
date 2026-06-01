import NetInfo from '@react-native-community/netinfo';

import { SYNC_ENDPOINT } from '../constants';
import {
  getPendingDiscoveries,
  markConflict,
  markSynced,
  markSyncError,
  markSyncing
} from '../storage/database';
import type { Discovery, RemoteSyncRecord } from '../types';

export type SyncResult = {
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
  message: string;
};

export async function syncPendingDiscoveries(): Promise<SyncResult> {
  const network = await NetInfo.fetch();
  const online = Boolean(network.isConnected && network.isInternetReachable !== false);

  if (!online) {
    return {
      attempted: 0,
      synced: 0,
      conflicts: 0,
      failed: 0,
      message: 'Sem conexao. Registros continuam na fila local.'
    };
  }

  const pending = await getPendingDiscoveries();
  const result: SyncResult = {
    attempted: pending.length,
    synced: 0,
    conflicts: 0,
    failed: 0,
    message: pending.length ? 'Sincronizacao concluida.' : 'Nada pendente para sincronizar.'
  };

  for (const discovery of pending) {
    try {
      await markSyncing(discovery.id);
      const remote = await sendDiscovery(discovery);
      const conflict = detectConflict(discovery, remote);

      if (conflict) {
        result.conflicts += 1;
        await markConflict(discovery.id, conflict);
      } else {
        result.synced += 1;
        await markSynced(
          discovery.id,
          remote.remoteId ?? discovery.remoteId ?? discovery.id,
          remote.version ?? discovery.version
        );
      }
    } catch (error) {
      result.failed += 1;
      await markSyncError(discovery.id, getErrorMessage(error));
    }
  }

  if (result.failed > 0 || result.conflicts > 0) {
    result.message = 'Sincronizacao finalizada com itens que precisam de revisao.';
  }

  return result;
}

async function sendDiscovery(discovery: Discovery): Promise<RemoteSyncRecord> {
  if (!SYNC_ENDPOINT) {
    await waitForDemoLatency();
    return {
      remoteId: discovery.remoteId ?? `remote_${discovery.id}`,
      version: discovery.version,
      updatedAt: discovery.updatedAt,
      status: 'accepted'
    };
  }

  if (!SYNC_ENDPOINT.startsWith('https://')) {
    throw new Error('Endpoint de sincronizacao precisa usar HTTPS.');
  }

  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      localId: discovery.id,
      remoteId: discovery.remoteId,
      title: discovery.title,
      description: discovery.description,
      category: discovery.category,
      discoveredAt: discovery.discoveredAt,
      updatedAt: discovery.updatedAt,
      favorite: discovery.favorite,
      version: discovery.version,
      photos: discovery.photos.map((photo) => ({
        id: photo.id,
        uri: photo.uri,
        createdAt: photo.createdAt
      }))
    })
  });

  if (!response.ok) {
    throw new Error(`Servidor retornou HTTP ${response.status}.`);
  }

  return (await response.json()) as RemoteSyncRecord;
}

function detectConflict(discovery: Discovery, remote: RemoteSyncRecord): string | null {
  if (remote.status === 'conflict') {
    return remote.conflictNote ?? 'Servidor informou conflito para este registro.';
  }

  if (remote.updatedAt && new Date(remote.updatedAt) > new Date(discovery.updatedAt)) {
    return 'Versao remota mais recente que a copia local.';
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado durante a sincronizacao.';
}

function waitForDemoLatency(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 350);
  });
}

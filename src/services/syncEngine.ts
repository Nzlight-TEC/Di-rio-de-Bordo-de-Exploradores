import NetInfo from '@react-native-community/netinfo';

import { SYNC_AUTH_TOKEN, SYNC_BATCH_SIZE, SYNC_ENDPOINT } from '../constants';
import {
  getSyncQueueBatch,
  markQueueProcessing,
  markConflict,
  markSynced,
  markSyncError,
  markSyncing
} from '../storage/database';
import type { Discovery, RemoteSyncRecord } from '../types';
import { assertPhotoIntegrity } from './photoStorage';
import { calculatePayloadHash, createSecureEnvelope } from './secureEnvelope';

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

  const pending = await getSyncQueueBatch(SYNC_BATCH_SIZE);
  const result: SyncResult = {
    attempted: pending.length,
    synced: 0,
    conflicts: 0,
    failed: 0,
    message: pending.length ? 'Sincronizacao concluida.' : 'Nada pendente para sincronizar.'
  };

  for (const item of pending) {
    const { discovery } = item;
    try {
      await markQueueProcessing(item.id);
      await markSyncing(discovery.id);
      const payload = await buildSyncPayload(discovery);
      const payloadHash = await calculatePayloadHash(payload);
      const remote = await sendDiscovery(payload, payloadHash);
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

async function sendDiscovery(payload: SyncPayload, payloadHash: string): Promise<RemoteSyncRecord> {
  if (!SYNC_ENDPOINT) {
    await waitForDemoLatency();
    return {
      remoteId: payload.remoteId ?? `remote_${payload.localId}`,
      version: payload.version,
      updatedAt: payload.updatedAt,
      status: 'accepted',
      acceptedHash: payloadHash
    };
  }

  if (!SYNC_ENDPOINT.startsWith('https://')) {
    throw new Error('Endpoint de sincronizacao precisa usar HTTPS.');
  }

  if (!SYNC_AUTH_TOKEN) {
    throw new Error('Configure EXPO_PUBLIC_SYNC_AUTH_TOKEN para autenticar a sincronizacao.');
  }

  const envelope = await createSecureEnvelope(payload);
  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SYNC_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Device-Id': payload.deviceId,
      'X-Payload-SHA256': envelope.payloadHash
    },
    body: JSON.stringify(envelope)
  });

  if (!response.ok) {
    throw new Error(`Servidor retornou HTTP ${response.status}.`);
  }

  const remote = (await response.json()) as RemoteSyncRecord;

  if (remote.acceptedHash && remote.acceptedHash !== envelope.payloadHash) {
    throw new Error('Servidor confirmou hash diferente do payload enviado.');
  }

  return remote;
}

type SyncPayload = {
  schemaVersion: 1;
  localId: string;
  remoteId: string | null;
  deviceId: string;
  title: string;
  description: string;
  category: Discovery['category'];
  rarity: Discovery['rarity'];
  discoveredAt: string;
  updatedAt: string;
  favorite: boolean;
  version: number;
  contentHash: string;
  photos: Array<{
    id: string;
    mimeType: string;
    byteSize: number;
    sha256: string;
    createdAt: string;
    base64: string;
  }>;
};

async function buildSyncPayload(discovery: Discovery): Promise<SyncPayload> {
  const photos = [];

  for (const photo of discovery.photos) {
    const base64 = await assertPhotoIntegrity(photo.optimizedUri ?? photo.uri, photo.sha256);
    photos.push({
      id: photo.id,
      mimeType: photo.mimeType,
      byteSize: photo.byteSize,
      sha256: photo.sha256,
      createdAt: photo.createdAt,
      base64
    });
  }

  return {
    schemaVersion: 1,
    localId: discovery.id,
    remoteId: discovery.remoteId,
    deviceId: discovery.deviceId,
    title: discovery.title,
    description: discovery.description,
    category: discovery.category,
    rarity: discovery.rarity,
    discoveredAt: discovery.discoveredAt,
    updatedAt: discovery.updatedAt,
    favorite: discovery.favorite,
    version: discovery.version,
    contentHash: discovery.contentHash,
    photos
  };
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

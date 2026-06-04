export type DiscoveryCategory =
  | 'flora'
  | 'fauna'
  | 'fungi'
  | 'mineral'
  | 'fossil'
  | 'rock'
  | 'water'
  | 'artifact'
  | 'other';

export type DiscoveryRarity = 'comum' | 'rara' | 'muito_rara';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

export type SyncOperation = 'upsert' | 'delete';

export type DiscoveryPhoto = {
  id: string;
  discoveryId: string;
  uri: string;
  optimizedUri: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
};

export type Discovery = {
  id: string;
  title: string;
  description: string;
  category: DiscoveryCategory;
  rarity: DiscoveryRarity;
  discoveredAt: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  remoteId: string | null;
  version: number;
  lastSyncedAt: string | null;
  conflictNote: string | null;
  deviceId: string;
  contentHash: string;
  photos: DiscoveryPhoto[];
};

export type DiscoveryInput = {
  title: string;
  description: string;
  category: DiscoveryCategory;
  rarity: DiscoveryRarity;
  photoUris: string[];
};

export type DashboardMetrics = {
  total: number;
  synced: number;
  pending: number;
  conflicted: number;
  byCategory: Array<{ category: DiscoveryCategory; count: number }>;
};

export type DiscoveryFilter = {
  search: string;
  favoritesOnly: boolean;
};

export type RemoteSyncRecord = {
  remoteId?: string;
  version?: number;
  updatedAt?: string;
  status?: 'accepted' | 'conflict';
  conflictNote?: string;
  acceptedHash?: string;
};

export type StoredPhotoInput = {
  uri: string;
  optimizedUri: string | null;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type NetworkSnapshot = {
  online: boolean;
  type: string | null;
  changedAt: string;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
};

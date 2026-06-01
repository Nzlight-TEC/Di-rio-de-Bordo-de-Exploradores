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

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

export type DiscoveryPhoto = {
  id: string;
  discoveryId: string;
  uri: string;
  createdAt: string;
};

export type Discovery = {
  id: string;
  title: string;
  description: string;
  category: DiscoveryCategory;
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
  photos: DiscoveryPhoto[];
};

export type DiscoveryInput = {
  title: string;
  description: string;
  category: DiscoveryCategory;
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
};

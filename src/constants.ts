import type { DiscoveryCategory, DiscoveryRarity } from './types';

export const CATEGORIES: Array<{ value: DiscoveryCategory; label: string }> = [
  { value: 'flora', label: 'Flora' },
  { value: 'fauna', label: 'Fauna' },
  { value: 'fungi', label: 'Fungi' },
  { value: 'mineral', label: 'Mineral' },
  { value: 'fossil', label: 'Fossil' },
  { value: 'rock', label: 'Rocha' },
  { value: 'water', label: 'Agua' },
  { value: 'artifact', label: 'Artefato' },
  { value: 'other', label: 'Outro' }
];

export const RARITIES: Array<{ value: DiscoveryRarity; label: string }> = [
  { value: 'comum', label: 'Comum' },
  { value: 'rara', label: 'Rara' },
  { value: 'muito_rara', label: 'Muito Rara' }
];

export const MAX_PHOTOS_PER_DISCOVERY = 3;

export const SYNC_ENDPOINT =
  process.env.EXPO_PUBLIC_SYNC_ENDPOINT?.trim() ?? '';

export const SYNC_AUTH_TOKEN =
  process.env.EXPO_PUBLIC_SYNC_AUTH_TOKEN?.trim() ?? '';

export const SYNC_ENCRYPTION_KEY =
  process.env.EXPO_PUBLIC_SYNC_ENCRYPTION_KEY?.trim() ?? '';

export const SYNC_KEY_ID =
  process.env.EXPO_PUBLIC_SYNC_KEY_ID?.trim() || 'mobile-default';

export const SYNC_BATCH_SIZE = 10;

export const CONNECTIVITY_CHECK_INTERVAL_MS = 30000;

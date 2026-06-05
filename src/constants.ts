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

// Expo: expor variáveis apenas via EXPO_PUBLIC_*
const env = (typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>));

export const SYNC_ENDPOINT =
  env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? env.SUPABASE_URL?.trim() ?? '';

export const SYNC_AUTH_TOKEN =
  env.EXPO_PUBLIC_SUPABASE_KEY?.trim() ?? env.SUPABASE_KEY?.trim() ?? '';

export const SYNC_ENCRYPTION_KEY =
  env.EXPO_PUBLIC_SUPABASE_ENCRYPTION_KEY?.trim() ??
  env.SUPABASE_ENCRYPTION_KEY?.trim() ??
  '';

export const SYNC_KEY_ID =
  env.EXPO_PUBLIC_SUPABASE_KEY_ID?.trim() ||
  env.SUPABASE_KEY_ID?.trim() ||
  'mobile-default';



export const SYNC_BATCH_SIZE = 10;

export const CONNECTIVITY_CHECK_INTERVAL_MS = 30000;

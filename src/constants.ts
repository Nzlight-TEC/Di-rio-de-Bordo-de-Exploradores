import type { DiscoveryCategory } from './types';

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

export const MAX_PHOTOS_PER_DISCOVERY = 3;

export const SYNC_ENDPOINT =
  process.env.EXPO_PUBLIC_SYNC_ENDPOINT?.trim() ?? '';

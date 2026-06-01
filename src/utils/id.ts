import * as Crypto from 'expo-crypto';

export function makeId(prefix: string): string {
  if (typeof Crypto.randomUUID === 'function') {
    return `${prefix}_${Crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

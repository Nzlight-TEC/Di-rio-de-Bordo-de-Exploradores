import * as Crypto from 'expo-crypto';

export async function sha256String(value: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
}

export async function hashCanonicalJson(value: unknown): Promise<string> {
  return sha256String(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((sorted, key) => {
        sorted[key] = sortValue(record[key]);
        return sorted;
      }, {});
  }

  return value;
}

import { SYNC_ENCRYPTION_KEY, SYNC_KEY_ID } from '../constants';
import { canonicalJson, sha256String } from './integrity';

export type SecureEnvelope = {
  alg: 'AES-256-GCM';
  kid: string;
  iv: string;
  ciphertext: string;
  payloadHash: string;
  sentAt: string;
};

export async function createSecureEnvelope(payload: unknown): Promise<SecureEnvelope> {
  if (!SYNC_ENCRYPTION_KEY || SYNC_ENCRYPTION_KEY.length < 32) {
    throw new Error('Configure EXPO_PUBLIC_SYNC_ENCRYPTION_KEY com ao menos 32 caracteres.');
  }

  const plaintext = canonicalJson(payload);
  const payloadHash = await sha256String(plaintext);
  const key = await importAesKey(SYNC_ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await getSubtleCrypto().encrypt({ name: 'AES-GCM', iv }, key, encoded);

  return {
    alg: 'AES-256-GCM',
    kid: SYNC_KEY_ID,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    payloadHash,
    sentAt: new Date().toISOString()
  };
}

export async function calculatePayloadHash(payload: unknown): Promise<string> {
  return sha256String(canonicalJson(payload));
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const material = new TextEncoder().encode(secret);
  const keyBytes = await getSubtleCrypto().digest('SHA-256', material);
  return getSubtleCrypto().importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
}

function randomBytes(length: number): Uint8Array {
  const cryptoApi = getCrypto();
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Criptografia nativa indisponivel neste ambiente.');
  }

  return globalThis.crypto;
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto SubtleCrypto indisponivel neste ambiente.');
  }

  return globalThis.crypto.subtle;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

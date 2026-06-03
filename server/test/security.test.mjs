import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { canonicalJson, decryptEnvelope, sha256Hex, validatePayload } from '../src/security.js';

const secret = '0123456789abcdef0123456789abcdef';

test('canonicalJson keeps hashes stable regardless of object key order', () => {
  const left = canonicalJson({ b: 2, a: { d: 4, c: 3 } });
  const right = canonicalJson({ a: { c: 3, d: 4 }, b: 2 });

  assert.equal(left, right);
  assert.equal(sha256Hex(left), sha256Hex(right));
});

test('decryptEnvelope returns payload and validates payload hash', () => {
  const payload = validPayload();
  const envelope = encryptForTest(payload, secret);
  const decrypted = decryptEnvelope(envelope, secret);

  assert.deepEqual(decrypted, payload);
});

test('validatePayload rejects corrupted photo content', () => {
  const payload = validPayload();
  payload.photos[0].base64 = 'corrupted';

  assert.throws(() => validatePayload(payload), /Hash da foto/);
});

function validPayload() {
  const base64 = Buffer.from('photo-bytes').toString('base64');

  return {
    schemaVersion: 1,
    localId: 'disc_1',
    remoteId: null,
    deviceId: 'device_1',
    title: 'Amostra',
    description: 'Descricao de campo',
    category: 'flora',
    discoveredAt: '2026-06-03T12:00:00.000Z',
    updatedAt: '2026-06-03T12:00:00.000Z',
    favorite: false,
    version: 1,
    contentHash: 'abc123',
    photos: [
      {
        id: 'photo_1',
        mimeType: 'image/jpeg',
        byteSize: 10,
        sha256: sha256Hex(base64),
        createdAt: '2026-06-03T12:00:00.000Z',
        base64
      }
    ]
  };
}

function encryptForTest(payload, encryptionSecret) {
  const plaintext = canonicalJson(payload);
  const key = createHash('sha256').update(encryptionSecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);

  return {
    alg: 'AES-256-GCM',
    kid: 'test',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    payloadHash: sha256Hex(plaintext),
    sentAt: '2026-06-03T12:00:00.000Z'
  };
}

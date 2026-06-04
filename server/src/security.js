import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function decryptEnvelope(envelope, secret) {
  assertEnvelope(envelope);

  if (!secret || secret.length < 32) {
    throw httpError(500, 'SYNC_ENCRYPTION_KEY precisa ter ao menos 32 caracteres.');
  }

  const key = createHash('sha256').update(secret).digest();
  const iv = Buffer.from(envelope.iv, 'base64');
  const encrypted = Buffer.from(envelope.ciphertext, 'base64');
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const actualHash = sha256Hex(plaintext);

  if (!safeEquals(actualHash, envelope.payloadHash)) {
    throw httpError(400, 'Hash do payload nao confere.');
  }

  return JSON.parse(plaintext);
}

export function requireBearerToken(request, expectedToken) {
  if (!expectedToken) {
    throw httpError(500, 'SYNC_AUTH_TOKEN nao configurado no servidor.');
  }

  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!safeEquals(token, expectedToken)) {
    throw httpError(401, 'Token invalido.');
  }
}

export function validatePayload(payload) {
  const requiredStrings = [
    'localId',
    'deviceId',
    'title',
    'description',
    'category',
    'rarity',
    'discoveredAt',
    'updatedAt',
    'contentHash'
  ];

  for (const field of requiredStrings) {
    if (typeof payload[field] !== 'string' || payload[field].trim().length === 0) {
      throw httpError(400, `Campo obrigatorio invalido: ${field}.`);
    }
  }

  if (payload.title.length > 80 || payload.description.length > 800) {
    throw httpError(400, 'Titulo ou descricao excedem o limite.');
  }

  if (!['comum', 'rara', 'muito_rara'].includes(payload.rarity)) {
    throw httpError(400, 'Raridade invalida.');
  }

  if (!Number.isInteger(payload.version) || payload.version < 1) {
    throw httpError(400, 'Versao invalida.');
  }

  if (!Array.isArray(payload.photos)) {
    throw httpError(400, 'Fotos devem ser uma lista.');
  }

  for (const photo of payload.photos) {
    if (typeof photo.sha256 !== 'string' || typeof photo.base64 !== 'string') {
      throw httpError(400, 'Foto sem hash ou conteudo.');
    }

    if (sha256Hex(photo.base64) !== photo.sha256) {
      throw httpError(400, `Hash da foto ${photo.id ?? ''} nao confere.`);
    }
  }
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertEnvelope(envelope) {
  if (
    !envelope ||
    envelope.alg !== 'AES-256-GCM' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string' ||
    typeof envelope.payloadHash !== 'string'
  ) {
    throw httpError(400, 'Envelope criptografico invalido.');
  }
}

function safeEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  return left.length === right.length && timingSafeEqual(left, right);
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortValue(value[key]);
        return sorted;
      }, {});
  }

  return value;
}

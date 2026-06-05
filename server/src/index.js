import { createServer } from 'node:http';

import 'dotenv/config';


import { createRepository } from './repository.js';
import { decryptEnvelope, requireBearerToken, validatePayload } from './security.js';

const PORT = Number(process.env.PORT || 3001);
const connectionString = (process.env.DATABASE_URL || process.env.SUPABASE_URL || '').trim();
const repository = createRepository(connectionString);

function assertServerEnv() {
  const required = [
    { key: 'SYNC_AUTH_TOKEN', value: process.env.SYNC_AUTH_TOKEN || process.env.SUPABASE_KEY },
    { key: 'SYNC_ENCRYPTION_KEY', value: process.env.SYNC_ENCRYPTION_KEY || process.env.SUPABASE_ENCRYPTION_KEY }
  ];

  for (const item of required) {
    if (!item.value || String(item.value).trim().length < 1) {
      console.warn(`[sync-server] Aviso: ${item.key} nao esta configurado no ambiente.`);
    }
  }

  if (!connectionString) {
    console.warn('[sync-server] Aviso: DATABASE_URL/SUPABASE_URL nao configurado.');
  }
}

assertServerEnv();


const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method !== 'POST' || request.url !== '/sync/discoveries') {
      sendJson(response, 404, { error: 'Rota nao encontrada.' });
      return;
    }

    requireBearerToken(request, process.env);

    const envelope = JSON.parse(await readBody(request));
    const payload = decryptEnvelope(envelope, process.env);
    validatePayload(payload);

    const result = await repository.syncDiscovery(payload, envelope.payloadHash);
    sendJson(response, 200, result);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    sendJson(response, statusCode, {
      error: statusCode >= 500 ? 'Erro interno.' : error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Explorer sync server listening on port ${PORT}`);
});

process.on('SIGTERM', async () => {
  await repository.close();
  server.close(() => {
    process.exit(0);
  });
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;

      if (body.length > 25 * 1024 * 1024) {
        request.destroy();
        reject(new Error('Payload excede limite de 25MB.'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

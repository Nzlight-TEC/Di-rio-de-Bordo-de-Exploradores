import { createServer } from 'node:http';

import { createRepository } from './repository.js';
import { decryptEnvelope, requireBearerToken, validatePayload } from './security.js';

const PORT = Number(process.env.PORT ?? 8080);
const repository = createRepository(process.env.DATABASE_URL);

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

    requireBearerToken(request, process.env.SYNC_AUTH_TOKEN);

    const envelope = JSON.parse(await readBody(request));
    const payload = decryptEnvelope(envelope, process.env.SYNC_ENCRYPTION_KEY);
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

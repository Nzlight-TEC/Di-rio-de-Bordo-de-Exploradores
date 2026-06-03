# Sincronizacao segura de fotos

## Fluxo

1. O app salva fotos em armazenamento local, calcula SHA-256 do conteudo Base64 e grava metadados no SQLite.
2. Cada criacao ou edicao entra em `sync_queue`.
3. `networkMonitor` registra transicoes online/offline em `network_events`.
4. Ao reconectar, `syncEngine` busca a fila, valida o hash local das fotos, monta o payload e cria um envelope AES-256-GCM.
5. A API central exige HTTPS, `Authorization: Bearer`, descriptografa o envelope, valida hashes e grava em PostgreSQL com SQL parametrizado.
6. Se a nuvem tiver versao mais recente com hash diferente, a resposta volta como `conflict`; caso contrario, o app marca como `synced` e grava `sync_history`.

## Variaveis do app Expo

```bash
EXPO_PUBLIC_SYNC_ENDPOINT=https://seu-dominio.com/sync/discoveries
EXPO_PUBLIC_SYNC_AUTH_TOKEN=token-longo-e-rotacionavel
EXPO_PUBLIC_SYNC_ENCRYPTION_KEY=chave-com-ao-menos-32-caracteres
EXPO_PUBLIC_SYNC_KEY_ID=mobile-2026-06
```

Sem `EXPO_PUBLIC_SYNC_ENDPOINT`, o app usa modo demo local e nao envia dados.

## Variaveis do servidor

```bash
DATABASE_URL=postgres://usuario:senha@host:5432/explorer
SYNC_AUTH_TOKEN=token-longo-e-rotacionavel
SYNC_ENCRYPTION_KEY=chave-com-ao-menos-32-caracteres
PORT=8080
ALLOW_DEVICE_AUTO_ENROLLMENT=false
```

Execute `server/schema.sql` no PostgreSQL antes de iniciar:

```bash
cd server
npm install
npm test
npm start
```

## Conflitos e rollback

O servidor preserva cada versao aceita em `discovery_versions`. Para rollback, recupere o JSON da versao desejada e reaplique como uma nova versao superior. O app registra eventos locais em `sync_events` e sucessos em `sync_history`.

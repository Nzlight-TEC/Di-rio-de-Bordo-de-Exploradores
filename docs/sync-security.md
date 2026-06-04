# Sincronizacao segura de fotos

## Fluxo

1. O app salva fotos em armazenamento local, calcula SHA-256 do conteudo Base64 e grava metadados no SQLite.
2. Cada criacao ou edicao entra em `sync_queue`.
3. `networkMonitor` registra transicoes online/offline em `network_events`.
4. Ao reconectar, `syncEngine` busca a fila, valida o hash local das fotos, monta o payload e cria um envelope AES-256-GCM.
5. A API central exige HTTPS, `Authorization: Bearer`, descriptografa o envelope, valida hashes e grava no PostgreSQL do Supabase com SQL parametrizado.
6. Se a nuvem tiver versao mais recente com hash diferente, a resposta volta como `conflict`; caso contrario, o app marca como `synced` e grava `sync_history`.

## Variaveis do app Expo

```bash
EXPO_PUBLIC_SYNC_ENDPOINT=https://seu-dominio.com/sync/discoveries
EXPO_PUBLIC_SYNC_AUTH_TOKEN=token-longo-e-rotacionavel
EXPO_PUBLIC_SYNC_ENCRYPTION_KEY=chave-com-ao-menos-32-caracteres
EXPO_PUBLIC_SYNC_KEY_ID=mobile-2026-06
```

Sem `EXPO_PUBLIC_SYNC_ENDPOINT`, o app usa modo demo local e nao envia dados.

## Tabelas no Supabase

No Supabase, abra o SQL Editor e cole o conteudo de `db/supabase_schema.sql`.

Se suas tabelas ja existem, cole tambem `db/supabase_rf05_rarity_patch.sql` para acrescentar
o RF05 sem apagar dados. A raridade aceita os valores `comum`, `rara` e `muito_rara`,
exibidos no app como Comum, Rara e Muito Rara.

Ele cria estas tabelas:

- `devices`: dispositivos autorizados a sincronizar.
- `discoveries`: registros principais enviados pelo app, incluindo categoria e raridade obrigatoria.
- `discovery_photos`: fotos em Base64 com tamanho, MIME e SHA-256.
- `discovery_versions`: historico para rollback e conciliacao.
- `sync_audit`: auditoria de sincronizacoes aceitas ou conflitantes.

Depois de criar as tabelas, cadastre um dispositivo manualmente:

```sql
SELECT public.register_device('device_id_do_app');
```

Para desenvolvimento, voce pode deixar `ALLOW_DEVICE_AUTO_ENROLLMENT=true` no servidor e o primeiro sync cadastra o dispositivo automaticamente.

## Variaveis do servidor

```bash
DATABASE_URL=postgresql://postgres.SEU_PROJECT_REF:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
PGSSLMODE=require
SYNC_AUTH_TOKEN=token-longo-e-rotacionavel
SYNC_ENCRYPTION_KEY=chave-com-ao-menos-32-caracteres
PORT=8080
ALLOW_DEVICE_AUTO_ENROLLMENT=false
```

O app nao deve usar `DATABASE_URL`. Essa senha fica somente no servidor.

Para iniciar a API:

```bash
cd server
npm install
npm test
npm start
```

## Conflitos e rollback

O servidor preserva cada versao aceita em `discovery_versions`. Para rollback, recupere o JSON da versao desejada e reaplique como uma nova versao superior. O app registra eventos locais em `sync_events` e sucessos em `sync_history`.

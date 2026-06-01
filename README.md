# Diario de Bordo de Exploradores

Aplicativo mobile offline-first para pesquisadores registrarem descobertas em expedicoes sem internet. A entrega funcional principal esta em `pwa/`, usando IndexedDB, Service Worker e uma fila de sincronizacao resiliente. Tambem ha um esqueleto React Native/Expo no repositorio, mas a instalacao de dependencias pode depender da estabilidade da rede local.

## Requisitos implementados

- RF01: cadastro de descoberta com titulo, descricao, categoria, data/hora automatica e persistencia local.
- RF03: operacao offline para criar, listar, buscar e filtrar registros salvos no dispositivo.
- RF04: motor de sincronizacao com fila local, status por registro, envio HTTPS configuravel e deteccao de conflitos.
- RF02: captura de ate 3 fotos por descoberta usando a camera nativa e armazenamento local dos arquivos.
- RF06: painel com total de descobertas, distribuicao por categoria e percentual sincronizado.
- RF08: favoritos com destaque, filtro e acesso rapido.

## Como executar a PWA

```bash
cd pwa
python -m http.server 5173
```

Abra `http://localhost:5173` no navegador do dispositivo, emulador ou desktop. Em celulares, use a opcao do navegador para instalar/adicionar a tela inicial.

## Como executar o prototipo React Native/Expo

```bash
npm install
npm run start
npm run android
npm run ios
```

## Sincronizacao com nuvem

Por padrao, o app usa um adaptador de demonstracao para validar a fila offline sem exigir backend. Para conectar a uma API real, informe um endpoint HTTPS antes de iniciar:

```bash
$env:EXPO_PUBLIC_SYNC_ENDPOINT="https://sua-api.exemplo/sync/discoveries"
npm run start
```

O endpoint recebe um `POST` JSON por descoberta e pode responder:

```json
{
  "remoteId": "abc123",
  "version": 2,
  "updatedAt": "2026-06-01T18:30:00.000Z",
  "status": "accepted"
}
```

Para conflito, responda com `"status": "conflict"` e `conflictNote`.

## Documentacao visual

Consulte [VISUAL_DOCUMENTATION.md](./VISUAL_DOCUMENTATION.md) para o roteiro de screenshots das funcionalidades principais.

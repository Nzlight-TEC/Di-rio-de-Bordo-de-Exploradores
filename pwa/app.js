const DB_NAME = 'explorer-mobile-offline';
const DB_VERSION = 2;
const MAX_PHOTOS = 3;
const SYNC_ENDPOINT = localStorage.getItem('EXPLORER_SYNC_ENDPOINT') || '';
const params = new URLSearchParams(location.search);

const categories = [
  ['flora', 'Flora'],
  ['fauna', 'Fauna'],
  ['fungi', 'Fungi'],
  ['mineral', 'Mineral'],
  ['fossil', 'Fossil'],
  ['rock', 'Rocha'],
  ['water', 'Agua'],
  ['artifact', 'Artefato'],
  ['other', 'Outro']
];

const rarities = [
  ['comum', 'Comum'],
  ['rara', 'Rara'],
  ['muito_rara', 'Muito Rara']
];

let db;
let currentCategory = 'flora';
let currentRarity = 'comum';
let photoDrafts = [];
let favoritesOnly = false;

const els = {
  badge: document.querySelector('#networkBadge'),
  tabs: [...document.querySelectorAll('.tab')],
  views: [...document.querySelectorAll('.view')],
  form: document.querySelector('#discoveryForm'),
  title: document.querySelector('#titleInput'),
  description: document.querySelector('#descriptionInput'),
  categoryChoices: document.querySelector('#categoryChoices'),
  rarityChoices: document.querySelector('#rarityChoices'),
  photoInput: document.querySelector('#photoInput'),
  photoPreview: document.querySelector('#photoPreview'),
  photoCounter: document.querySelector('#photoCounter'),
  search: document.querySelector('#searchInput'),
  favoriteFilter: document.querySelector('#favoriteFilterButton'),
  recordsList: document.querySelector('#recordsList'),
  syncButton: document.querySelector('#syncButton'),
  syncResult: document.querySelector('#syncResult')
};

init().catch((error) => {
  alert(`Erro ao iniciar app offline: ${getErrorMessage(error)}`);
});

async function init() {
  db = await openDatabase();
  if (params.has('demo')) {
    await seedDemoData();
  }
  renderCategoryChoices();
  renderRarityChoices();
  bindEvents();
  showView(params.get('view') || location.hash.replace('#', '') || 'dashboardView');
  await refresh();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }
}

function bindEvents() {
  window.addEventListener('online', refreshNetworkBadge);
  window.addEventListener('offline', refreshNetworkBadge);
  refreshNetworkBadge();

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.tab));
  });

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await createDiscovery();
  });

  els.photoInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      await addPhoto(file);
    }
  });

  els.search.addEventListener('input', refreshRecords);
  els.favoriteFilter.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    els.favoriteFilter.classList.toggle('active', favoritesOnly);
    els.favoriteFilter.textContent = favoritesOnly ? '★' : '☆';
    refreshRecords();
  });

  els.syncButton.addEventListener('click', syncPendingDiscoveries);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const discoveries = database.objectStoreNames.contains('discoveries')
        ? request.transaction.objectStore('discoveries')
        : database.createObjectStore('discoveries', { keyPath: 'id' });

      ensureIndex(discoveries, 'syncStatus', 'syncStatus');
      ensureIndex(discoveries, 'category', 'category');
      ensureIndex(discoveries, 'rarity', 'rarity');
      ensureIndex(discoveries, 'favorite', 'favorite');
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function createDiscovery() {
  const title = els.title.value.trim();
  const description = els.description.value.trim();

  if (!title || !description) {
    alert('Informe titulo e descricao da descoberta.');
    return;
  }

  const now = new Date().toISOString();
  const record = {
    id: makeId('disc'),
    title,
    description,
    category: currentCategory,
    rarity: currentRarity,
    discoveredAt: now,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    photos: photoDrafts,
    syncStatus: 'pending',
    syncError: null,
    remoteId: null,
    version: 1,
    lastSyncedAt: null,
    conflictNote: null
  };

  await putRecord(record);
  els.form.reset();
  currentCategory = 'flora';
  currentRarity = 'comum';
  photoDrafts = [];
  renderCategoryChoices();
  renderRarityChoices();
  renderPhotoDrafts();
  showView('recordsView');
  await refresh();
}

async function addPhoto(file) {
  if (photoDrafts.length >= MAX_PHOTOS) {
    alert(`Cada descoberta pode ter ate ${MAX_PHOTOS} fotos.`);
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  photoDrafts.push({
    id: makeId('photo'),
    uri: dataUrl,
    createdAt: new Date().toISOString()
  });
  renderPhotoDrafts();
}

async function syncPendingDiscoveries() {
  const pending = (await getAllRecords()).filter((record) =>
    ['pending', 'error', 'syncing'].includes(record.syncStatus)
  );

  if (!navigator.onLine) {
    els.syncResult.textContent = 'Sem conexao. Registros continuam preservados na fila local.';
    return;
  }

  let synced = 0;
  let conflicts = 0;
  let failed = 0;
  els.syncButton.disabled = true;
  els.syncButton.textContent = 'Sincronizando...';

  for (const record of pending) {
    try {
      record.syncStatus = 'syncing';
      await putRecord(record);
      const remote = await sendRecord(record);
      const conflict = detectConflict(record, remote);
      if (conflict) {
        record.syncStatus = 'conflict';
        record.conflictNote = conflict;
        conflicts += 1;
      } else {
        record.syncStatus = 'synced';
        record.remoteId = remote.remoteId || record.remoteId || `remote_${record.id}`;
        record.version = remote.version || record.version;
        record.lastSyncedAt = new Date().toISOString();
        record.syncError = null;
        record.conflictNote = null;
        synced += 1;
      }
      await putRecord(record);
    } catch (error) {
      record.syncStatus = 'error';
      record.syncError = getErrorMessage(error);
      failed += 1;
      await putRecord(record);
    }
  }

  els.syncButton.disabled = false;
  els.syncButton.textContent = 'Sincronizar agora';
  els.syncResult.textContent = `Tentados ${pending.length} · Enviados ${synced} · Conflitos ${conflicts} · Falhas ${failed}`;
  await refresh();
}

async function sendRecord(record) {
  if (!SYNC_ENDPOINT) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      remoteId: record.remoteId || `remote_${record.id}`,
      version: record.version,
      updatedAt: record.updatedAt,
      status: 'accepted'
    };
  }

  if (!SYNC_ENDPOINT.startsWith('https://')) {
    throw new Error('Endpoint de sincronizacao precisa usar HTTPS.');
  }

  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record)
  });

  if (!response.ok) {
    throw new Error(`Servidor retornou HTTP ${response.status}.`);
  }

  return response.json();
}

function detectConflict(local, remote) {
  if (remote.status === 'conflict') {
    return remote.conflictNote || 'Servidor informou conflito para este registro.';
  }

  if (remote.updatedAt && new Date(remote.updatedAt) > new Date(local.updatedAt)) {
    return 'Versao remota mais recente que a copia local.';
  }

  return null;
}

async function refresh() {
  await refreshDashboard();
  await refreshRecords();
  refreshNetworkBadge();
}

async function refreshDashboard() {
  const records = await getAllRecords();
  const total = records.length;
  const synced = records.filter((record) => record.syncStatus === 'synced').length;
  const pending = records.filter((record) =>
    ['pending', 'syncing', 'error'].includes(record.syncStatus)
  ).length;
  const conflicts = records.filter((record) => record.syncStatus === 'conflict').length;
  const byCategory = new Map();

  records.forEach((record) => {
    byCategory.set(record.category, (byCategory.get(record.category) || 0) + 1);
  });

  document.querySelector('#totalCount').textContent = total;
  document.querySelector('#syncedPercent').textContent = total ? `${Math.round((synced / total) * 100)}%` : '0%';
  document.querySelector('#pendingCount').textContent = pending;
  document.querySelector('#conflictCount').textContent = conflicts;
  document.querySelector('#syncQueueCount').textContent = pending;
  document.querySelector('#syncDoneCount').textContent = synced;

  const categoryBreakdown = document.querySelector('#categoryBreakdown');
  categoryBreakdown.innerHTML = '';
  if (!records.length) {
    categoryBreakdown.innerHTML = '<p class="empty">Nenhuma descoberta registrada ainda.</p>';
    return;
  }

  [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, count]) => {
      const row = document.createElement('div');
      row.className = 'category-row';
      row.innerHTML = `
        <strong>${getCategoryLabel(category)}</strong>
        <span class="bar-track"><span class="bar-fill" style="width: ${Math.max(8, (count / total) * 100)}%"></span></span>
        <strong>${count}</strong>
      `;
      categoryBreakdown.append(row);
    });
}

async function refreshRecords() {
  const query = els.search.value.trim().toLowerCase();
  const records = (await getAllRecords())
    .filter((record) => {
      const rarity = record.rarity || 'comum';
      const haystack = `${record.title} ${record.description} ${record.category} ${rarity} ${getRarityLabel(rarity)}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!favoritesOnly || record.favorite);
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt));

  els.recordsList.innerHTML = '';

  if (!records.length) {
    els.recordsList.innerHTML = '<p class="empty">Nenhum registro encontrado no dispositivo.</p>';
    return;
  }

  records.forEach((record) => {
    const card = document.createElement('article');
    card.className = 'record-card';
    card.innerHTML = `
      <div class="record-top">
        <div>
          <h3>${escapeHtml(record.title)}</h3>
          <p class="record-meta">${getCategoryLabel(record.category)} · ${getRarityLabel(record.rarity || 'comum')} · ${formatDate(record.discoveredAt)}</p>
        </div>
        <button class="favorite-button" title="Alternar favorito">${record.favorite ? '★' : '☆'}</button>
      </div>
      <p class="record-description">${escapeHtml(record.description)}</p>
      <div class="record-photos">
        ${record.photos.map((photo) => `<img src="${photo.uri}" alt="Foto da descoberta" />`).join('')}
      </div>
      <div class="record-footer">
        <span class="status-pill status-${record.syncStatus}">${getStatusLabel(record.syncStatus)}</span>
        ${record.syncError ? `<small class="muted">${escapeHtml(record.syncError)}</small>` : ''}
        ${record.conflictNote ? `<small class="muted">${escapeHtml(record.conflictNote)}</small>` : ''}
      </div>
    `;

    card.querySelector('.favorite-button').addEventListener('click', async () => {
      record.favorite = !record.favorite;
      record.updatedAt = new Date().toISOString();
      record.version += 1;
      record.syncStatus = 'pending';
      await putRecord(record);
      await refresh();
    });

    els.recordsList.append(card);
  });
}

function renderCategoryChoices() {
  els.categoryChoices.innerHTML = '';
  categories.forEach(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `choice ${value === currentCategory ? 'active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      currentCategory = value;
      renderCategoryChoices();
    });
    els.categoryChoices.append(button);
  });
}

function renderRarityChoices() {
  els.rarityChoices.innerHTML = '';
  rarities.forEach(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `choice ${value === currentRarity ? 'active' : ''}`;
    button.textContent = label;
    button.addEventListener('click', () => {
      currentRarity = value;
      renderRarityChoices();
    });
    els.rarityChoices.append(button);
  });
}

function renderPhotoDrafts() {
  els.photoCounter.textContent = `${photoDrafts.length}/${MAX_PHOTOS}`;
  els.photoPreview.innerHTML = photoDrafts.length
    ? photoDrafts.map((photo) => `<img src="${photo.uri}" alt="Foto pendente" />`).join('')
    : '<span class="muted">Sem fotos anexadas.</span>';
}

function showView(id) {
  els.views.forEach((view) => view.classList.toggle('active', view.id === id));
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === id));
  if (location.hash.replace('#', '') !== id) {
    history.replaceState(null, '', `${location.pathname}${location.search}#${id}`);
  }
  if (id === 'recordsView') {
    refreshRecords();
  }
  if (id === 'dashboardView' || id === 'syncView') {
    refreshDashboard();
  }
}

function refreshNetworkBadge() {
  els.badge.textContent = navigator.onLine ? 'Online' : 'Offline';
  els.badge.classList.toggle('online', navigator.onLine);
  els.badge.classList.toggle('offline', !navigator.onLine);
}

function getAllRecords() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('discoveries', 'readonly');
    const request = tx.objectStore('discoveries').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('discoveries', 'readwrite');
    const request = tx.objectStore('discoveries').put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function seedDemoData() {
  const existing = await getAllRecords();
  if (existing.length) {
    return;
  }

  const now = new Date();
  const samples = [
    {
      title: 'Orquidea rupestre',
      description: 'Especime observado em fenda umida de afloramento, com flores pequenas e folhas carnosas.',
      category: 'flora',
      rarity: 'rara',
      favorite: true,
      syncStatus: 'pending',
      photos: [makeDemoPhoto('#116466', 'FL')]
    },
    {
      title: 'Estrato ferruginoso',
      description: 'Camada avermelhada com textura granular, registrada para comparacao geologica posterior.',
      category: 'rock',
      rarity: 'comum',
      favorite: false,
      syncStatus: 'synced',
      photos: [makeDemoPhoto('#c88719', 'RO')]
    },
    {
      title: 'Fragmento fossilifero',
      description: 'Fragmento com impressao organica parcial; requer conciliacao com registro remoto existente.',
      category: 'fossil',
      rarity: 'muito_rara',
      favorite: true,
      syncStatus: 'conflict',
      conflictNote: 'Versao remota mais recente que a copia local.',
      photos: [makeDemoPhoto('#7c2d12', 'FO')]
    }
  ];

  for (const [index, sample] of samples.entries()) {
    const createdAt = new Date(now.getTime() - index * 3600000).toISOString();
    await putRecord({
      id: makeId('demo'),
      title: sample.title,
      description: sample.description,
      category: sample.category,
      rarity: sample.rarity,
      discoveredAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      favorite: sample.favorite,
      photos: sample.photos.map((uri) => ({
        id: makeId('photo'),
        uri,
        createdAt
      })),
      syncStatus: sample.syncStatus,
      syncError: null,
      remoteId: sample.syncStatus === 'synced' ? makeId('remote') : null,
      version: 1,
      lastSyncedAt: sample.syncStatus === 'synced' ? new Date().toISOString() : null,
      conflictNote: sample.conflictNote || null
    });
  }
}

function makeDemoPhoto(color, label) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
      <rect width="180" height="180" rx="18" fill="${color}" />
      <circle cx="132" cy="48" r="20" fill="#f7f3ea" opacity=".9" />
      <path d="M28 132l40-48 30 34 20-22 36 36z" fill="#ffffff" opacity=".82" />
      <text x="90" y="104" text-anchor="middle" font-family="Arial" font-size="34" font-weight="700" fill="#17252a">${label}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function makeId(prefix) {
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}_${random}`;
}

function getCategoryLabel(category) {
  return categories.find(([value]) => value === category)?.[1] || category;
}

function getRarityLabel(rarity) {
  return rarities.find(([value]) => value === rarity)?.[1] || rarity;
}

function getStatusLabel(status) {
  return {
    pending: 'Pendente',
    syncing: 'Enviando',
    synced: 'Sincronizado',
    conflict: 'Conflito',
    error: 'Erro'
  }[status] || status;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char];
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

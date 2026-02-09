/**
 * OpenNotes Desktop - Main Application
 * Connects to OpenNotesAPI, provides editor, offline storage
 */

// ==================== DEVELOPER CONSOLE ====================
const devConsole = {
  logs: [],
  maxLogs: 200,
  
  init() {
    // Intercept console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    
    console.log = (...args) => {
      this.addLog('log', args);
      originalLog.apply(console, args);
    };
    
    console.warn = (...args) => {
      this.addLog('warn', args);
      originalWarn.apply(console, args);
    };
    
    console.error = (...args) => {
      this.addLog('error', args);
      originalError.apply(console, args);
    };
    
    // Catch unhandled errors
    window.addEventListener('error', (e) => {
      this.addLog('error', [`Uncaught: ${e.message}`, `at ${e.filename}:${e.lineno}`]);
    });
    
    window.addEventListener('unhandledrejection', (e) => {
      this.addLog('error', [`Unhandled Promise: ${e.reason}`]);
    });
  },
  
  addLog(type, args) {
    const time = new Date().toLocaleTimeString();
    const message = args.map(a => {
      if (typeof a === 'object') {
        try { return JSON.stringify(a, null, 2); } 
        catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    
    this.logs.push({ time, type, message });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    this.render();
  },
  
  render() {
    const output = document.getElementById('dev-console-output');
    if (!output) return;
    
    output.innerHTML = this.logs.map(log => `
      <div class="dev-log ${log.type}">
        <span class="dev-log-time">${log.time}</span>
        <span class="dev-log-msg">${this.escapeHtml(log.message)}</span>
      </div>
    `).join('');
    
    output.scrollTop = output.scrollHeight;
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize console interceptor immediately
devConsole.init();

// ==================== CARD GLOW EFFECT ====================
// Tracks mouse position over cards for radial gradient glow
function initCardGlow(container) {
  if (!container) return;
  const cards = container.querySelectorAll('.note-card, .quiz-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty('--glow-x', x + 'px');
      card.style.setProperty('--glow-y', y + 'px');
    });
  });
}

// Expose to window for inline HTML handlers
window.toggleDevConsole = function() {
  const panel = document.getElementById('dev-console');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      devConsole.render();
    }
  }
};

// ==================== CONFIGURATION ====================
const CONFIG = {
  API_BASE: 'https://open-notes.tebby2008-li.workers.dev',
  NOTES_RAW_BASE: 'https://raw.githubusercontent.com/Tebby2008/OpenNotes/main/Notes',
  FALLBACK_THUMBNAIL: 'https://raw.githubusercontent.com/Tebby2008/OpenNotes/main/resources/fallback.svg',
  GATEWAY_URL: 'https://opennotes-gateway.wkohara.workers.dev',
  APP_TOKEN: '', // Set via secrets
  STORAGE_KEY: 'opennotes_desktop',
  MAX_STORAGE_MB: 500,
  NOTES_PER_PAGE: 20, // Match API default
  DOWNLOAD_EXPIRY_DAYS: 10, // Downloads expire after 10 days
};

// HTTP client - uses Tauri custom command if available, falls back to fetch
let tauriInvoke = null;

async function initHttpClient() {
  try {
    console.log('[HTTP] Checking for Tauri environment...');
    console.log('[HTTP] window.__TAURI__ =', window.__TAURI__);
    
    if (window.__TAURI__) {
      console.log('[HTTP] Tauri detected, importing core...');
      const { invoke } = await import('@tauri-apps/api/core');
      tauriInvoke = invoke;
      console.log('[HTTP] Using Tauri custom command for API calls');
    } else {
      console.warn('[HTTP] Not running in Tauri, Origin headers will be blocked by browser');
    }
  } catch (e) {
    console.error('[HTTP] Failed to initialize Tauri:', e);
    console.error('[HTTP] Error details:', e.message, e.stack);
  }
}

async function httpFetch(url, options = {}) {
  console.log('[FETCH] Request:', url);
  console.log('[FETCH] Using Tauri invoke:', !!tauriInvoke);
  
  try {
    if (tauriInvoke) {
      // Use Tauri custom command (Rust handles headers)
      console.log('[FETCH] Calling Rust api_fetch command...');
      const result = await tauriInvoke('api_fetch', { 
        url: url,
        method: options.method || 'GET',
        body: options.body || null,
      });
      
      console.log('[FETCH] Rust response status:', result.status, 'ok:', result.ok);
      
      // Wrap in fetch-like response object
      return {
        ok: result.ok,
        status: result.status,
        json: async () => JSON.parse(result.body),
        text: async () => result.body,
        blob: async () => new Blob([result.body]),
      };
    } else {
      // Browser fallback (Origin header will be ignored)
      console.warn('[FETCH] Using browser fetch - Origin header will be stripped!');
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };
      const response = await fetch(url, { ...options, headers, mode: 'cors' });
      console.log('[FETCH] Browser response status:', response.status);
      return response;
    }
  } catch (e) {
    console.error('[FETCH] Request failed:', e);
    console.error('[FETCH] Error type:', e.constructor.name);
    console.error('[FETCH] Error message:', e.message);
    throw e;
  }
}

// Load secrets from Tauri store
async function loadSecrets() {
  try {
    // Check if Tauri store is available
    if (window.__TAURI__) {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = new Store('secrets.json');
      
      const gateway = await store.get('gateway_url');
      const token = await store.get('app_token');
      
      if (gateway) CONFIG.GATEWAY_URL = gateway;
      if (token) CONFIG.APP_TOKEN = token;
      
      console.log('Secrets loaded from store');
    }
  } catch (e) {
    console.log('Running in browser mode, using defaults');
  }
}

// ==================== STATE ====================
const state = {
  notes: [],
  allNotes: [], // All loaded notes for infinite scroll
  cachedNotes: [], // Cached notes for offline filtering/sorting
  savedNotes: [],
  currentPage: 1,
  totalNotes: 0,
  offset: 0,
  hasMore: true,
  isLoading: false,
  activeView: 'browse',
  currentFilter: 'all',
  currentSort: 'views',
  searchQuery: '',
  currentNote: null,
  isDarkMode: false,
  storageUsed: 0,
};

// ==================== API CLIENT ====================
const api = {
  getBaseUrl() {
    return CONFIG.GATEWAY_URL || CONFIG.API_BASE;
  },
  
  getHeaders() {
    const headers = {};
    if (CONFIG.APP_TOKEN && CONFIG.GATEWAY_URL) {
      headers['X-App-Token'] = CONFIG.APP_TOKEN;
    }
    return headers;
  },
  
  async fetchNotes(params = {}) {
    try {
      const queryParams = new URLSearchParams({
        type: 'list',
        offset: params.offset || 0,
        sort: params.sort || 'views',
        ...(params.format && params.format !== 'all' && { format: params.format }),
        ...(params.search && { q: params.search }),
      });
      // Note: API ignores limit param and always returns up to 20 items
      
      const requestUrl = `${this.getBaseUrl()}?${queryParams}`;
      console.log('[API] Fetching notes from:', requestUrl);
      
      const response = await httpFetch(requestUrl, {
        headers: this.getHeaders(),
      });
      
      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[API] Error response:', response.status, errorBody);
        throw new Error(`Failed to fetch notes: ${response.status} - ${errorBody}`);
      }
      
      const data = await response.json();
      console.log('[API] Response data keys:', Object.keys(data));
      
      const items = data.items || data.notes || data.data || [];
      console.log('[API] Got', items.length, 'notes');
      
      // API returns up to 20 items per request
      // hasMore = true if we got exactly 20 (likely more exist)
      return {
        notes: items,
        total: data.meta?.total || null, // API doesn't provide total
        hasMore: items.length === 20, // If we got 20, there might be more
      };
    } catch (error) {
      console.error('[API] fetchNotes Error:', error);
      console.error('[API] Error stack:', error.stack);
      throw error;
    }
  },
  
  async fetchAllNotes(params = {}) {
    // Fetch notes in batches until we have all of them
    const allNotes = [];
    let offset = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await this.fetchNotes({ ...params, offset });
      allNotes.push(...result.notes);
      offset += result.notes.length;
      hasMore = result.hasMore; // true if we got exactly 20
      
      // Safety limit
      if (allNotes.length >= 1000 || result.notes.length === 0) break;
    }
    
    return { notes: allNotes, total: allNotes.length };
  },
  
  async fetchNote(id) {
    try {
      const queryParams = new URLSearchParams({
        type: 'note',
        noteId: id,
      });
      const response = await httpFetch(`${this.getBaseUrl()}?${queryParams}`, {
        headers: this.getHeaders()
      });
      if (!response.ok) throw new Error('Note not found');
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },
  
  async fetchRecent() {
    return this.fetchNotes({ sort: 'recent', limit: 12 });
  },
  
  async incrementViews(name) {
    try {
      const queryParams = new URLSearchParams({
        type: 'note',
        noteId: name,
        counter: 'views',
      });
      await httpFetch(`${this.getBaseUrl()}?${queryParams}`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
    } catch (error) {
      console.error('Failed to increment views:', error);
    }
  },
  
  async incrementDownloads(name) {
    try {
      const queryParams = new URLSearchParams({
        type: 'note',
        noteId: name,
        counter: 'downloads',
      });
      await httpFetch(`${this.getBaseUrl()}?${queryParams}`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
    } catch (error) {
      console.error('Failed to increment downloads:', error);
    }
  },
};

// ==================== STORAGE MANAGER ====================
const storage = {
  get(key) {
    const data = localStorage.getItem(`${CONFIG.STORAGE_KEY}_${key}`);
    return data ? JSON.parse(data) : null;
  },
  
  set(key, value) {
    localStorage.setItem(`${CONFIG.STORAGE_KEY}_${key}`, JSON.stringify(value));
    this.updateStorageIndicator();
  },
  
  remove(key) {
    localStorage.removeItem(`${CONFIG.STORAGE_KEY}_${key}`);
    this.updateStorageIndicator();
  },
  
  getSavedNotes() {
    const notes = this.get('saved_notes') || [];
    // Filter out expired downloads
    const now = Date.now();
    const validNotes = notes.filter(n => !n.expiresAt || n.expiresAt > now);
    if (validNotes.length !== notes.length) {
      // Some notes expired, update storage
      this.set('saved_notes', validNotes);
      console.log(`[STORAGE] Purged ${notes.length - validNotes.length} expired downloads`);
    }
    return validNotes;
  },
  
  async saveNoteOffline(note) {
    const saved = this.getSavedNotes();
    
    // Check if already saved
    if (saved.find(n => n.name === note.name)) {
      showToast('Note already downloaded', 'info');
      return false;
    }
    
    // Download and cache the file
    try {
      let blob;
      if (window.__TAURI__) {
        // Use Tauri HTTP plugin for binary-safe downloads
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(note.dl, { method: 'GET' });
        const ab = await response.arrayBuffer();
        const ct = response.headers?.get?.('content-type') || 'application/octet-stream';
        blob = new Blob([ab], { type: ct });
      } else {
        const response = await fetch(note.dl);
        blob = await response.blob();
      }
      const base64 = await this.blobToBase64(blob);
      
      // Calculate expiry date (10 days from now)
      const expiresAt = Date.now() + (CONFIG.DOWNLOAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      
      const noteData = {
        ...note,
        cachedFile: base64,
        cachedAt: Date.now(),
        expiresAt: expiresAt,
        fileSize: blob.size,
      };
      
      saved.push(noteData);
      try {
        this.set('saved_notes', saved);
      } catch (quotaErr) {
        // localStorage quota exceeded — save to filesystem instead
        if (window.__TAURI__) {
          console.warn('[STORAGE] localStorage quota exceeded, saving to filesystem');
          const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
          const { appDataDir, join } = await import('@tauri-apps/api/path');
          const dir = await appDataDir();
          const dlDir = await join(dir, 'downloads');
          await mkdir(dlDir, { recursive: true });
          const filePath = await join(dlDir, note.name);
          await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
          // Save only metadata (no binary) to localStorage
          const metaData = { ...note, savedToFile: filePath, cachedAt: Date.now(), expiresAt: Date.now() + (CONFIG.DOWNLOAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000), fileSize: blob.size };
          saved[saved.length - 1] = metaData;
          localStorage.setItem(`${CONFIG.STORAGE_KEY}_saved_notes`, JSON.stringify(saved));
          this.updateStorageIndicator();
        } else {
          throw quotaErr;
        }
      }
      state.savedNotes = saved;
      
      showToast('Note downloaded for offline access', 'success');
      return true;
    } catch (error) {
      console.error('Failed to download note:', error);
      showToast('Failed to download note', 'error');
      return false;
    }
  },
  
  removeOfflineNote(name) {
    let saved = this.getSavedNotes();
    saved = saved.filter(n => n.name !== name);
    this.set('saved_notes', saved);
    state.savedNotes = saved;
    showToast('Download removed', 'info');
  },
  
  isNoteSaved(name) {
    return this.getSavedNotes().some(n => n.name === name);
  },
  
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },
  
  base64ToBlob(base64) {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  },
  
  getStorageUsed() {
    let total = 0;
    for (let key in localStorage) {
      if (key.startsWith(CONFIG.STORAGE_KEY)) {
        total += localStorage.getItem(key).length * 2; // UTF-16
      }
    }
    return total;
  },
  
  updateStorageIndicator() {
    const used = this.getStorageUsed();
    const usedMB = (used / 1024 / 1024).toFixed(2);
    const maxMB = CONFIG.MAX_STORAGE_MB;
    const percent = Math.min((used / (maxMB * 1024 * 1024)) * 100, 100);
    
    state.storageUsed = used;
    
    // Update sidebar indicator
    const usedBar = document.getElementById('storage-used-bar');
    const storageText = document.getElementById('storage-text');
    
    if (usedBar) usedBar.style.width = `${percent}%`;
    if (storageText) storageText.textContent = `${usedMB} / ${maxMB} MB used`;
    
    // Update storage view if visible
    this.updateStorageView(used, percent);
  },
  
  updateStorageView(used, percent) {
    const ring = document.getElementById('storage-ring');
    const percentEl = document.getElementById('storage-percent');
    const usedSpace = document.getElementById('used-space');
    const availableSpace = document.getElementById('available-space');
    const savedCount = document.getElementById('saved-count');
    
    if (ring) {
      // Circle circumference = 2 * PI * r = 2 * 3.14 * 50 ≈ 314
      const offset = 314 - (314 * percent / 100);
      ring.style.strokeDashoffset = offset;
    }
    
    if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    if (usedSpace) usedSpace.textContent = `${(used / 1024 / 1024).toFixed(2)} MB`;
    if (availableSpace) availableSpace.textContent = `${(CONFIG.MAX_STORAGE_MB - used / 1024 / 1024).toFixed(2)} MB`;
    if (savedCount) savedCount.textContent = state.savedNotes.length;
  },
  
  clearCache() {
    // Keep saved notes, clear everything else
    const saved = this.getSavedNotes();
    for (let key in localStorage) {
      if (key.startsWith(CONFIG.STORAGE_KEY) && !key.includes('saved_notes')) {
        localStorage.removeItem(key);
      }
    }
    showToast('Cache cleared', 'success');
    this.updateStorageIndicator();
  },
  
  clearAll() {
    for (let key in localStorage) {
      if (key.startsWith(CONFIG.STORAGE_KEY)) {
        localStorage.removeItem(key);
      }
    }
    state.savedNotes = [];
    showToast('All offline data cleared', 'success');
    this.updateStorageIndicator();
    renderDownloads();
  },
  
  purgeExpiredDownloads() {
    // This is called on app start to clean up expired downloads
    // getSavedNotes already filters and removes expired downloads
    const notes = this.getSavedNotes();
    state.savedNotes = notes;
    console.log(`[STORAGE] ${notes.length} valid downloads, expired downloads purged`);
  },
};

// ==================== UI RENDERING ====================
function renderNotesGrid(notes, containerId = 'notes-grid') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (!notes || notes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">search_off</span>
        <h3>No notes found</h3>
        <p>Try adjusting your filters or search terms</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = notes.map(note => createNoteCard(note)).join('');
  
  // Add card glow effect (mouse tracking)
  initCardGlow(container);
  
  // Attach event listeners
  container.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', () => {
      openNoteModal(card.dataset.noteId);
    });
  });
}

function createNoteCard(note) {
  const format = getFileFormat(note.name);
  const isSaved = storage.isNoteSaved(note.name);
  // API uses: thumb (not img), auth (not author), v (not views), d (not downloads)
  const thumbnail = note.thumb || note.img || CONFIG.FALLBACK_THUMBNAIL;
  const author = note.auth || note.author || 'Unknown';
  const views = note.v || note.views || 0;
  const downloads = note.d || note.downloads || 0;
  
  return `
    <article class="note-card" data-note-id="${escapeHtml(note.name)}">
      <div class="note-thumbnail">
        ${thumbnail ? 
          `<img src="${thumbnail}" 
               alt="${escapeHtml(note.name)}" 
               loading="lazy"
               onerror="this.src='${CONFIG.FALLBACK_THUMBNAIL}'">` :
          `<div class="no-thumb"><span class="material-symbols-rounded">description</span></div>`
        }
        <span class="format-badge ${format}">${format.toUpperCase()}</span>
      </div>
      <div class="note-content">
        <h3 class="note-title">${escapeHtml(note.title || note.name)}</h3>
        <div class="note-meta">
          <span class="note-author">
            <span class="material-symbols-rounded">person</span>
            ${escapeHtml(author)}
          </span>
          <div class="note-stats">
            <span class="note-stat">
              <span class="material-symbols-rounded">visibility</span>
              ${formatNumber(views)}
            </span>
            <span class="note-stat">
              <span class="material-symbols-rounded">download</span>
              ${formatNumber(downloads)}
            </span>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderPagination() {
  const container = document.getElementById('pagination');
  if (!container) return;
  
  // Show load more button if there are more notes
  if (state.hasMore && state.allNotes.length > 0) {
    container.innerHTML = `
      <button class="btn btn-primary load-more-btn" id="load-more-btn">
        <span class="material-symbols-rounded">expand_more</span>
        Load More Notes
      </button>
      <span class="notes-count">${state.allNotes.length} notes loaded (more available)</span>
    `;
    
    document.getElementById('load-more-btn').addEventListener('click', loadMoreNotes);
  } else if (state.allNotes.length > 0) {
    container.innerHTML = `<span class="notes-count">All ${state.allNotes.length} notes loaded</span>`;
  } else {
    container.innerHTML = '';
  }
}

function renderDownloads() {
  const container = document.getElementById('downloads-grid');
  const emptyState = document.getElementById('downloads-empty');
  
  if (!container) return;
  
  state.savedNotes = storage.getSavedNotes();
  
  if (state.savedNotes.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  container.innerHTML = state.savedNotes.map(note => {
    const daysLeft = note.expiresAt ? Math.ceil((note.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;
    const expiryClass = daysLeft && daysLeft <= 2 ? 'expiring-soon' : '';
    
    return `
    <article class="note-card" data-note-id="${escapeHtml(note.name)}">
      <div class="note-thumbnail">
        <img src="${note.thumb || note.img || CONFIG.FALLBACK_THUMBNAIL}" 
             alt="${escapeHtml(note.name)}" 
             loading="lazy"
             onerror="this.src='${CONFIG.FALLBACK_THUMBNAIL}'">
        <span class="format-badge ${getFileFormat(note.name)}">${getFileFormat(note.name).toUpperCase()}</span>
      </div>
      <div class="note-content">
        <h3 class="note-title">${escapeHtml(note.name)}</h3>
        <div class="note-meta">
          <span class="note-author">
            <span class="material-symbols-rounded">person</span>
            ${escapeHtml(note.auth || note.author || 'Unknown')}
          </span>
          <span class="note-stat">
            <span class="material-symbols-rounded">save</span>
            ${formatBytes(note.fileSize || 0)}
          </span>
        </div>
        ${daysLeft !== null ? `
          <div class="download-expiry ${expiryClass}">
            <span class="material-symbols-rounded">schedule</span>
            Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}
          </div>
        ` : ''}
      </div>
      <div class="note-actions">
        <button class="note-action-btn" onclick="openOfflineNote('${escapeHtml(note.name)}')" title="Open">
          <span class="material-symbols-rounded">open_in_new</span>
        </button>
        <button class="note-action-btn" onclick="storage.removeOfflineNote('${escapeHtml(note.name)}'); renderDownloads();" title="Remove">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    </article>
  `}).join('');
}

function renderStorageBreakdown() {
  const container = document.getElementById('storage-breakdown-list');
  if (!container) return;
  
  const saved = storage.getSavedNotes();
  const totalSize = saved.reduce((acc, n) => acc + (n.fileSize || 0), 0);
  
  if (saved.length === 0) {
    container.innerHTML = '<p class="empty-state">No saved files</p>';
    return;
  }
  
  container.innerHTML = saved.map(note => {
    const percent = totalSize > 0 ? (note.fileSize / totalSize) * 100 : 0;
    const format = getFileFormat(note.name);
    
    return `
      <div class="breakdown-item">
        <div class="breakdown-icon ${format}">
          <span class="material-symbols-rounded">description</span>
        </div>
        <div class="breakdown-info">
          <div class="breakdown-name">${escapeHtml(note.name)}</div>
          <div class="breakdown-size">${formatBytes(note.fileSize || 0)}</div>
        </div>
        <div class="breakdown-bar">
          <div class="breakdown-bar-fill" style="width: ${percent}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ==================== DATA LOADING ====================
async function loadNotes(reset = true) {
  if (state.isLoading) return;
  state.isLoading = true;
  
  const container = document.getElementById('notes-grid');
  
  if (reset) {
    state.offset = 0;
    state.allNotes = [];
    state.hasMore = true;
    if (container) {
      // Show skeleton cards while loading
      container.innerHTML = Array.from({ length: 8 }, (_, i) => `
        <div class="skeleton-card" style="animation-delay: ${i * 0.05}s">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-line" style="width: 80%"></div>
          <div class="skeleton-line short" style="width: 50%"></div>
        </div>
      `).join('');
    }
  }
  
  try {
    const result = await api.fetchNotes({
      offset: state.offset,
      sort: state.currentSort,
      format: state.currentFilter,
      search: state.searchQuery,
    });
    
    const newNotes = result.notes || [];
    state.allNotes = [...state.allNotes, ...newNotes];
    state.notes = state.allNotes;
    state.offset += newNotes.length;
    state.hasMore = result.hasMore; // true if we got 20 items (more may exist)
    state.totalNotes = state.hasMore ? state.allNotes.length + '+' : state.allNotes.length;
    
    console.log(`Loaded ${newNotes.length} notes, total: ${state.allNotes.length}, hasMore: ${state.hasMore}`);
    
    renderNotesGrid(state.allNotes);
    renderPagination();
  } catch (error) {
    console.error('[LOAD] Error loading notes:', error);
    console.error('[LOAD] Error name:', error.name);
    console.error('[LOAD] Error message:', error.message);
    console.error('[LOAD] Error stack:', error.stack);
    
    const errorDetails = `${error.name}: ${error.message}`;
    
    if (container && state.allNotes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded">cloud_off</span>
          <h3>Failed to load notes</h3>
          <p>Please check your connection and try again</p>
          <details style="margin-top: 16px; text-align: left; max-width: 400px;">
            <summary style="cursor: pointer; color: var(--text-secondary);">Error Details</summary>
            <pre style="margin-top: 8px; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">${errorDetails}</pre>
          </details>
          <button class="btn btn-primary" onclick="loadNotes()" style="margin-top: 16px;">Retry</button>
        </div>
      `;
    }
  } finally {
    state.isLoading = false;
  }
}

async function loadMoreNotes() {
  if (state.isLoading || !state.hasMore) return;
  
  const btn = document.getElementById('load-more-btn');
  if (btn) {
    btn.innerHTML = `<div class="spinner small"></div> Loading...`;
    btn.disabled = true;
  }
  
  await loadNotes(false);
}

async function loadAllNotes() {
  // Load all notes at once (for search or full browse)
  if (state.isLoading) return;
  state.isLoading = true;
  
  const container = document.getElementById('notes-grid');
  if (container) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading all notes...</p>
      </div>
    `;
  }
  
  try {
    const result = await api.fetchAllNotes({
      sort: state.currentSort,
      format: state.currentFilter,
      search: state.searchQuery,
    });
    
    state.allNotes = result.notes || [];
    state.notes = state.allNotes;
    state.totalNotes = state.allNotes.length;
    state.offset = state.allNotes.length;
    state.hasMore = false;
    
    console.log(`Loaded all ${state.allNotes.length} notes`);
    
    renderNotesGrid(state.allNotes);
    renderPagination();
  } catch (error) {
    console.error('Load all error:', error);
  } finally {
    state.isLoading = false;
  }
}

async function loadRecent() {
  const container = document.getElementById('recent-content');
  if (!container) return;
  
  try {
    const result = await api.fetchRecent();
    const notes = result.notes || result.data || [];
    renderNotesGrid(notes, 'recent-content');
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">schedule</span>
        <h3>Failed to load recent notes</h3>
        <p>Please check your connection</p>
      </div>
    `;
  }
}

// ==================== MODAL ====================
async function openNoteModal(noteId) {
  const overlay = document.getElementById('note-modal');
  const note = state.notes.find(n => n.name === noteId) || 
               state.savedNotes.find(n => n.name === noteId);
  
  if (!note || !overlay) return;
  
  state.currentNote = note;
  
  // Populate metadata
  const author = note.auth || note.author || 'Unknown';
  const views = note.v || note.views || 0;
  const downloads = note.d || note.downloads || 0;
  const format = getFileFormat(note.name);
  
  document.getElementById('modal-title').textContent = note.title || note.name;
  document.getElementById('modal-author').textContent = author;
  const formatEl = document.getElementById('modal-format');
  formatEl.textContent = format.toUpperCase();
  formatEl.className = `viewer-pill ${format}`;
  document.getElementById('modal-views').textContent = formatNumber(views);
  document.getElementById('modal-downloads').textContent = formatNumber(downloads);
  // Size field from API is a human-readable string like '4.73 MiB'
  document.getElementById('modal-size').textContent = note.size || (note.fileSize ? formatBytes(note.fileSize) : '--');
  
  // Update download button state
  const downloadBtn = document.getElementById('modal-download');
  const isSaved = storage.isNoteSaved(note.name);
  if (downloadBtn) {
    downloadBtn.innerHTML = `
      <span class="material-symbols-rounded">${isSaved ? 'download_done' : 'download'}</span>
      ${isSaved ? 'Downloaded' : 'Download'}
    `;
  }
  
  // Construct dl fallback if missing
  if (!note.dl && note.name) {
    note.dl = `${CONFIG.NOTES_RAW_BASE}/${encodeURIComponent(note.name)}`;
  }
  
  // Load document preview
  const previewFrame = document.getElementById('modal-preview-frame');
  const fallback = document.getElementById('modal-preview-fallback');
  const viewerLoading = document.getElementById('viewer-loading');
  const previewUrl = note.dl;
  
  // Show loading state
  if (viewerLoading) viewerLoading.classList.remove('hidden');
  
  if (previewUrl) {
    const lowerName = note.name.toLowerCase();
    
    if (lowerName.endsWith('.pdf')) {
      // Fetch PDF and render via Tauri asset protocol (WebKit can't render blob: PDFs)
      try {
        let pdfData; // Uint8Array
        // Check if we have an offline copy first
        const offlineCopy = state.savedNotes.find(n => n.name === note.name);
        if (offlineCopy && offlineCopy.cachedFile) {
          const blob = storage.base64ToBlob(offlineCopy.cachedFile);
          pdfData = new Uint8Array(await blob.arrayBuffer());
        } else if (window.__TAURI__) {
          const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
          const response = await tauriFetch(previewUrl, { method: 'GET' });
          pdfData = new Uint8Array(await response.arrayBuffer());
        } else {
          // Browser fallback — use blob URL
          const response = await fetch(previewUrl);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          previewFrame.src = blobUrl;
          previewFrame.classList.remove('hidden');
          fallback.classList.add('hidden');
          if (viewerLoading) viewerLoading.classList.add('hidden');
          state._previewBlobUrl = blobUrl;
          // Skip Tauri path below
          pdfData = null;
        }

        if (pdfData) {
          // Write to temp file and load via asset protocol (works in WebKit)
          const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
          const { tempDir, join } = await import('@tauri-apps/api/path');
          const { convertFileSrc } = await import('@tauri-apps/api/core');

          const tmp = await tempDir();
          const previewDir = await join(tmp, 'opennotes');
          await mkdir(previewDir, { recursive: true });
          const safeFileName = note.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = await join(previewDir, `preview_${safeFileName}`);
          await writeFile(filePath, pdfData);

          const assetUrl = convertFileSrc(filePath);
          previewFrame.src = assetUrl;
          previewFrame.classList.remove('hidden');
          fallback.classList.add('hidden');
          if (viewerLoading) viewerLoading.classList.add('hidden');
          state._previewTempFile = filePath;
        }
      } catch (err) {
        console.error('[PREVIEW] Failed to load PDF:', err);
        if (viewerLoading) viewerLoading.classList.add('hidden');
        previewFrame.classList.add('hidden');
        fallback.classList.remove('hidden');
        fallback.innerHTML = `
          <span class="material-symbols-rounded">error_outline</span>
          <p>Failed to load preview</p>
          <button class="btn btn-secondary" onclick="openNoteExternal(state.currentNote)">
            <span class="material-symbols-rounded">open_in_new</span>
            Open in Browser
          </button>
        `;
      }
    } else if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      // DOCX can't be rendered natively — show a friendly fallback
      if (viewerLoading) viewerLoading.classList.add('hidden');
      previewFrame.classList.add('hidden');
      fallback.classList.remove('hidden');
      fallback.innerHTML = `
        <span class="material-symbols-rounded">description</span>
        <p>Word documents can't be previewed in-app</p>
        <button class="btn btn-secondary" onclick="openNoteExternal(state.currentNote)">
          <span class="material-symbols-rounded">open_in_new</span>
          Open in Browser
        </button>
      `;
    } else {
      // Unknown format — show fallback
      if (viewerLoading) viewerLoading.classList.add('hidden');
      previewFrame.classList.add('hidden');
      fallback.classList.remove('hidden');
      fallback.innerHTML = `
        <span class="material-symbols-rounded">description</span>
        <p>Preview not available for this format</p>
      `;
    }
  } else {
    if (viewerLoading) viewerLoading.classList.add('hidden');
    previewFrame.classList.add('hidden');
    fallback.classList.remove('hidden');
    fallback.innerHTML = `
      <span class="material-symbols-rounded">description</span>
      <p>Preview not available</p>
    `;
  }
  
  overlay.classList.remove('hidden');
  
  // Track view and update count instantly
  api.incrementViews(note.name);
  const newViews = (views || 0) + 1;
  document.getElementById('modal-views').textContent = formatNumber(newViews);
  // Also update the note object so it's reflected if the card is re-rendered
  if (note.v !== undefined) note.v = newViews;
  else if (note.views !== undefined) note.views = newViews;
}

function closeNoteModal() {
  const overlay = document.getElementById('note-modal');
  if (overlay) {
    overlay.classList.add('hidden');
    overlay.classList.remove('fullview');
    const frame = document.getElementById('modal-preview-frame');
    if (frame) frame.src = 'about:blank';
    // Clean up blob URL to free memory
    if (state._previewBlobUrl) {
      URL.revokeObjectURL(state._previewBlobUrl);
      state._previewBlobUrl = null;
    }
    // Clean up temp preview file (fire-and-forget)
    if (state._previewTempFile && window.__TAURI__) {
      import('@tauri-apps/plugin-fs').then(({ remove }) => {
        if (remove) remove(state._previewTempFile).catch(() => {});
      }).catch(() => {});
      state._previewTempFile = null;
    }
  }
  state.currentNote = null;
}

// Download note file to user's system
async function downloadNoteFile(note) {
  if (!note || !note.dl) {
    showToast('Download URL not available', 'error');
    return;
  }
  
  try {
    if (window.__TAURI__) {
      // Use Tauri shell to open the download URL in the default browser
      // This lets the browser handle the actual download
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(note.dl);
    } else {
      // Web fallback - trigger download via anchor tag
      const a = document.createElement('a');
      a.href = note.dl;
      a.download = note.name || 'download';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    api.incrementDownloads(note.name);
    showToast('Download started', 'success');
  } catch (err) {
    console.error('[DOWNLOAD] Error:', err);
    showToast('Failed to start download', 'error');
  }
}

// Open note in external application
async function openNoteExternal(note) {
  if (!note) return;
  
  try {
    if (window.__TAURI__) {
      const { open } = await import('@tauri-apps/plugin-shell');
      const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
      const { tempDir, join } = await import('@tauri-apps/api/path');

      showToast('Preparing file...', 'info');

      // Get binary data — prefer offline cache, otherwise fetch
      let data;
      const offlineCopy = state.savedNotes.find(n => n.name === note.name);
      if (offlineCopy && offlineCopy.cachedFile) {
        const blob = storage.base64ToBlob(offlineCopy.cachedFile);
        data = new Uint8Array(await blob.arrayBuffer());
      } else if (note.dl) {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        const response = await tauriFetch(note.dl, { method: 'GET' });
        const ab = await response.arrayBuffer();
        data = new Uint8Array(ab);
      } else {
        showToast('Download URL not available', 'error');
        return;
      }

      // Write to temp directory and open with default app
      const tmp = await tempDir();
      const openDir = await join(tmp, 'opennotes');
      await mkdir(openDir, { recursive: true });
      const filePath = await join(openDir, note.name);
      await writeFile(filePath, data);
      await open(filePath);
      showToast('Opened in default app', 'success');
    } else {
      window.open(note.dl, '_blank');
    }
  } catch (err) {
    console.error('[OPEN] Error:', err);
    showToast('Failed to open file', 'error');
  }
}

// Share note
function shareNote(note) {
  if (!note) return;
  
  const shareUrl = `https://nagusamecs.github.io/OpenNotesAPI/?note=${encodeURIComponent(note.name)}`;
  const shareText = `Check out "${note.name}" on OpenNotes!`;
  
  // Try native share API first
  if (navigator.share) {
    navigator.share({
      title: note.name,
      text: shareText,
      url: shareUrl
    }).catch(() => {
      // Fallback to clipboard
      copyToClipboard(shareUrl);
    });
  } else {
    // Fallback to clipboard
    copyToClipboard(shareUrl);
  }
}

// Copy to clipboard helper
function copyToClipboard(text) {
  const fallback = () => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      showToast(ok ? 'Link copied to clipboard!' : 'Failed to copy link', ok ? 'success' : 'error');
    } catch {
      showToast('Failed to copy link', 'error');
    }
    document.body.removeChild(textarea);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Link copied to clipboard!', 'success');
    }).catch(() => fallback());
  } else {
    fallback();
  }
}

async function openOfflineNote(name) {
  const note = state.savedNotes.find(n => n.name === name);
  if (!note) {
    showToast('File not available offline', 'error');
    return;
  }
  
  // Open in the in-app viewer (same as openNoteModal but uses cached data)
  state.currentNote = note;
  const overlay = document.getElementById('note-modal');
  if (!overlay) return;
  
  // Populate metadata
  const author = note.auth || note.author || 'Unknown';
  const views = note.v || note.views || 0;
  const downloads = note.d || note.downloads || 0;
  const format = getFileFormat(note.name);
  
  document.getElementById('modal-title').textContent = note.title || note.name;
  document.getElementById('modal-author').textContent = author;
  const formatEl = document.getElementById('modal-format');
  formatEl.textContent = format.toUpperCase();
  formatEl.className = `viewer-pill ${format}`;
  document.getElementById('modal-views').textContent = formatNumber(views);
  document.getElementById('modal-downloads').textContent = formatNumber(downloads);
  document.getElementById('modal-size').textContent = note.fileSize ? formatBytes(note.fileSize) : '--';
  
  // Always show as downloaded
  const downloadBtn = document.getElementById('modal-download');
  if (downloadBtn) {
    downloadBtn.innerHTML = '<span class="material-symbols-rounded">download_done</span> Downloaded';
  }
  
  const previewFrame = document.getElementById('modal-preview-frame');
  const fallback = document.getElementById('modal-preview-fallback');
  const viewerLoading = document.getElementById('viewer-loading');
  
  if (viewerLoading) viewerLoading.classList.remove('hidden');
  
  if (note.cachedFile) {
    const blob = storage.base64ToBlob(note.cachedFile);
    if (window.__TAURI__ && note.name.toLowerCase().endsWith('.pdf')) {
      // Write to temp file and use asset protocol (WebKit can't render blob: PDFs)
      try {
        const pdfData = new Uint8Array(await blob.arrayBuffer());
        const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
        const { tempDir, join } = await import('@tauri-apps/api/path');
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const tmp = await tempDir();
        const previewDir = await join(tmp, 'opennotes');
        await mkdir(previewDir, { recursive: true });
        const safeFileName = note.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = await join(previewDir, `preview_${safeFileName}`);
        await writeFile(filePath, pdfData);
        previewFrame.src = convertFileSrc(filePath);
        previewFrame.classList.remove('hidden');
        fallback.classList.add('hidden');
        if (viewerLoading) viewerLoading.classList.add('hidden');
        state._previewTempFile = filePath;
      } catch (e) {
        console.error('[OFFLINE PREVIEW] Failed:', e);
        if (viewerLoading) viewerLoading.classList.add('hidden');
        previewFrame.classList.add('hidden');
        fallback.classList.remove('hidden');
        fallback.innerHTML = '<span class="material-symbols-rounded">error_outline</span><p>Failed to load preview</p>';
      }
    } else {
      // Non-Tauri or non-PDF: use blob URL
      const blobUrl = URL.createObjectURL(blob);
      previewFrame.src = blobUrl;
      previewFrame.classList.remove('hidden');
      fallback.classList.add('hidden');
      if (viewerLoading) viewerLoading.classList.add('hidden');
      state._previewBlobUrl = blobUrl;
    }
  } else {
    if (viewerLoading) viewerLoading.classList.add('hidden');
    previewFrame.classList.add('hidden');
    fallback.classList.remove('hidden');
    fallback.innerHTML = '<span class="material-symbols-rounded">error_outline</span><p>Cached file not found</p>';
  }
  
  overlay.classList.remove('hidden');
}

// ==================== VIEW SWITCHING ====================
function switchView(viewId) {
  // Upload and My Uploads just show their placeholder views (with "Open Web Client" button)
  
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });
  
  // Update views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewId}`);
  });
  
  // Update title
  const titles = {
    browse: 'All Notes',
    recent: 'Recent',
    downloads: 'Downloads',
    editor: 'New Document',
    upload: 'Upload Notes',
    storage: 'Storage',
    'quiz-browse': 'Problem Sets',
    'quiz-create': 'Create Problem Set',
    'quiz-take': 'Problem Set',
    'quiz-results': 'Results',
  };
  
  document.getElementById('view-title').textContent = titles[viewId] || 'OpenNotes';
  state.activeView = viewId;
  
  // Load data for specific views
  if (viewId === 'browse' && state.notes.length === 0) loadNotes();
  if (viewId === 'recent') loadRecent();
  if (viewId === 'downloads') renderDownloads();
  if (viewId === 'storage') {
    storage.updateStorageIndicator();
    renderStorageBreakdown();
  }
  if (viewId === 'quiz-browse') loadQuizzes();
  if (viewId === 'quiz-create') renderQuestionsList();
}

// Alias for quiz system
function showView(viewId) {
  switchView(viewId);
}

// ==================== EDITOR ====================
const editor = {
  init() {
    const editorEl = document.getElementById('editor');
    const previewEl = document.getElementById('preview');
    const togglePreview = document.getElementById('toggle-preview');
    const toggleRaw = document.getElementById('toggle-raw');
    
    if (!editorEl) return;
    
    // Toolbar actions
    document.querySelectorAll('.tool-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.execAction(btn.dataset.action);
      });
    });
    
    // Word count
    editorEl.addEventListener('input', () => {
      const text = editorEl.innerText;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      document.getElementById('word-count').textContent = `${words} words`;
    });
    
    // Preview toggle
    if (togglePreview) {
      togglePreview.addEventListener('click', () => {
        previewEl.classList.toggle('hidden');
        togglePreview.classList.toggle('active');
        
        if (!previewEl.classList.contains('hidden')) {
          this.updatePreview();
        }
      });
    }
    
    // Save draft
    document.getElementById('save-draft')?.addEventListener('click', () => {
      const title = document.getElementById('doc-title').value || 'Untitled';
      const content = editorEl.innerHTML;
      
      storage.set('draft', { title, content, savedAt: Date.now() });
      showToast('Draft saved', 'success');
    });
    
    // Export
    document.getElementById('export-doc')?.addEventListener('click', () => {
      this.exportDocument();
    });
    
    // Upload to OpenNotes (opens web client)
    document.getElementById('upload-doc')?.addEventListener('click', () => {
      openWebClient();
    });
    
    // Load saved draft
    const draft = storage.get('draft');
    if (draft) {
      document.getElementById('doc-title').value = draft.title;
      editorEl.innerHTML = draft.content;
    }
  },
  
  execAction(action) {
    const editorEl = document.getElementById('editor');
    editorEl.focus();
    
    switch (action) {
      case 'bold':
        document.execCommand('bold');
        break;
      case 'italic':
        document.execCommand('italic');
        break;
      case 'underline':
        document.execCommand('underline');
        break;
      case 'strikethrough':
        document.execCommand('strikethrough');
        break;
      case 'heading1':
        document.execCommand('formatBlock', false, 'h1');
        break;
      case 'heading2':
        document.execCommand('formatBlock', false, 'h2');
        break;
      case 'heading3':
        document.execCommand('formatBlock', false, 'h3');
        break;
      case 'bullet-list':
        document.execCommand('insertUnorderedList');
        break;
      case 'numbered-list':
        document.execCommand('insertOrderedList');
        break;
      case 'task-list':
        this.insertTaskList();
        break;
      case 'math':
        this.insertMath();
        break;
      case 'code':
        this.insertCodeBlock();
        break;
      case 'table':
        this.insertTable();
        break;
      case 'link':
        this.insertLink();
        break;
    }
  },
  
  insertMath() {
    // Insert a live editable math-field so the user never types raw LaTeX
    const id = 'mf-' + Date.now();
    document.execCommand('insertHTML', false,
      `<math-field id="${id}" style="display:inline-block;vertical-align:middle;min-width:60px;border:1.5px solid var(--accent);border-radius:6px;padding:2px 6px;font-size:1rem;"></math-field>&nbsp;`);
    // Focus the new math-field so user can start typing immediately
    requestAnimationFrame(() => {
      const mf = document.getElementById(id);
      if (mf) {
        mf.focus();
        // When focus leaves, lock it to read-only and remove the editing border
        const finalize = () => {
          mf.removeEventListener('focusout', finalize);
          if (!mf.value || !mf.value.trim()) {
            mf.remove(); // Remove empty math fields
          } else {
            mf.setAttribute('read-only', '');
            mf.style.border = 'none';
            mf.style.padding = '0';
            // Double-click to re-edit
            mf.addEventListener('dblclick', () => {
              mf.removeAttribute('read-only');
              mf.style.border = '1.5px solid var(--accent)';
              mf.style.padding = '2px 6px';
              mf.focus();
              mf.addEventListener('focusout', finalize, { once: true });
            });
          }
        };
        mf.addEventListener('focusout', finalize, { once: true });
      }
    });
  },
  
  insertCodeBlock() {
    document.execCommand('insertHTML', false, 
      `<pre><code>// Your code here</code></pre><p></p>`);
  },
  
  insertTable() {
    const html = `
      <table border="1" style="border-collapse: collapse; width: 100%;">
        <tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr>
        <tr><td>Cell 1</td><td>Cell 2</td><td>Cell 3</td></tr>
        <tr><td>Cell 4</td><td>Cell 5</td><td>Cell 6</td></tr>
      </table><p></p>
    `;
    document.execCommand('insertHTML', false, html);
  },
  
  insertLink() {
    const url = prompt('Enter URL:');
    if (url) {
      document.execCommand('createLink', false, url);
    }
  },
  
  insertTaskList() {
    document.execCommand('insertUnorderedList');
    const selection = window.getSelection();
    if (selection.anchorNode) {
      let node = selection.anchorNode;
      while (node && node.tagName !== 'UL') {
        node = node.parentElement;
      }
      if (node) {
        node.classList.add('task-list');
      }
    }
  },
  
  updatePreview() {
    const editorEl = document.getElementById('editor');
    const previewEl = document.getElementById('preview');
    
    if (previewEl && typeof marked !== 'undefined') {
      const html = editorEl.innerHTML;
      previewEl.innerHTML = DOMPurify.sanitize(html);
    }
  },
  
  exportDocument() {
    const title = document.getElementById('doc-title').value || 'Untitled';
    const content = document.getElementById('editor').innerHTML;
    
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { font-size: 2rem; }
    h2 { font-size: 1.5rem; }
    h3 { font-size: 1.25rem; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { font-family: monospace; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${content}
</body>
</html>`;
    
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.html`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('Document exported', 'success');
  },
  
  uploadDocument() {
    openWebClient();
  },
};

// ==================== UTILITIES ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileFormat(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'docx';
  if (['ppt', 'pptx'].includes(ext)) return 'pptx';
  if (['xls', 'xlsx'].includes(ext)) return 'xlsx';
  if (['txt'].includes(ext)) return 'txt';
  if (['md', 'markdown'].includes(ext)) return 'md';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images';
  return 'other';
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="material-symbols-rounded toast-icon">${
      type === 'success' ? 'check_circle' :
      type === 'error' ? 'error' :
      'info'
    }</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close"><span class="material-symbols-rounded" style="font-size:16px;">close</span></button>
  `;
  
  const dismiss = () => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  };
  
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  
  setTimeout(dismiss, 3000);
}

// ==================== THEME ====================
function toggleTheme() {
  state.isDarkMode = !state.isDarkMode;
  document.body.classList.toggle('dark-mode', state.isDarkMode);
  storage.set('dark_mode', state.isDarkMode);
  
  const icon = document.querySelector('#theme-toggle .material-symbols-rounded');
  if (icon) icon.textContent = state.isDarkMode ? 'light_mode' : 'dark_mode';
}

function initTheme() {
  const savedTheme = storage.get('dark_mode');
  if (savedTheme || (savedTheme === null && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    state.isDarkMode = true;
    document.body.classList.add('dark-mode');
    const icon = document.querySelector('#theme-toggle .material-symbols-rounded');
    if (icon) icon.textContent = 'light_mode';
  }
}

// ==================== SEARCH ====================
let searchTimeout;
function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;
  
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value;
      state.currentPage = 1;
      loadNotes();
    }, 300);
  });
}

// ==================== CONTENT PREVIEW ====================
async function fetchNoteContent(filename) {
  const contentUrl = `${CONFIG.NOTES_RAW_BASE}/${encodeURIComponent(filename)}`;
  try {
    const response = await fetch(contentUrl);
    if (!response.ok) throw new Error('Content not found');
    return {
      url: contentUrl,
      blob: await response.blob(),
    };
  } catch (error) {
    console.error('[CONTENT] Failed to fetch:', error);
    return null;
  }
}

// ==================== API CACHING ====================
function getCachedNotes() {
  const cached = localStorage.getItem(`${CONFIG.STORAGE_KEY}_notes_cache`);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      // Cache valid for 5 minutes
      if (Date.now() - data.timestamp < 5 * 60 * 1000) {
        return data.notes;
      }
    } catch (e) {
      console.error('[CACHE] Failed to parse cache:', e);
    }
  }
  return null;
}

function setCachedNotes(notes) {
  localStorage.setItem(`${CONFIG.STORAGE_KEY}_notes_cache`, JSON.stringify({
    notes,
    timestamp: Date.now(),
  }));
  state.cachedNotes = notes;
}

function clearNotesCache() {
  localStorage.removeItem(`${CONFIG.STORAGE_KEY}_notes_cache`);
  state.cachedNotes = [];
}

async function refreshNotes() {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('spinning');
  
  clearNotesCache();
  await loadNotes(true);
  
  if (refreshBtn) refreshBtn.classList.remove('spinning');
  showToast('Notes refreshed', 'success');
}

// ==================== OPEN WEB CLIENT ====================
async function openWebClient(path = '') {
  const url = 'https://opennotes.pages.dev' + path;
  try {
    if (window.__TAURI__) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } else {
      window.open(url, '_blank');
    }
  } catch (e) {
    window.open(url, '_blank');
  }
}

// ==================== INITIALIZATION ====================
async function init() {
  console.log('[INIT] OpenNotes Desktop initializing...');
  console.log('[INIT] User Agent:', navigator.userAgent);
  console.log('[INIT] window.__TAURI__:', typeof window.__TAURI__, window.__TAURI__);
  
  try {
    // Load secrets from Tauri store first
    console.log('[INIT] Loading secrets...');
    await loadSecrets();
    console.log('[INIT] Secrets loaded');
    
    // Initialize HTTP client for API calls (to set custom headers)
    console.log('[INIT] Initializing HTTP client...');
    await initHttpClient();
    console.log('[INIT] HTTP client ready, tauriInvoke =', !!tauriInvoke);
    
    // Initialize theme
    initTheme();
    console.log('[INIT] Theme initialized');
    
    // Initialize search
    initSearch();
    console.log('[INIT] Search initialized');
  
  // Initialize storage indicator
  state.savedNotes = storage.getSavedNotes();
  storage.updateStorageIndicator();
  
  // Initialize editor
  editor.init();
  
  // Set up web client button for upload view
  document.getElementById('open-web-upload')?.addEventListener('click', () => openWebClient());
  
  // Initialize quiz system
  initQuizListeners();
  initSvgBuilder();
  console.log('[INIT] Quiz system initialized');
  
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });
  
  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentFilter = chip.dataset.format;
      state.currentPage = 1;
      loadNotes();
    });
  });
  
  // Sort select
  document.getElementById('sort-select')?.addEventListener('change', (e) => {
    state.currentSort = e.target.value;
    state.currentPage = 1;
    loadNotes();
  });
  
  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  
  // Modal close
  document.getElementById('modal-close')?.addEventListener('click', closeNoteModal);
  
  // Modal download (saves for offline access)
  document.getElementById('modal-download')?.addEventListener('click', async () => {
    if (!state.currentNote) return;
    const btn = document.getElementById('modal-download');
    const origHTML = btn?.innerHTML;
    try {
      // Show downloading state
      if (btn) btn.innerHTML = `<span class="material-symbols-rounded">hourglass_top</span> Downloading...`;
      const success = await storage.saveNoteOffline(state.currentNote);
      if (success && btn) {
        btn.innerHTML = `<span class="material-symbols-rounded">download_done</span> Downloaded`;
      } else if (btn) {
        btn.innerHTML = origHTML; // restore on "already downloaded" or failure
      }
    } catch (err) {
      console.error('[DOWNLOAD] Handler error:', err);
      showToast('Download failed', 'error');
      if (btn) btn.innerHTML = origHTML;
    }
  });
  
  // Modal open external (opens in system default editor)
  document.getElementById('modal-open-external')?.addEventListener('click', async () => {
    if (state.currentNote) {
      await openNoteExternal(state.currentNote);
    }
  });
  
  // Modal full view (expand preview to fill the overlay)
  document.getElementById('modal-view-full')?.addEventListener('click', () => {
    const overlay = document.getElementById('note-modal');
    if (overlay) overlay.classList.toggle('fullview');
  });
  
  // Modal share
  document.getElementById('modal-share')?.addEventListener('click', () => {
    if (state.currentNote) {
      shareNote(state.currentNote);
    }
  });
  
  // Storage actions
  document.getElementById('clear-cache')?.addEventListener('click', () => {
    if (confirm('Clear cache? Saved offline notes will be kept.')) {
      storage.clearCache();
    }
  });
  
  document.getElementById('clear-all')?.addEventListener('click', () => {
    if (confirm('Clear all offline data? This cannot be undone.')) {
      storage.clearAll();
    }
  });
  
  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });
  
  // Window controls (custom title bar)
  setupWindowControls();

  async function setupWindowControls() {
    // Setup window controls for Tauri custom title bar
    if (window.__TAURI__) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        
        document.getElementById('minimize-btn')?.addEventListener('click', () => appWindow.minimize());
        document.getElementById('maximize-btn')?.addEventListener('click', () => appWindow.toggleMaximize());
        document.getElementById('close-btn')?.addEventListener('click', () => appWindow.close());
        
        console.log('[INIT] Window controls initialized');
      } catch (e) {
        console.log('[INIT] Window controls not available:', e.message);
      }
    }
  }
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeNoteModal();
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('dev-console')?.classList.add('hidden');
    }
    // Cmd/Ctrl + ` to toggle dev console
    if ((e.metaKey || e.ctrlKey) && e.key === '`') {
      e.preventDefault();
      toggleDevConsole();
    }
    // Cmd/Ctrl + K to focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    }
    // Quiz keyboard shortcuts (only when taking a quiz)
    if (state.activeView === 'quiz-take' && quizState.currentQuiz) {
      const question = quizState.currentQuiz.questions[quizState.currentQuestionIndex];
      // Arrow keys for navigation
      if (e.key === 'ArrowLeft' && !e.metaKey && !e.ctrlKey) {
        navigateQuiz(-1);
      }
      if (e.key === 'ArrowRight' && !e.metaKey && !e.ctrlKey) {
        navigateQuiz(1);
      }
      // Number keys 1-9 to select MCQ options
      if (question?.type === 'mcq' && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (question.options && idx < question.options.length) {
          selectMCQOption(question.id, idx, question.correctAnswers.length > 1);
        }
      }
    }
  });
  
  // Load initial data
  console.log('[INIT] Loading initial notes...');
  loadNotes();
  
  // Purge expired downloads
  storage.purgeExpiredDownloads();
  
  console.log('[INIT] OpenNotes Desktop ready!');
  } catch (initError) {
    console.error('[INIT] Critical initialization error:', initError);
    console.error('[INIT] Error stack:', initError.stack);
    const container = document.getElementById('notes-grid');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-rounded">error</span>
          <h3>Initialization Failed</h3>
          <p>The app failed to start properly</p>
          <details style="margin-top: 16px; text-align: left; max-width: 400px;">
            <summary style="cursor: pointer;">Error Details</summary>
            <pre style="margin-top: 8px; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;">${initError.message}\n${initError.stack}</pre>
          </details>
        </div>
      `;
    }
  }
}

// Settings management
async function saveSettings(gatewayUrl, appToken) {
  try {
    if (window.__TAURI__) {
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = new Store('secrets.json');
      
      await store.set('gateway_url', gatewayUrl);
      await store.set('app_token', appToken);
      await store.save();
      
      CONFIG.GATEWAY_URL = gatewayUrl;
      CONFIG.APP_TOKEN = appToken;
      
      showToast('Settings saved', 'success');
      loadNotes(); // Reload with new settings
    }
  } catch (e) {
    console.error('Failed to save settings:', e);
    showToast('Failed to save settings', 'error');
  }
}

// Make functions globally accessible
window.openNoteModal = openNoteModal;
window.closeNoteModal = closeNoteModal;
window.openOfflineNote = openOfflineNote;
window.storage = storage;
window.showToast = showToast;
window.loadNotes = loadNotes;
window.loadMoreNotes = loadMoreNotes;
window.loadAllNotes = loadAllNotes;
window.saveSettings = saveSettings;

// ==================== QUIZ SYSTEM ====================

const quizState = {
  quizzes: [],
  selectedQuizIds: new Set(),
  currentQuiz: null,
  currentQuestionIndex: 0,
  answers: {},
  submittedQuestions: {},
  creatorQuestions: [],
  timerInterval: null,
  timerSeconds: 0,
  reviewMode: false,
  _matchingSelected: undefined,
};

// Quiz API Client
const quizApi = {
  async listQuizzes(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.subject) params.set('subject', filters.subject);
      if (filters.topic) params.set('topic', filters.topic);
      if (filters.search) params.set('q', filters.search);
      
      const response = await httpFetch(`${CONFIG.GATEWAY_URL}/api/quizzes?${params}`);
      if (!response.ok) throw new Error('Failed to fetch quizzes');
      return await response.json();
    } catch (e) {
      console.error('[Quiz API] List error:', e);
      throw e;
    }
  },
  
  async getQuiz(id) {
    try {
      const response = await httpFetch(`${CONFIG.GATEWAY_URL}/api/quizzes/${id}`);
      if (!response.ok) throw new Error('Quiz not found');
      return await response.json();
    } catch (e) {
      console.error('[Quiz API] Get error:', e);
      throw e;
    }
  },
  
  async createQuiz(quiz) {
    try {
      const authToken = localStorage.getItem('auth_token_fallback');
      const response = await httpFetch(`${CONFIG.GATEWAY_URL}/api/quizzes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken || '',
        },
        body: JSON.stringify(quiz),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.errors?.join(', ') || error.error || 'Failed to create quiz');
      }
      return await response.json();
    } catch (e) {
      console.error('[Quiz API] Create error:', e);
      throw e;
    }
  },
  
  async shuffleQuizzes(quizIds, options = {}) {
    try {
      const response = await httpFetch(`${CONFIG.GATEWAY_URL}/api/quizzes/shuffle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quizIds,
          questionCount: options.questionCount,
          shuffle: options.shuffle !== false,
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to shuffle quizzes');
      }
      return await response.json();
    } catch (e) {
      console.error('[Quiz API] Shuffle error:', e);
      throw e;
    }
  },
};

// Render LaTeX in text
function renderLatex(text) {
  if (!text) return '';
  // Convert $...$ and $$...$$ to math-field elements  
  return text
    .replace(/\$\$([^$]+)\$\$/g, '<math-field read-only style="display:block;margin:12px 0;">$1</math-field>')
    .replace(/\$([^$]+)\$/g, '<math-field read-only style="display:inline-block;vertical-align:middle;">$1</math-field>');
}

// Load and display quizzes
async function loadQuizzes(filters = {}) {
  const grid = document.getElementById('quiz-grid');
  if (!grid) return;
  
  grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading quizzes...</p></div>';
  
  try {
    const data = await quizApi.listQuizzes(filters);
    quizState.quizzes = data.quizzes || [];
    
    if (quizState.quizzes.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <span class="material-symbols-rounded">quiz</span>
          <h3>No quizzes found</h3>
          <p>Be the first to create a quiz!</p>
        </div>
      `;
      return;
    }
    
    grid.innerHTML = quizState.quizzes.map(quiz => `
      <div class="quiz-card ${quizState.selectedQuizIds.has(quiz.id) ? 'selected' : ''}" data-quiz-id="${quiz.id}">
        <div class="quiz-card-checkbox">
          <span class="material-symbols-rounded">check</span>
        </div>
        <div class="quiz-card-subject">${escapeHtml(quiz.subject)}</div>
        <div class="quiz-card-title">${escapeHtml(quiz.title)}</div>
        ${quiz.topic ? `<div class="quiz-card-topic">${escapeHtml(quiz.topic)}</div>` : ''}
        <div class="quiz-card-meta">
          <span><span class="material-symbols-rounded">help_outline</span> ${quiz.questionCount} questions</span>
        </div>
      </div>
    `).join('');
    
    // Add click handlers
    grid.querySelectorAll('.quiz-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Toggle selection for shuffle
          toggleQuizSelection(card.dataset.quizId);
        } else {
          // Start quiz
          startQuiz(card.dataset.quizId);
        }
      });
    });
    
    // Add card glow effect
    initCardGlow(grid);
  } catch (e) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <span class="material-symbols-rounded">error</span>
        <h3>Failed to load quizzes</h3>
        <p>${e.message}</p>
      </div>
    `;
  }
}

function toggleQuizSelection(quizId) {
  if (quizState.selectedQuizIds.has(quizId)) {
    quizState.selectedQuizIds.delete(quizId);
  } else {
    quizState.selectedQuizIds.add(quizId);
  }
  
  // Update UI
  const card = document.querySelector(`.quiz-card[data-quiz-id="${quizId}"]`);
  if (card) {
    card.classList.toggle('selected', quizState.selectedQuizIds.has(quizId));
  }
  
  // Update shuffle button
  const shuffleBtn = document.getElementById('quiz-shuffle-btn');
  if (shuffleBtn) {
    shuffleBtn.disabled = quizState.selectedQuizIds.size < 2;
    shuffleBtn.innerHTML = quizState.selectedQuizIds.size > 0 
      ? `<span class="material-symbols-rounded">shuffle</span> Shuffle Selected (${quizState.selectedQuizIds.size})`
      : '<span class="material-symbols-rounded">shuffle</span> Shuffle Selected';
  }
}

async function startQuiz(quizId) {
  try {
    showToast('Loading quiz...', 'info');
    const quiz = await quizApi.getQuiz(quizId);
    
    quizState.currentQuiz = quiz;
    quizState.currentQuestionIndex = 0;
    quizState.answers = {};
    quizState.submittedQuestions = {};
    quizState.reviewMode = false;
    quizState._matchingSelected = undefined;
    
    // Start timer
    quizState.timerSeconds = 0;
    clearInterval(quizState.timerInterval);
    quizState.timerInterval = setInterval(() => {
      quizState.timerSeconds++;
      const timerEl = document.getElementById('quiz-timer');
      if (timerEl) {
        const mins = Math.floor(quizState.timerSeconds / 60);
        const secs = quizState.timerSeconds % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);
    
    showView('quiz-take');
    renderQuizQuestion();
  } catch (e) {
    showToast('Failed to load quiz: ' + e.message, 'error');
  }
}

async function shuffleAndStartQuizzes() {
  if (quizState.selectedQuizIds.size < 2) {
    showToast('Select at least 2 quizzes to shuffle', 'error');
    return;
  }
  
  try {
    showToast('Creating shuffled quiz...', 'info');
    const combined = await quizApi.shuffleQuizzes([...quizState.selectedQuizIds]);
    
    quizState.currentQuiz = combined;
    quizState.currentQuestionIndex = 0;
    quizState.answers = {};
    quizState.submittedQuestions = {};
    quizState.reviewMode = false;
    quizState._matchingSelected = undefined;
    quizState.selectedQuizIds.clear();
    
    // Start timer
    quizState.timerSeconds = 0;
    clearInterval(quizState.timerInterval);
    quizState.timerInterval = setInterval(() => {
      quizState.timerSeconds++;
      const timerEl = document.getElementById('quiz-timer');
      if (timerEl) {
        const mins = Math.floor(quizState.timerSeconds / 60);
        const secs = quizState.timerSeconds % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);
    
    showView('quiz-take');
    renderQuizQuestion();
  } catch (e) {
    showToast('Failed to shuffle quizzes: ' + e.message, 'error');
  }
}

function renderQuizQuestion() {
  const container = document.getElementById('quiz-question-container');
  const titleEl = document.getElementById('quiz-player-title');
  const progressEl = document.getElementById('quiz-player-progress');
  const prevBtn = document.getElementById('quiz-prev-btn');
  const nextBtn = document.getElementById('quiz-next-btn');
  const submitAnswerBtn = document.getElementById('quiz-submit-answer-btn');
  const finishBtn = document.getElementById('quiz-submit-btn');
  const progressFill = document.getElementById('quiz-progress-fill');
  const dotsContainer = document.getElementById('quiz-dots');
  const feedbackEl = document.getElementById('quiz-feedback');
  
  if (!container || !quizState.currentQuiz) return;
  
  const quiz = quizState.currentQuiz;
  const question = quiz.questions[quizState.currentQuestionIndex];
  const totalQuestions = quiz.questions.length;
  const currentNum = quizState.currentQuestionIndex + 1;
  const isSubmitted = quizState.submittedQuestions?.[question.id];
  const isReview = quizState.reviewMode;
  
  titleEl.textContent = quiz.title;
  progressEl.textContent = `Question ${currentNum} of ${totalQuestions}`;
  
  // Update progress bar
  if (progressFill) {
    const answeredCount = Object.keys(quizState.submittedQuestions || {}).length;
    progressFill.style.width = `${(answeredCount / totalQuestions) * 100}%`;
  }
  
  // Update question dots
  if (dotsContainer) {
    dotsContainer.innerHTML = quiz.questions.map((q, i) => {
      const isCurrent = i === quizState.currentQuestionIndex;
      const sub = quizState.submittedQuestions?.[q.id];
      let classes = 'quiz-dot';
      if (isCurrent) classes += ' current';
      if (sub) {
        classes += ' submitted';
        if (sub.correct) classes += ' correct-dot';
        else if (sub.correct === false) classes += ' incorrect-dot';
      } else {
        const isAnswered = quizState.answers[q.id] !== undefined && 
          (Array.isArray(quizState.answers[q.id]) ? quizState.answers[q.id].length > 0 : quizState.answers[q.id] !== '');
        if (isAnswered) classes += ' answered';
      }
      return `<button class="${classes}" data-index="${i}" title="Question ${i + 1}"></button>`;
    }).join('');
    
    dotsContainer.querySelectorAll('.quiz-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        quizState.currentQuestionIndex = parseInt(dot.dataset.index);
        renderQuizQuestion();
      });
    });
  }
  
  // Navigation buttons
  prevBtn.disabled = quizState.currentQuestionIndex === 0;
  
  // Hide feedback initially
  if (feedbackEl) feedbackEl.classList.add('hidden');
  
  // Show feedback if already submitted
  if (isSubmitted && feedbackEl) {
    showQuestionFeedback(question, isSubmitted);
  }
  
  // Button visibility: Submit if not yet submitted, Next if submitted, Finish at end
  const allSubmitted = quiz.questions.every(q => quizState.submittedQuestions?.[q.id]);
  const isLast = quizState.currentQuestionIndex === totalQuestions - 1;
  
  if (isReview) {
    submitAnswerBtn.classList.add('hidden');
    nextBtn.classList.toggle('hidden', isLast);
    finishBtn.classList.toggle('hidden', !isLast);
    finishBtn.innerHTML = '<span class="material-symbols-rounded">arrow_back</span> Back to Results';
    finishBtn.onclick = () => { quizState.reviewMode = false; showView('quiz-results'); };
  } else if (isSubmitted) {
    submitAnswerBtn.classList.add('hidden');
    if (isLast && allSubmitted) {
      nextBtn.classList.add('hidden');
      finishBtn.classList.remove('hidden');
      finishBtn.innerHTML = '<span class="material-symbols-rounded">done_all</span> Finish';
      finishBtn.onclick = submitQuiz;
    } else {
      nextBtn.classList.remove('hidden');
      finishBtn.classList.add('hidden');
    }
  } else {
    submitAnswerBtn.classList.remove('hidden');
    nextBtn.classList.add('hidden');
    finishBtn.classList.add('hidden');
  }
  
  // Get current answer
  const currentAnswer = quizState.answers[question.id];
  const showCorrect = isSubmitted || isReview;
  
  if (question.type === 'mcq') {
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      ${question.svg ? `<div class="quiz-question-svg">${question.svg}</div>` : ''}
      <div class="quiz-options">
        ${question.options.map((opt, i) => {
          const isSelected = currentAnswer?.includes(i);
          const isCorrect = question.correctAnswers.includes(i);
          let classes = 'quiz-option';
          if (showCorrect) {
            if (isCorrect) classes += ' correct';
            else if (isSelected && !isCorrect) classes += ' incorrect';
          } else {
            if (isSelected) classes += ' selected';
          }
          return `
          <div class="${classes}" data-index="${i}" tabindex="-1">
            <div class="quiz-option-marker">
              <span class="material-symbols-rounded" style="font-size:14px;">${showCorrect ? (isCorrect ? 'check' : (isSelected ? 'close' : '')) : (isSelected ? 'check' : '')}</span>
            </div>
            <div class="quiz-option-text">${renderLatex(opt)}</div>
          </div>`;
        }).join('')}
      </div>
      ${!showCorrect && question.correctAnswers.length > 1 ? '<p style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);">Select all that apply</p>' : ''}
      ${showCorrect && question.explanation ? `<div class="quiz-explanation"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(question.explanation)}</div>` : ''}
    `;
    
    if (!showCorrect) {
      container.querySelectorAll('.quiz-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const idx = parseInt(opt.dataset.index);
          selectMCQOption(question.id, idx, question.correctAnswers.length > 1);
        });
      });
    }
  } else if (question.type === 'tf') {
    const userVal = currentAnswer;
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      ${question.svg ? `<div class="quiz-question-svg">${question.svg}</div>` : ''}
      <div class="quiz-tf-options">
        ${['True', 'False'].map(val => {
          const boolVal = val === 'True';
          const isSelected = userVal === boolVal;
          const isCorrectAnswer = question.correctAnswer === boolVal;
          let classes = 'quiz-tf-option';
          if (showCorrect) {
            if (isCorrectAnswer) classes += ' correct';
            else if (isSelected && !isCorrectAnswer) classes += ' incorrect';
          } else {
            if (isSelected) classes += ' selected';
          }
          return `<div class="${classes}" data-value="${boolVal}" tabindex="-1">${val}</div>`;
        }).join('')}
      </div>
      ${showCorrect && question.explanation ? `<div class="quiz-explanation"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(question.explanation)}</div>` : ''}
    `;
    
    if (!showCorrect) {
      container.querySelectorAll('.quiz-tf-option').forEach(opt => {
        opt.addEventListener('click', () => {
          quizState.answers[question.id] = opt.dataset.value === 'true';
          container.querySelectorAll('.quiz-tf-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
        });
      });
    }
  } else if (question.type === 'fitb') {
    // Fill in the blank — render question with blank inputs
    let questionHtml = renderLatex(question.question);
    const blanks = question.blanks || question.correctAnswers || [];
    blanks.forEach((_, i) => {
      const val = (currentAnswer && currentAnswer[i]) || '';
      const extraClass = showCorrect ? (val.toLowerCase().trim() === blanks[i].toLowerCase().trim() ? 'correct' : 'incorrect') : '';
      questionHtml = questionHtml.replace('___', `<input type="text" class="quiz-fitb-input ${extraClass}" data-blank="${i}" value="${val}" ${showCorrect ? 'disabled' : ''} placeholder="...">`);
    });
    container.innerHTML = `
      <div class="quiz-question-text">${questionHtml}</div>
      ${question.svg ? `<div class="quiz-question-svg">${question.svg}</div>` : ''}
      ${showCorrect ? `<p style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);">Answers: ${blanks.join(', ')}</p>` : ''}
      ${showCorrect && question.explanation ? `<div class="quiz-explanation"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(question.explanation)}</div>` : ''}
    `;
    
    if (!showCorrect) {
      container.querySelectorAll('.quiz-fitb-input').forEach(input => {
        input.addEventListener('input', () => {
          if (!quizState.answers[question.id]) quizState.answers[question.id] = [];
          quizState.answers[question.id][parseInt(input.dataset.blank)] = input.value;
        });
      });
      // Focus first blank
      const firstBlank = container.querySelector('.quiz-fitb-input');
      if (firstBlank) firstBlank.focus();
    }
  } else if (question.type === 'matching') {
    // Matching: user pairs items from left column with right column
    const pairs = currentAnswer || {};
    const leftItems = question.leftItems || [];
    const rightItems = question.rightItems || [];
    
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      ${question.svg ? `<div class="quiz-question-svg">${question.svg}</div>` : ''}
      <div class="quiz-matching-container">
        <div class="quiz-matching-column">
          <h4>Terms</h4>
          ${leftItems.map((item, i) => {
            const isPaired = pairs[i] !== undefined;
            let classes = 'quiz-matching-item';
            if (isPaired) classes += ' matched';
            if (quizState._matchingSelected === i) classes += ' selected-match';
            if (showCorrect) {
              classes = 'quiz-matching-item';
              if (pairs[i] === question.correctPairs[i]) classes += ' correct';
              else classes += ' incorrect';
            }
            return `<div class="${classes}" data-left="${i}">${renderLatex(item)}</div>`;
          }).join('')}
        </div>
        <div class="quiz-matching-column">
          <h4>Definitions</h4>
          ${rightItems.map((item, i) => {
            const isPaired = Object.values(pairs).includes(i);
            let classes = 'quiz-matching-item';
            if (isPaired) classes += ' matched';
            return `<div class="${classes}" data-right="${i}">${renderLatex(item)}</div>`;
          }).join('')}
        </div>
      </div>
      ${Object.keys(pairs).length > 0 ? `
        <div class="quiz-matching-pairs">
          ${Object.entries(pairs).map(([l, r]) => `
            <div class="quiz-matching-pair">
              <span>${renderLatex(leftItems[l])}</span>
              <span class="material-symbols-rounded" style="font-size:16px;">arrow_forward</span>
              <span>${renderLatex(rightItems[r])}</span>
              ${!showCorrect ? `<span class="material-symbols-rounded remove-pair" data-left="${l}" style="cursor:pointer;">close</span>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${showCorrect && question.explanation ? `<div class="quiz-explanation"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(question.explanation)}</div>` : ''}
    `;
    
    if (!showCorrect) {
      container.querySelectorAll('.quiz-matching-item[data-left]').forEach(el => {
        el.addEventListener('click', () => {
          quizState._matchingSelected = parseInt(el.dataset.left);
          renderQuizQuestion();
        });
      });
      container.querySelectorAll('.quiz-matching-item[data-right]').forEach(el => {
        el.addEventListener('click', () => {
          if (quizState._matchingSelected !== undefined) {
            if (!quizState.answers[question.id]) quizState.answers[question.id] = {};
            quizState.answers[question.id][quizState._matchingSelected] = parseInt(el.dataset.right);
            quizState._matchingSelected = undefined;
            renderQuizQuestion();
          }
        });
      });
      container.querySelectorAll('.remove-pair').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          delete quizState.answers[question.id][el.dataset.left];
          renderQuizQuestion();
        });
      });
    }
  } else if (question.type === 'frq') {
    const userAnswer = currentAnswer || '';
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      ${question.svg ? `<div class="quiz-question-svg">${question.svg}</div>` : ''}
      <textarea class="quiz-frq-input" placeholder="Write your answer..." ${showCorrect ? 'disabled' : ''} rows="4">${userAnswer}</textarea>
      ${!showCorrect ? '<p style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);">Free response — you\'ll self-evaluate after submitting</p>' : ''}
      ${showCorrect && question.explanation ? `<div class="quiz-explanation"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(question.explanation)}</div>` : ''}
    `;
    
    if (!showCorrect) {
      const textarea = container.querySelector('.quiz-frq-input');
      textarea.addEventListener('input', (e) => {
        quizState.answers[question.id] = e.target.value;
      });
      textarea.focus();
    }
  }
}

function showQuestionFeedback(question, result) {
  const feedbackEl = document.getElementById('quiz-feedback');
  if (!feedbackEl) return;
  
  feedbackEl.classList.remove('hidden', 'correct', 'incorrect', 'self-eval');
  
  if (question.type === 'frq' && result.selfEval) {
    feedbackEl.classList.add('self-eval');
    feedbackEl.innerHTML = `
      <div class="quiz-feedback-header">
        <span class="material-symbols-rounded">rate_review</span>
        <span>Self Evaluation</span>
      </div>
      <div>
        ${question.correctAnswers?.length ? `<p><strong>Model answer:</strong> ${renderLatex(question.correctAnswers.join(' / '))}</p>` : ''}
        ${question.explanation ? `<p>${renderLatex(question.explanation)}</p>` : ''}
      </div>
      <div class="self-eval-buttons">
        <button class="self-eval-btn ${result.correct === true ? 'selected' : ''}" data-eval="correct">
          <span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;">check_circle</span> I got it right
        </button>
        <button class="self-eval-btn ${result.correct === false ? 'selected' : ''}" data-eval="incorrect">
          <span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;">cancel</span> I got it wrong
        </button>
      </div>
    `;
    feedbackEl.querySelectorAll('.self-eval-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCorrect = btn.dataset.eval === 'correct';
        quizState.submittedQuestions[question.id].correct = isCorrect;
        feedbackEl.querySelectorAll('.self-eval-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        // Refresh dots
        renderQuizQuestion();
      });
    });
  } else {
    const isCorrect = result.correct;
    feedbackEl.classList.add(isCorrect ? 'correct' : 'incorrect');
    feedbackEl.innerHTML = `
      <div class="quiz-feedback-header">
        <span class="material-symbols-rounded">${isCorrect ? 'check_circle' : 'cancel'}</span>
        <span>${isCorrect ? 'Correct!' : 'Incorrect'}</span>
      </div>
      ${!isCorrect && result.correctAnswer ? `<p><strong>Correct answer:</strong> ${renderLatex(result.correctAnswer)}</p>` : ''}
      ${question.explanation ? `<p>${renderLatex(question.explanation)}</p>` : ''}
    `;
  }
}

function submitCurrentAnswer() {
  const quiz = quizState.currentQuiz;
  if (!quiz) return;
  const question = quiz.questions[quizState.currentQuestionIndex];
  if (!question) return;
  
  // Already submitted?
  if (quizState.submittedQuestions[question.id]) return;
  
  const userAnswer = quizState.answers[question.id];
  let isCorrect = false;
  let correctAnswer = '';
  let isSelfEval = false;
  
  if (question.type === 'mcq') {
    const userSet = new Set(userAnswer || []);
    const correctSet = new Set(question.correctAnswers);
    isCorrect = userSet.size === correctSet.size && [...userSet].every(x => correctSet.has(x));
    correctAnswer = question.correctAnswers.map(i => question.options[i]).join(', ');
  } else if (question.type === 'tf') {
    isCorrect = userAnswer === question.correctAnswer;
    correctAnswer = question.correctAnswer ? 'True' : 'False';
  } else if (question.type === 'fitb') {
    const blanks = question.blanks || question.correctAnswers || [];
    isCorrect = blanks.every((ans, i) => 
      (userAnswer?.[i] || '').toLowerCase().trim() === ans.toLowerCase().trim()
    );
    correctAnswer = blanks.join(', ');
  } else if (question.type === 'matching') {
    const pairs = userAnswer || {};
    const correctPairs = question.correctPairs || {};
    isCorrect = Object.keys(correctPairs).every(k => pairs[k] === correctPairs[k]);
    correctAnswer = '';
  } else if (question.type === 'frq') {
    // FRQ is self-evaluated
    isSelfEval = true;
    isCorrect = null; // unknown until user rates
  }
  
  quizState.submittedQuestions[question.id] = {
    correct: isCorrect,
    correctAnswer,
    selfEval: isSelfEval,
    userAnswer,
  };
  
  // Re-render to show feedback and update buttons
  renderQuizQuestion();
}

function selectMCQOption(questionId, optionIndex, multiSelect) {
  let current = quizState.answers[questionId] || [];
  
  if (multiSelect) {
    if (current.includes(optionIndex)) {
      current = current.filter(i => i !== optionIndex);
    } else {
      current.push(optionIndex);
    }
  } else {
    current = [optionIndex];
  }
  
  quizState.answers[questionId] = current;
  
  // Update UI
  document.querySelectorAll('.quiz-option').forEach((opt, i) => {
    opt.classList.toggle('selected', current.includes(i));
  });
}

function navigateQuiz(direction) {
  const newIndex = quizState.currentQuestionIndex + direction;
  if (newIndex >= 0 && newIndex < quizState.currentQuiz.questions.length) {
    quizState.currentQuestionIndex = newIndex;
    renderQuizQuestion();
  }
}

function submitQuiz() {
  const quiz = quizState.currentQuiz;
  if (!quiz) return;
  
  // Stop timer
  clearInterval(quizState.timerInterval);
  const totalTime = quizState.timerSeconds;
  const mins = Math.floor(totalTime / 60);
  const secs = totalTime % 60;
  
  // Tally results from submitted answers
  let correct = 0;
  const breakdown = [];
  
  quiz.questions.forEach((question, i) => {
    const sub = quizState.submittedQuestions[question.id];
    const isCorrect = sub?.correct === true;
    if (isCorrect) correct++;
    
    const userAnswer = quizState.answers[question.id];
    let userAnswerDisplay = '';
    let correctAnswerDisplay = '';
    
    if (question.type === 'mcq') {
      userAnswerDisplay = (userAnswer || []).map(idx => question.options[idx]).join(', ') || '(no answer)';
      correctAnswerDisplay = question.correctAnswers.map(idx => question.options[idx]).join(', ');
    } else if (question.type === 'tf') {
      userAnswerDisplay = userAnswer === true ? 'True' : userAnswer === false ? 'False' : '(no answer)';
      correctAnswerDisplay = question.correctAnswer ? 'True' : 'False';
    } else if (question.type === 'fitb') {
      userAnswerDisplay = (userAnswer || []).join(', ') || '(no answer)';
      correctAnswerDisplay = (question.blanks || question.correctAnswers || []).join(', ');
    } else if (question.type === 'matching') {
      userAnswerDisplay = '(matching)';
      correctAnswerDisplay = '';
    } else if (question.type === 'frq') {
      userAnswerDisplay = userAnswer || '(no answer)';
      correctAnswerDisplay = question.correctAnswers?.join(' / ') || 'Self-evaluated';
    }
    
    breakdown.push({
      question: question.question,
      type: question.type,
      correct: isCorrect,
      selfEval: sub?.selfEval,
      selfEvalResult: sub?.correct,
      userAnswer: userAnswerDisplay,
      correctAnswer: correctAnswerDisplay,
      explanation: question.explanation,
    });
  });
  
  // Show results
  showView('quiz-results');
  document.getElementById('results-correct').textContent = correct;
  document.getElementById('results-total').textContent = quiz.questions.length;
  document.getElementById('results-percent').textContent = Math.round((correct / quiz.questions.length) * 100) + '%';
  
  const timeEl = document.getElementById('results-time');
  if (timeEl) {
    timeEl.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }
  
  const breakdownEl = document.getElementById('results-breakdown');
  breakdownEl.innerHTML = breakdown.map((item, i) => `
    <div class="results-breakdown-item">
      <span class="material-symbols-rounded results-breakdown-icon ${item.correct ? 'correct' : 'incorrect'}">
        ${item.correct ? 'check_circle' : 'cancel'}
      </span>
      <div class="results-breakdown-content">
        <div class="results-breakdown-question">Q${i + 1}: ${renderLatex(item.question)}</div>
        <div class="results-breakdown-answer">
          ${item.selfEval 
            ? `Self-evaluated: ${item.selfEvalResult === true ? '✓ Correct' : item.selfEvalResult === false ? '✗ Incorrect' : 'Not rated'}`
            : item.correct 
              ? '<span style="color:var(--success);">Correct!</span>' 
              : `Your answer: ${renderLatex(item.userAnswer)} | Correct: ${renderLatex(item.correctAnswer)}`
          }
        </div>
        ${item.explanation ? `<div class="quiz-explanation" style="margin-top:8px;"><span class="material-symbols-rounded">lightbulb</span> ${renderLatex(item.explanation)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

// Quiz Creator Functions

// -- Rich text editor helper for question fields --
function createRichFieldHTML(id, placeholder, value, onChangeExpr) {
  // Creates a contenteditable mini-editor with a math insert button
  return `
    <div class="rich-field" data-field-id="${id}">
      <div class="rich-field-toolbar">
        <button class="rich-field-btn" onclick="richFieldBold('${id}')" title="Bold">
          <span class="material-symbols-rounded" style="font-size:16px;">format_bold</span>
        </button>
        <button class="rich-field-btn" onclick="richFieldItalic('${id}')" title="Italic">
          <span class="material-symbols-rounded" style="font-size:16px;">format_italic</span>
        </button>
        <button class="rich-field-btn" onclick="richFieldInsertMath('${id}')" title="Insert Math">
          <span class="material-symbols-rounded" style="font-size:16px;">function</span>
        </button>
      </div>
      <div class="rich-field-editor" id="${id}" contenteditable="true"
        data-placeholder="${placeholder}"
        oninput="richFieldChanged('${id}', ${onChangeExpr})"
        onfocusout="richFieldChanged('${id}', ${onChangeExpr})">${value || ''}</div>
    </div>`;
}

// Serialize a rich field editor to a string with $...$ LaTeX delimiters
function serializeRichField(editorEl) {
  if (!editorEl) return '';
  // Clone so we don't mutate the live DOM
  const clone = editorEl.cloneNode(true);
  // Convert math-field elements back to $...$
  clone.querySelectorAll('math-field').forEach(mf => {
    const latex = mf.value || mf.textContent || '';
    const textNode = document.createTextNode('$' + latex + '$');
    mf.replaceWith(textNode);
  });
  return clone.innerText || clone.textContent || '';
}

// Deserialize a stored string (with $...$) to HTML for the rich field
function deserializeToRichHTML(text) {
  if (!text) return '';
  // Convert $...$ LaTeX to inline math-field elements, $$...$$ for block
  return text
    .replace(/\$\$([^$]+)\$\$/g, '<math-field read-only style="display:block;margin:8px 0;">$1</math-field>')
    .replace(/\$([^$]+)\$/g, '<math-field read-only style="display:inline-block;vertical-align:middle;">$1</math-field>');
}

function richFieldBold(id) {
  const el = document.getElementById(id);
  if (el) { el.focus(); document.execCommand('bold'); }
}
function richFieldItalic(id) {
  const el = document.getElementById(id);
  if (el) { el.focus(); document.execCommand('italic'); }
}

function richFieldInsertMath(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  const mfId = 'mf-' + Date.now();
  document.execCommand('insertHTML', false,
    `<math-field id="${mfId}" style="display:inline-block;vertical-align:middle;min-width:40px;border:1.5px solid var(--accent);border-radius:6px;padding:2px 6px;font-size:0.95rem;"></math-field>&nbsp;`);
  requestAnimationFrame(() => {
    const mf = document.getElementById(mfId);
    if (mf) {
      mf.focus();
      const finalize = () => {
        mf.removeEventListener('focusout', finalize);
        if (!mf.value || !mf.value.trim()) {
          mf.remove();
        } else {
          mf.setAttribute('read-only', '');
          mf.style.border = 'none';
          mf.style.padding = '0';
          mf.addEventListener('dblclick', () => {
            mf.removeAttribute('read-only');
            mf.style.border = '1.5px solid var(--accent)';
            mf.style.padding = '2px 6px';
            mf.focus();
            mf.addEventListener('focusout', finalize, { once: true });
          });
        }
        // Sync to data model
        const container = mf.closest('.rich-field-editor');
        if (container) container.dispatchEvent(new Event('input'));
      };
      mf.addEventListener('focusout', finalize, { once: true });
    }
  });
}

function richFieldChanged(id, questionId, field) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = serializeRichField(el);
  updateQuestion(questionId, field, value);
}

function addQuestion(type) {
  const id = `q${Date.now()}`;
  let question;
  
  if (type === 'mcq') {
    question = { id, type, question: '', options: ['', '', '', ''], correctAnswers: [], explanation: '', svg: '' };
  } else if (type === 'tf') {
    question = { id, type, question: '', correctAnswer: true, explanation: '', svg: '' };
  } else if (type === 'fitb') {
    question = { id, type, question: '', blanks: [''], explanation: '', svg: '' };
  } else if (type === 'matching') {
    question = { id, type, question: '', leftItems: ['', ''], rightItems: ['', ''], correctPairs: {0: 0, 1: 1}, explanation: '', svg: '' };
  } else if (type === 'frq') {
    question = { id, type, question: '', correctAnswers: [''], explanation: '', svg: '' };
  }
  
  quizState.creatorQuestions.push(question);
  renderQuestionsList();
}

function renderQuestionsList() {
  const list = document.getElementById('questions-list');
  if (!list) return;
  
  if (quizState.creatorQuestions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">library_add</span>
        <h3>No questions yet</h3>
        <p>Click one of the buttons above to add your first question. Use the math button <span class="material-symbols-rounded" style="font-size:16px;vertical-align:middle;">function</span> in any text field to insert equations visually.</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = quizState.creatorQuestions.map((q, i) => `
    <div class="question-item" data-question-id="${q.id}">
      <div class="question-item-header">
        <span class="question-number">Question ${i + 1}</span>
        <span class="question-type-badge ${q.type}">${q.type.toUpperCase()}</span>
        <div class="question-actions">
          <button class="icon-btn" onclick="openSvgBuilder('${q.id}')" title="Add Shape">
            <span class="material-symbols-rounded">draw</span>
          </button>
          <button class="icon-btn" onclick="moveQuestion('${q.id}', -1)" title="Move up">
            <span class="material-symbols-rounded">arrow_upward</span>
          </button>
          <button class="icon-btn" onclick="moveQuestion('${q.id}', 1)" title="Move down">
            <span class="material-symbols-rounded">arrow_downward</span>
          </button>
          <button class="icon-btn" onclick="removeQuestion('${q.id}')" title="Delete">
            <span class="material-symbols-rounded">delete</span>
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>Question Text</label>
        ${createRichFieldHTML('qtext-' + q.id, 'Enter your question...', deserializeToRichHTML(q.question), `'${q.id}', 'question'`)}
      </div>
      ${q.svg ? `<div class="question-svg-preview" style="margin:8px 0;padding:8px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border);">${q.svg}<button class="btn btn-text" onclick="updateQuestion('${q.id}', 'svg', ''); renderQuestionsList();" style="margin-top:4px;">Remove Shape</button></div>` : ''}
      ${renderQuestionTypeEditor(q)}
      <div class="explanation-container">
        <div class="form-group">
          <label>Explanation (optional)</label>
          ${createRichFieldHTML('qexpl-' + q.id, 'Explain the correct answer...', deserializeToRichHTML(q.explanation), `'${q.id}', 'explanation'`)}
        </div>
      </div>
    </div>
  `).join('');
}

function renderQuestionTypeEditor(q) {
  if (q.type === 'mcq') return renderMCQOptions(q);
  if (q.type === 'tf') return renderTFEditor(q);
  if (q.type === 'fitb') return renderFITBEditor(q);
  if (q.type === 'matching') return renderMatchingEditor(q);
  if (q.type === 'frq') return renderFRQAnswers(q);
  return '';
}

function renderTFEditor(question) {
  return `
    <div class="form-group">
      <label>Correct Answer</label>
      <div style="display:flex;gap:12px;margin-top:8px;">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="radio" name="tf-${question.id}" value="true" ${question.correctAnswer === true ? 'checked' : ''}
            onchange="updateQuestion('${question.id}', 'correctAnswer', true)"> True
        </label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="radio" name="tf-${question.id}" value="false" ${question.correctAnswer === false ? 'checked' : ''}
            onchange="updateQuestion('${question.id}', 'correctAnswer', false)"> False
        </label>
      </div>
    </div>
  `;
}

function renderFITBEditor(question) {
  return `
    <div class="form-group">
      <label>Blanks (use ___ in question text for each blank)</label>
      ${(question.blanks || []).map((b, i) => `
        <div class="answer-row" style="margin-bottom:4px;">
          <span style="min-width:60px;font-size:0.85rem;color:var(--text-muted);">Blank ${i + 1}:</span>
          <input type="text" class="answer-input form-group" placeholder="Correct answer for blank ${i + 1}"
            value="${b}" onchange="updateBlank('${question.id}', ${i}, this.value)">
          <button class="icon-btn" onclick="removeBlank('${question.id}', ${i})" title="Remove">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      `).join('')}
      <button class="btn btn-text add-option-btn" onclick="addBlank('${question.id}')">
        <span class="material-symbols-rounded">add</span> Add Blank
      </button>
    </div>
  `;
}

function renderMatchingEditor(question) {
  return `
    <div class="form-group">
      <label>Matching Pairs (left → right)</label>
      <div class="matching-pairs-editor">
        ${(question.leftItems || []).map((l, i) => `
          <div class="matching-pair-row">
            <input type="text" class="form-group" placeholder="Term ${i + 1}" value="${l}"
              onchange="updateMatchingItem('${question.id}', 'left', ${i}, this.value)">
            <span class="pair-arrow material-symbols-rounded">arrow_forward</span>
            <input type="text" class="form-group" placeholder="Definition ${i + 1}" value="${question.rightItems?.[i] || ''}"
              onchange="updateMatchingItem('${question.id}', 'right', ${i}, this.value)">
            <button class="icon-btn" onclick="removeMatchingPair('${question.id}', ${i})" title="Remove">
              <span class="material-symbols-rounded">close</span>
            </button>
          </div>
        `).join('')}
        <button class="btn btn-text add-option-btn" onclick="addMatchingPair('${question.id}')">
          <span class="material-symbols-rounded">add</span> Add Pair
        </button>
      </div>
    </div>
  `;
}

function renderMCQOptions(question) {
  return `
    <div class="options-container">
      <label>Options (check the correct answer(s))</label>
      ${(question.options || []).map((opt, i) => `
        <div class="option-row">
          <input type="checkbox" class="option-correct" 
            ${question.correctAnswers.includes(i) ? 'checked' : ''}
            onchange="toggleCorrectOption('${question.id}', ${i}, this.checked)">
          <input type="text" class="option-input form-group" placeholder="Option ${i + 1}" 
            value="${opt}"
            onchange="updateOption('${question.id}', ${i}, this.value)">
          <button class="icon-btn" onclick="removeOption('${question.id}', ${i})" title="Remove">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      `).join('')}
      <button class="btn btn-text add-option-btn" onclick="addOption('${question.id}')">
        <span class="material-symbols-rounded">add</span> Add Option
      </button>
    </div>
  `;
}

function renderFRQAnswers(question) {
  return `
    <div class="accepted-answers-container">
      <label>Accepted Answers (add multiple variations)</label>
      ${(question.correctAnswers || []).map((ans, i) => `
        <div class="answer-row">
          <input type="text" class="answer-input form-group" placeholder="Accepted answer ${i + 1}"
            value="${ans}"
            onchange="updateFRQAnswer('${question.id}', ${i}, this.value)">
          <button class="icon-btn" onclick="removeFRQAnswer('${question.id}', ${i})" title="Remove">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      `).join('')}
      <button class="btn btn-text add-option-btn" onclick="addFRQAnswer('${question.id}')">
        <span class="material-symbols-rounded">add</span> Add Accepted Answer
      </button>
    </div>
  `;
}

function updateQuestion(id, field, value) {
  const q = quizState.creatorQuestions.find(q => q.id === id);
  if (q) q[field] = value;
}

function toggleCorrectOption(questionId, optionIndex, checked) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (!q) return;
  
  if (checked) {
    if (!q.correctAnswers.includes(optionIndex)) {
      q.correctAnswers.push(optionIndex);
    }
  } else {
    q.correctAnswers = q.correctAnswers.filter(i => i !== optionIndex);
  }
}

function updateOption(questionId, optionIndex, value) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.options) q.options[optionIndex] = value;
}

function addOption(questionId) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.options) {
    q.options.push('');
    renderQuestionsList();
  }
}

function removeOption(questionId, optionIndex) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.options && q.options.length > 2) {
    q.options.splice(optionIndex, 1);
    q.correctAnswers = q.correctAnswers
      .filter(i => i !== optionIndex)
      .map(i => i > optionIndex ? i - 1 : i);
    renderQuestionsList();
  } else {
    showToast('MCQ must have at least 2 options', 'error');
  }
}

function updateFRQAnswer(questionId, answerIndex, value) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q) q.correctAnswers[answerIndex] = value;
}

function addFRQAnswer(questionId) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q) {
    q.correctAnswers.push('');
    renderQuestionsList();
  }
}

function removeFRQAnswer(questionId, answerIndex) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.correctAnswers.length > 1) {
    q.correctAnswers.splice(answerIndex, 1);
    renderQuestionsList();
  } else {
    showToast('FRQ must have at least 1 accepted answer', 'error');
  }
}

function moveQuestion(id, direction) {
  const index = quizState.creatorQuestions.findIndex(q => q.id === id);
  const newIndex = index + direction;
  if (newIndex >= 0 && newIndex < quizState.creatorQuestions.length) {
    const [question] = quizState.creatorQuestions.splice(index, 1);
    quizState.creatorQuestions.splice(newIndex, 0, question);
    renderQuestionsList();
  }
}

function removeQuestion(id) {
  quizState.creatorQuestions = quizState.creatorQuestions.filter(q => q.id !== id);
  renderQuestionsList();
}

// FITB helpers
function updateBlank(questionId, index, value) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.blanks) q.blanks[index] = value;
}

function addBlank(questionId) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q) { if (!q.blanks) q.blanks = []; q.blanks.push(''); renderQuestionsList(); }
}

function removeBlank(questionId, index) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.blanks && q.blanks.length > 1) { q.blanks.splice(index, 1); renderQuestionsList(); }
}

// Matching helpers
function updateMatchingItem(questionId, side, index, value) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (!q) return;
  if (side === 'left') q.leftItems[index] = value;
  else q.rightItems[index] = value;
}

function addMatchingPair(questionId) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q) {
    const n = q.leftItems.length;
    q.leftItems.push('');
    q.rightItems.push('');
    q.correctPairs[n] = n;
    renderQuestionsList();
  }
}

function removeMatchingPair(questionId, index) {
  const q = quizState.creatorQuestions.find(q => q.id === questionId);
  if (q && q.leftItems.length > 2) {
    q.leftItems.splice(index, 1);
    q.rightItems.splice(index, 1);
    // Rebuild correctPairs
    const newPairs = {};
    q.leftItems.forEach((_, i) => { newPairs[i] = i; });
    q.correctPairs = newPairs;
    renderQuestionsList();
  }
}

// SVG Shape Builder
let svgBuilderState = { tool: 'rect', elements: [], drawing: false, startX: 0, startY: 0, targetQuestionId: null };

function openSvgBuilder(questionId) {
  svgBuilderState.targetQuestionId = questionId;
  svgBuilderState.elements = [];
  const container = document.getElementById('svg-builder-container');
  if (container) {
    container.classList.remove('hidden');
    clearSvgCanvas();
  }
}

function initSvgBuilder() {
  const canvas = document.getElementById('svg-canvas');
  if (!canvas) return;
  
  // Tool selection
  document.querySelectorAll('.svg-tool[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.svg-tool[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      svgBuilderState.tool = btn.dataset.tool;
    });
  });
  
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = 400 / rect.width;
    const scaleY = 300 / rect.height;
    svgBuilderState.drawing = true;
    svgBuilderState.startX = (e.clientX - rect.left) * scaleX;
    svgBuilderState.startY = (e.clientY - rect.top) * scaleY;
  });
  
  canvas.addEventListener('mouseup', (e) => {
    if (!svgBuilderState.drawing) return;
    svgBuilderState.drawing = false;
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = 400 / rect.width;
    const scaleY = 300 / rect.height;
    const endX = (e.clientX - rect.left) * scaleX;
    const endY = (e.clientY - rect.top) * scaleY;
    const fill = document.getElementById('svg-fill-color')?.value || '#3b82f6';
    const stroke = document.getElementById('svg-stroke-color')?.value || '#1e293b';
    const tool = svgBuilderState.tool;
    
    let el;
    const x = Math.min(svgBuilderState.startX, endX);
    const y = Math.min(svgBuilderState.startY, endY);
    const w = Math.abs(endX - svgBuilderState.startX);
    const h = Math.abs(endY - svgBuilderState.startY);
    
    if (tool === 'rect') {
      el = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="2" rx="2"/>`;
    } else if (tool === 'circle') {
      const cx = (svgBuilderState.startX + endX) / 2;
      const cy = (svgBuilderState.startY + endY) / 2;
      const r = Math.max(w, h) / 2;
      el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    } else if (tool === 'line') {
      el = `<line x1="${svgBuilderState.startX}" y1="${svgBuilderState.startY}" x2="${endX}" y2="${endY}" stroke="${stroke}" stroke-width="2"/>`;
    } else if (tool === 'arrow') {
      el = `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${stroke}"/></marker></defs>`;
      el += `<line x1="${svgBuilderState.startX}" y1="${svgBuilderState.startY}" x2="${endX}" y2="${endY}" stroke="${stroke}" stroke-width="2" marker-end="url(#arrowhead)"/>`;
    } else if (tool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        el = `<text x="${svgBuilderState.startX}" y="${svgBuilderState.startY}" fill="${stroke}" font-size="14" font-family="Inter,sans-serif">${text}</text>`;
      }
    }
    
    if (el) {
      svgBuilderState.elements.push(el);
      redrawSvgCanvas();
    }
  });
  
  document.getElementById('svg-undo')?.addEventListener('click', () => {
    svgBuilderState.elements.pop();
    redrawSvgCanvas();
  });
  
  document.getElementById('svg-clear')?.addEventListener('click', clearSvgCanvas);
  
  document.getElementById('svg-cancel')?.addEventListener('click', () => {
    document.getElementById('svg-builder-container')?.classList.add('hidden');
  });
  
  document.getElementById('svg-insert')?.addEventListener('click', () => {
    const qId = svgBuilderState.targetQuestionId;
    if (qId && svgBuilderState.elements.length > 0) {
      const svgStr = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-height:200px;">${svgBuilderState.elements.join('')}</svg>`;
      updateQuestion(qId, 'svg', svgStr);
      renderQuestionsList();
    }
    document.getElementById('svg-builder-container')?.classList.add('hidden');
  });
  
  document.getElementById('svg-builder-close')?.addEventListener('click', () => {
    document.getElementById('svg-builder-container')?.classList.add('hidden');
  });
}

function redrawSvgCanvas() {
  const canvas = document.getElementById('svg-canvas');
  if (canvas) canvas.innerHTML = svgBuilderState.elements.join('');
}

function clearSvgCanvas() {
  svgBuilderState.elements = [];
  redrawSvgCanvas();
}

async function saveQuiz() {
  const title = document.getElementById('quiz-title')?.value?.trim();
  const subject = document.getElementById('quiz-subject')?.value?.trim();
  const topic = document.getElementById('quiz-topic')?.value?.trim();
  const description = document.getElementById('quiz-description')?.value?.trim();
  const tags = document.getElementById('quiz-tags')?.value?.split(',').map(t => t.trim()).filter(t => t);
  
  if (!title) {
    showToast('Please enter a quiz title', 'error');
    return;
  }
  if (!subject) {
    showToast('Please enter a subject', 'error');
    return;
  }
  if (quizState.creatorQuestions.length === 0) {
    showToast('Please add at least one question', 'error');
    return;
  }
  
  // Validate questions
  for (let i = 0; i < quizState.creatorQuestions.length; i++) {
    const q = quizState.creatorQuestions[i];
    if (!q.question.trim()) {
      showToast(`Question ${i + 1} has no text`, 'error');
      return;
    }
    if (q.type === 'mcq') {
      if (q.options.filter(o => o.trim()).length < 2) {
        showToast(`Question ${i + 1} needs at least 2 options`, 'error');
        return;
      }
      if (q.correctAnswers.length === 0) {
        showToast(`Question ${i + 1} needs at least 1 correct answer`, 'error');
        return;
      }
    } else if (q.type === 'frq') {
      if (q.correctAnswers.filter(a => a.trim()).length === 0) {
        showToast(`Question ${i + 1} needs at least 1 accepted answer`, 'error');
        return;
      }
    } else if (q.type === 'fitb') {
      if (!q.blanks || q.blanks.filter(b => b.trim()).length === 0) {
        showToast(`Question ${i + 1} needs at least 1 blank answer`, 'error');
        return;
      }
    } else if (q.type === 'matching') {
      if (!q.leftItems || q.leftItems.filter(l => l.trim()).length < 2) {
        showToast(`Question ${i + 1} needs at least 2 matching pairs`, 'error');
        return;
      }
    }
  }
  
  try {
    const quiz = {
      title,
      subject,
      topic,
      description,
      tags,
      questions: quizState.creatorQuestions,
    };
    
    await quizApi.createQuiz(quiz);
    showToast('Quiz saved successfully!', 'success');
    
    // Reset creator
    quizState.creatorQuestions = [];
    document.getElementById('quiz-title').value = '';
    document.getElementById('quiz-topic').value = '';
    document.getElementById('quiz-tags').value = '';
    if (document.getElementById('quiz-description')) document.getElementById('quiz-description').value = '';
    renderQuestionsList();
    
    // Go to browse view
    showView('quiz-browse');
    loadQuizzes();
  } catch (e) {
    showToast('Failed to save quiz: ' + e.message, 'error');
  }
}

// Initialize quiz event listeners
function initQuizListeners() {
  // Quiz browse
  document.getElementById('quiz-refresh-btn')?.addEventListener('click', () => loadQuizzes());
  document.getElementById('quiz-shuffle-btn')?.addEventListener('click', shuffleAndStartQuizzes);
  
  // Quiz subject filter (free-form text input)
  const subjectFilter = document.getElementById('quiz-subject-filter');
  if (subjectFilter) {
    let filterTimeout;
    subjectFilter.addEventListener('input', () => {
      clearTimeout(filterTimeout);
      filterTimeout = setTimeout(() => {
        const val = subjectFilter.value.trim();
        loadQuizzes(val ? { subject: val } : {});
      }, 400);
    });
  }
  document.getElementById('quiz-filter-clear')?.addEventListener('click', () => {
    const input = document.getElementById('quiz-subject-filter');
    if (input) { input.value = ''; }
    loadQuizzes();
  });
  
  // Quiz creator
  document.getElementById('add-mcq-btn')?.addEventListener('click', () => addQuestion('mcq'));
  document.getElementById('add-tf-btn')?.addEventListener('click', () => addQuestion('tf'));
  document.getElementById('add-fitb-btn')?.addEventListener('click', () => addQuestion('fitb'));
  document.getElementById('add-matching-btn')?.addEventListener('click', () => addQuestion('matching'));
  document.getElementById('add-frq-btn')?.addEventListener('click', () => addQuestion('frq'));
  document.getElementById('save-quiz-btn')?.addEventListener('click', saveQuiz);
  
  // Quiz navigation
  document.getElementById('quiz-prev-btn')?.addEventListener('click', () => navigateQuiz(-1));
  document.getElementById('quiz-next-btn')?.addEventListener('click', () => navigateQuiz(1));
  document.getElementById('quiz-submit-answer-btn')?.addEventListener('click', submitCurrentAnswer);
  document.getElementById('quiz-submit-btn')?.addEventListener('click', submitQuiz);
  document.getElementById('quit-quiz-btn')?.addEventListener('click', () => {
    clearInterval(quizState.timerInterval);
    quizState.reviewMode = false;
    showView('quiz-browse');
  });
  
  // Quiz results
  document.getElementById('retake-quiz-btn')?.addEventListener('click', () => {
    quizState.currentQuestionIndex = 0;
    quizState.answers = {};
    quizState.submittedQuestions = {};
    quizState.reviewMode = false;
    quizState._matchingSelected = undefined;
    
    // Restart timer
    quizState.timerSeconds = 0;
    clearInterval(quizState.timerInterval);
    quizState.timerInterval = setInterval(() => {
      quizState.timerSeconds++;
      const timerEl = document.getElementById('quiz-timer');
      if (timerEl) {
        const mins = Math.floor(quizState.timerSeconds / 60);
        const secs = quizState.timerSeconds % 60;
        timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      }
    }, 1000);
    
    showView('quiz-take');
    renderQuizQuestion();
  });
  document.getElementById('review-quiz-btn')?.addEventListener('click', () => {
    quizState.reviewMode = true;
    quizState.currentQuestionIndex = 0;
    showView('quiz-take');
    renderQuizQuestion();
  });
  document.getElementById('back-to-quizzes-btn')?.addEventListener('click', () => showView('quiz-browse'));
}

// Make quiz functions globally accessible
window.updateQuestion = updateQuestion;
window.toggleCorrectOption = toggleCorrectOption;
window.updateOption = updateOption;
window.addOption = addOption;
window.removeOption = removeOption;
window.updateFRQAnswer = updateFRQAnswer;
window.addFRQAnswer = addFRQAnswer;
window.removeFRQAnswer = removeFRQAnswer;
window.moveQuestion = moveQuestion;
window.removeQuestion = removeQuestion;
window.loadQuizzes = loadQuizzes;
window.initQuizListeners = initQuizListeners;
window.openSvgBuilder = openSvgBuilder;
window.updateBlank = updateBlank;
window.addBlank = addBlank;
window.removeBlank = removeBlank;
window.updateMatchingItem = updateMatchingItem;
window.addMatchingPair = addMatchingPair;
window.removeMatchingPair = removeMatchingPair;
window.renderQuestionsList = renderQuestionsList;

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

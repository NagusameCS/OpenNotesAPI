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
  AUTH_URL: 'https://nagusamecs.github.io/OpenNotesAPI/auth.html',
  SUBMIT_URL: 'https://open-notes.tebby2008-li.workers.dev/upload/submit',
  NOTES_RAW_BASE: 'https://raw.githubusercontent.com/Tebby2008/OpenNotes/main/Notes',
  FALLBACK_THUMBNAIL: 'https://raw.githubusercontent.com/Tebby2008/OpenNotes/main/resources/fallback.svg',
  GATEWAY_URL: 'https://opennotes-gateway.wkohara.workers.dev',
  DESKTOP_APP_SECRET: 'opennotes-desktop-v1',
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
        method: options.method || 'GET'
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
  isAuthenticated: false,
  user: null,
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
      const response = await httpFetch(note.dl);
      const blob = await response.blob();
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
      this.set('saved_notes', saved);
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
  
  // Attach event listeners
  container.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!e.target.closest('.note-action-btn')) {
        openNoteModal(card.dataset.noteId);
      }
    });
  });
  
  container.querySelectorAll('.btn-save-offline').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const noteId = btn.closest('.note-card').dataset.noteId;
      const note = state.notes.find(n => n.name === noteId);
      if (note) {
        if (storage.isNoteSaved(note.name)) {
          storage.removeOfflineNote(note.name);
          btn.classList.remove('saved');
        } else {
          storage.saveNoteOffline(note);
          btn.classList.add('saved');
        }
      }
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
      <div class="note-actions">
        <button class="note-action-btn btn-save-offline ${isSaved ? 'saved' : ''}" title="${isSaved ? 'Downloaded' : 'Download for offline'}">
          <span class="material-symbols-rounded">${isSaved ? 'download_done' : 'download'}</span>
        </button>
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
      container.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading notes...</p>
        </div>
      `;
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
  const modal = document.getElementById('note-modal');
  const note = state.notes.find(n => n.name === noteId) || 
               state.savedNotes.find(n => n.name === noteId);
  
  if (!note || !modal) return;
  
  state.currentNote = note;
  
  // Populate modal (use API field names with fallbacks)
  const thumbnail = note.thumb || note.img || 'https://via.placeholder.com/600x400?text=No+Preview';
  const author = note.auth || note.author || 'Unknown';
  const views = note.v || note.views || 0;
  const downloads = note.d || note.downloads || 0;
  
  document.getElementById('modal-title').textContent = note.name;
  document.getElementById('modal-thumbnail').src = thumbnail;
  document.getElementById('modal-author').textContent = author;
  document.getElementById('modal-format').textContent = getFileFormat(note.name).toUpperCase();
  document.getElementById('modal-views').textContent = formatNumber(views);
  document.getElementById('modal-downloads').textContent = formatNumber(downloads);
  document.getElementById('modal-size').textContent = note.size ? formatBytes(parseInt(note.size)) : '--';
  
  // Update save button
  const saveBtn = document.getElementById('modal-save-offline');
  const isSaved = storage.isNoteSaved(note.name);
  saveBtn.innerHTML = `
    <span class="material-symbols-rounded">${isSaved ? 'bookmark' : 'bookmark_border'}</span>
    ${isSaved ? 'Saved Offline' : 'Save Offline'}
  `;
  
  modal.classList.remove('hidden');
  
  // Track view
  api.incrementViews(note.name);
}

function closeNoteModal() {
  const modal = document.getElementById('note-modal');
  if (modal) modal.classList.add('hidden');
  
  // Hide preview when closing
  const previewContainer = document.getElementById('modal-preview-container');
  const thumbnail = document.getElementById('modal-thumbnail');
  if (previewContainer) previewContainer.classList.add('hidden');
  if (thumbnail) thumbnail.classList.remove('hidden');
  
  state.currentNote = null;
}

// Toggle document preview in modal
function toggleNotePreview() {
  const note = state.currentNote;
  if (!note) return;
  
  const previewContainer = document.getElementById('modal-preview-container');
  const previewFrame = document.getElementById('modal-preview-frame');
  const previewFallback = document.getElementById('modal-preview-fallback');
  const thumbnail = document.getElementById('modal-thumbnail');
  const previewBtn = document.getElementById('modal-preview');
  
  if (!previewContainer) return;
  
  const isHidden = previewContainer.classList.contains('hidden');
  
  if (isHidden) {
    // Show preview
    const format = getFileFormat(note.name).toLowerCase();
    const previewUrl = note.dl || note.thumb || note.img;
    
    // Check if format supports preview
    const previewableFormats = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'txt', 'html'];
    const canPreview = previewableFormats.includes(format) && previewUrl;
    
    if (canPreview) {
      previewFrame.src = previewUrl;
      previewFrame.classList.remove('hidden');
      previewFallback.classList.add('hidden');
    } else {
      previewFrame.classList.add('hidden');
      previewFallback.classList.remove('hidden');
    }
    
    previewContainer.classList.remove('hidden');
    thumbnail.classList.add('hidden');
    previewBtn.innerHTML = `
      <span class="material-symbols-rounded">visibility_off</span>
      Hide Preview
    `;
  } else {
    // Hide preview
    previewContainer.classList.add('hidden');
    previewFrame.src = '';
    thumbnail.classList.remove('hidden');
    previewBtn.innerHTML = `
      <span class="material-symbols-rounded">visibility</span>
      Preview
    `;
  }
}

// Open note in external application
async function openNoteExternal(note) {
  if (!note.dl) {
    showToast('Download URL not available', 'error');
    return;
  }
  
  try {
    // Check if we have it saved offline first
    const savedNote = state.savedNotes.find(n => n.name === note.name);
    
    if (savedNote && savedNote.cachedFile) {
      // Open from cached file
      const blob = storage.base64ToBlob(savedNote.cachedFile);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } else {
      // Open directly from URL
      window.open(note.dl, '_blank');
    }
    
    showToast('Opening in external app...', 'success');
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
  navigator.clipboard.writeText(text).then(() => {
    showToast('Link copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Link copied to clipboard!', 'success');
  });
}

function openOfflineNote(name) {
  const note = state.savedNotes.find(n => n.name === name);
  if (!note || !note.cachedFile) {
    showToast('File not available offline', 'error');
    return;
  }
  
  const blob = storage.base64ToBlob(note.cachedFile);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ==================== VIEW SWITCHING ====================
function switchView(viewId) {
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
    'my-uploads': 'My Uploads',
    storage: 'Storage',
    'quiz-browse': 'Browse Quizzes',
    'quiz-create': 'Create Quiz',
    'quiz-take': 'Quiz',
    'quiz-results': 'Quiz Results',
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
    
    // Upload to OpenNotes
    document.getElementById('upload-doc')?.addEventListener('click', () => {
      this.uploadDocument();
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
    const latex = prompt('Enter LaTeX expression:');
    if (latex) {
      document.execCommand('insertHTML', false, 
        `<math-field read-only>${latex}</math-field>&nbsp;`);
    }
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
    const title = document.getElementById('doc-title').value || 'Untitled';
    const content = document.getElementById('editor').innerHTML;
    
    // Create HTML file from editor content
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
    
    // Create a File object
    const blob = new Blob([html], { type: 'text/html' });
    const file = new File([blob], `${title}.html`, { type: 'text/html' });
    
    // Switch to upload view and add the file to queue
    switchView('upload');
    
    // Use the uploader to handle the file
    setTimeout(() => {
      uploader.handleFiles([file]);
      
      // Pre-fill the form with document info
      const titleInput = document.querySelector('#upload-form input[name="title"]');
      if (titleInput) titleInput.value = title;
      
      showToast('Document added to upload queue', 'success');
    }, 100);
  },
};

// ==================== UPLOAD ====================
const uploader = {
  init() {
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    
    if (!zone || !fileInput) return;
    
    zone.addEventListener('click', () => fileInput.click());
    
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
      zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });
    
    fileInput.addEventListener('change', () => {
      this.handleFiles(fileInput.files);
    });
  },
  
  handleFiles(files) {
    const queue = document.getElementById('upload-queue');
    const form = document.getElementById('upload-form');
    
    if (!files.length) return;
    
    Array.from(files).forEach(file => {
      const item = document.createElement('div');
      item.className = 'upload-item';
      item.innerHTML = `
        <span class="material-symbols-rounded">description</span>
        <div class="upload-item-info">
          <div class="upload-item-name">${escapeHtml(file.name)}</div>
          <div class="upload-item-size">${formatBytes(file.size)}</div>
          <div class="upload-progress">
            <div class="upload-progress-bar" style="width: 0%"></div>
          </div>
        </div>
        <button class="icon-btn" onclick="this.closest('.upload-item').remove()">
          <span class="material-symbols-rounded">close</span>
        </button>
      `;
      queue.appendChild(item);
    });
    
    if (form) form.style.display = 'block';
    
    showToast(`${files.length} file(s) added`, 'info');
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
    <span class="material-symbols-rounded">${
      type === 'success' ? 'check_circle' :
      type === 'error' ? 'error' :
      'info'
    }</span>
    <span>${escapeHtml(message)}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

// ==================== AUTHENTICATION ====================
function checkAuth() {
  const token = localStorage.getItem('auth_token_fallback');
  const userStr = localStorage.getItem('opennotes_user');
  
  if (token && userStr) {
    try {
      state.user = JSON.parse(userStr);
      state.isAuthenticated = true;
      updateUserProfile();
      return true;
    } catch (e) {
      console.error('[AUTH] Failed to parse user data:', e);
    }
  }
  return false;
}

function showAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('hidden');
}

function hideAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleGoogleSignIn() {
  try {
    console.log('[AUTH] Starting Google Sign In...');
    
    // For Tauri, use shell plugin to open in system browser
    if (window.__TAURI__) {
      try {
        const { open } = await import('@tauri-apps/plugin-shell');
        console.log('[AUTH] Opening auth URL in system browser via Tauri shell');
        await open(CONFIG.AUTH_URL);
        
        // Show a message that auth will complete in browser
        showToast('Complete sign-in in your browser', 'info');
        
        // Poll for auth completion (browser will set localStorage via callback page)
        const pollAuth = setInterval(() => {
          if (checkAuth()) {
            clearInterval(pollAuth);
            hideAuthModal();
            showToast('Successfully signed in!', 'success');
          }
        }, 1000);
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollAuth);
        }, 300000);
        
        return;
      } catch (shellErr) {
        console.warn('[AUTH] Tauri shell not available, falling back to window.open:', shellErr);
      }
    }
    
    // Fallback for browser environment
    const authWindow = window.open(CONFIG.AUTH_URL, 'Google Sign In', 'width=500,height=600');
    
    // Listen for the auth callback via postMessage
    const handleMessage = (event) => {
      console.log('[AUTH] Received message:', event.origin);
      
      // Validate origin
      if (!event.origin.includes('tebby2008-li.workers.dev') && !event.origin.includes('localhost')) {
        return;
      }
      
      const { token, user } = event.data;
      if (token) {
        localStorage.setItem('auth_token_fallback', token);
        if (user) {
          localStorage.setItem('opennotes_user', JSON.stringify(user));
          state.user = user;
        }
        state.isAuthenticated = true;
        updateUserProfile();
        hideAuthModal();
        showToast('Successfully signed in!', 'success');
        window.removeEventListener('message', handleMessage);
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    // Fallback: Check for token via polling
    const checkForToken = setInterval(() => {
      try {
        if (authWindow && authWindow.closed) {
          clearInterval(checkForToken);
          // Check localStorage in case callback already set it
          if (checkAuth()) {
            hideAuthModal();
          }
        }
      } catch (e) {
        // Cross-origin access error - window is on different domain
      }
    }, 500);
    
    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkForToken);
      window.removeEventListener('message', handleMessage);
    }, 300000);
    
  } catch (error) {
    console.error('[AUTH] Sign in error:', error);
    showToast('Sign in failed. Please try again.', 'error');
  }
}

function handleLogout() {
  localStorage.removeItem('auth_token_fallback');
  localStorage.removeItem('opennotes_user');
  state.isAuthenticated = false;
  state.user = null;
  updateUserProfile();
  showToast('Signed out successfully', 'info');
  showAuthModal();
}

function updateUserProfile() {
  const profileEl = document.getElementById('user-profile');
  const avatarEl = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-name');
  
  if (!profileEl) return;
  
  if (state.isAuthenticated && state.user) {
    profileEl.classList.remove('hidden');
    if (avatarEl) avatarEl.src = state.user.picture || state.user.avatar || '';
    if (nameEl) nameEl.textContent = state.user.name || state.user.email || 'User';
  } else {
    profileEl.classList.add('hidden');
  }
}

function requireAuth(action) {
  if (!state.isAuthenticated) {
    showToast('Please sign in to ' + action, 'info');
    showAuthModal();
    return false;
  }
  return true;
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

// ==================== SUBMIT FOR REVIEW ====================
async function submitForReview() {
  if (!requireAuth('submit documents for review')) return;
  
  const title = document.getElementById('doc-title').value || 'Untitled';
  const content = document.getElementById('editor').innerHTML;
  
  if (!content || content.trim() === '' || content === '<p>Start typing your document...</p>') {
    showToast('Please write some content before submitting', 'error');
    return;
  }
  
  try {
    const token = localStorage.getItem('auth_token_fallback');
    const response = await fetch(CONFIG.SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        title,
        content,
        format: 'html',
        author: state.user?.name || 'Anonymous',
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Submission failed');
    }
    
    showToast('Document submitted for review!', 'success');
    
    // Clear the editor
    document.getElementById('doc-title').value = '';
    document.getElementById('editor').innerHTML = '<p>Start typing your document...</p>';
    storage.remove('draft');
    
  } catch (error) {
    console.error('[SUBMIT] Error:', error);
    showToast('Failed to submit: ' + error.message, 'error');
  }
}

// ==================== INITIALIZATION ====================
async function init() {
  console.log('[INIT] OpenNotes Desktop initializing...');
  console.log('[INIT] User Agent:', navigator.userAgent);
  console.log('[INIT] window.__TAURI__:', typeof window.__TAURI__, window.__TAURI__);
  
  // CRITICAL: Set up auth handlers FIRST, before anything else can fail
  // This ensures the sign-in button always works even if other init fails
  console.log('[INIT] Setting up auth handlers...');
  const signinBtn = document.getElementById('google-signin-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const skipAuthBtn = document.getElementById('skip-auth-btn');
  const submitTokenBtn = document.getElementById('submit-token-btn');
  const tokenInput = document.getElementById('auth-token-input');
  
  if (signinBtn) {
    signinBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[AUTH] Sign-in button clicked');
      handleGoogleSignIn();
    });
    console.log('[INIT] Sign-in button handler attached');
  } else {
    console.error('[INIT] Sign-in button not found!');
  }
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Skip button - allows using app without auth
  if (skipAuthBtn) {
    skipAuthBtn.addEventListener('click', () => {
      console.log('[AUTH] Skipping authentication');
      hideAuthModal();
      showToast('You can sign in later from the sidebar', 'info');
    });
  }
  
  // Token/Code submit - exchange 6-digit code for desktop app
  if (submitTokenBtn && tokenInput) {
    submitTokenBtn.addEventListener('click', async () => {
      const input = tokenInput.value.trim();
      if (!input) {
        showToast('Please enter a code', 'error');
        return;
      }
      
      // Check if it's a 6-digit code or a full token
      if (/^\d{6}$/.test(input)) {
        // Exchange 6-digit code for token
        console.log('[AUTH] Exchanging 6-digit code...');
        submitTokenBtn.disabled = true;
        submitTokenBtn.textContent = 'Verifying...';
        
        try {
          const response = await fetch(`${CONFIG.GATEWAY_URL}/auth/exchange?code=${input}`, {
            method: 'GET',
            headers: {
              'X-Desktop-App': CONFIG.DESKTOP_APP_SECRET,
            },
          });
          
          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Invalid code');
          }
          
          const data = await response.json();
          localStorage.setItem('auth_token_fallback', data.token);
          
          if (data.user) {
            state.user = data.user;
            localStorage.setItem('opennotes_user', JSON.stringify(data.user));
          } else {
            state.user = { name: 'Desktop User', email: '' };
            localStorage.setItem('opennotes_user', JSON.stringify(state.user));
          }
          
          state.isAuthenticated = true;
          updateUserProfile();
          hideAuthModal();
          showToast('Successfully signed in!', 'success');
          tokenInput.value = '';
        } catch (e) {
          console.error('[AUTH] Code exchange failed:', e);
          showToast(e.message || 'Invalid or expired code', 'error');
        } finally {
          submitTokenBtn.disabled = false;
          submitTokenBtn.textContent = 'Submit';
        }
      } else {
        // Direct token entry (fallback)
        console.log('[AUTH] Using direct token');
        localStorage.setItem('auth_token_fallback', input);
        state.user = { name: 'Desktop User', email: '' };
        localStorage.setItem('opennotes_user', JSON.stringify(state.user));
        state.isAuthenticated = true;
        updateUserProfile();
        hideAuthModal();
        showToast('Successfully authenticated!', 'success');
        tokenInput.value = '';
      }
    });
  }
  
  // Check authentication state immediately
  if (!checkAuth()) {
    showAuthModal();
    console.log('[INIT] User not authenticated, showing sign-in modal');
  } else {
    hideAuthModal();
    console.log('[INIT] User authenticated:', state.user?.name || state.user?.email);
  }
  
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
  
  // Initialize uploader
  uploader.init();
  
  // Initialize quiz system
  initQuizListeners();
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
  document.querySelector('.modal-backdrop')?.addEventListener('click', closeNoteModal);
  
  // Modal save offline
  document.getElementById('modal-save-offline')?.addEventListener('click', () => {
    if (state.currentNote) {
      storage.saveNoteOffline(state.currentNote);
      closeNoteModal();
    }
  });
  
  // Modal download
  document.getElementById('modal-download')?.addEventListener('click', () => {
    if (state.currentNote && state.currentNote.dl) {
      window.open(state.currentNote.dl, '_blank');
      api.incrementDownloads(state.currentNote.name);
    }
  });
  
  // Modal preview
  document.getElementById('modal-preview')?.addEventListener('click', () => {
    if (state.currentNote) {
      toggleNotePreview();
    }
  });
  
  // Modal open external (opens in system default app)
  document.getElementById('modal-open-external')?.addEventListener('click', async () => {
    if (state.currentNote) {
      await openNoteExternal(state.currentNote);
    }
  });
  
  // Modal share
  document.getElementById('modal-share')?.addEventListener('click', () => {
    if (state.currentNote) {
      shareNote(state.currentNote);
    }
  });
  
  // Preview download fallback button
  document.getElementById('preview-download-instead')?.addEventListener('click', () => {
    if (state.currentNote && state.currentNote.dl) {
      window.open(state.currentNote.dl, '_blank');
      api.incrementDownloads(state.currentNote.name);
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
  });
  
  // Load initial data
  console.log('[INIT] Loading initial notes...');
  console.log('[INIT] API Base URL:', api.getBaseUrl());
  
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
  creatorQuestions: [],
};

// Quiz API Client
const quizApi = {
  async listQuizzes(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.subject) params.set('subject', filters.subject);
      if (filters.topic) params.set('topic', filters.topic);
      if (filters.search) params.set('q', filters.search);
      
      const response = await fetch(`${CONFIG.GATEWAY_URL}/api/quizzes?${params}`);
      if (!response.ok) throw new Error('Failed to fetch quizzes');
      return await response.json();
    } catch (e) {
      console.error('[Quiz API] List error:', e);
      throw e;
    }
  },
  
  async getQuiz(id) {
    try {
      const response = await fetch(`${CONFIG.GATEWAY_URL}/api/quizzes/${id}`);
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
      const response = await fetch(`${CONFIG.GATEWAY_URL}/api/quizzes`, {
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
      const response = await fetch(`${CONFIG.GATEWAY_URL}/api/quizzes/shuffle`, {
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
    shuffleBtn.textContent = quizState.selectedQuizIds.size > 0 
      ? `Shuffle Selected (${quizState.selectedQuizIds.size})`
      : 'Shuffle Selected';
  }
}

async function startQuiz(quizId) {
  try {
    showToast('Loading quiz...', 'info');
    const quiz = await quizApi.getQuiz(quizId);
    
    quizState.currentQuiz = quiz;
    quizState.currentQuestionIndex = 0;
    quizState.answers = {};
    
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
    quizState.selectedQuizIds.clear();
    
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
  const submitBtn = document.getElementById('quiz-submit-btn');
  
  if (!container || !quizState.currentQuiz) return;
  
  const quiz = quizState.currentQuiz;
  const question = quiz.questions[quizState.currentQuestionIndex];
  const totalQuestions = quiz.questions.length;
  const currentNum = quizState.currentQuestionIndex + 1;
  
  titleEl.textContent = quiz.title;
  progressEl.textContent = `Question ${currentNum} of ${totalQuestions}`;
  
  // Update navigation buttons
  prevBtn.disabled = quizState.currentQuestionIndex === 0;
  nextBtn.classList.toggle('hidden', quizState.currentQuestionIndex === totalQuestions - 1);
  submitBtn.classList.toggle('hidden', quizState.currentQuestionIndex !== totalQuestions - 1);
  
  // Get current answer
  const currentAnswer = quizState.answers[question.id];
  
  if (question.type === 'mcq') {
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      <div class="quiz-options">
        ${question.options.map((opt, i) => `
          <div class="quiz-option ${currentAnswer?.includes(i) ? 'selected' : ''}" data-index="${i}">
            <div class="quiz-option-marker">
              <span class="material-symbols-rounded" style="font-size:14px;">check</span>
            </div>
            <div class="quiz-option-text">${renderLatex(opt)}</div>
          </div>
        `).join('')}
      </div>
      ${question.correctAnswers.length > 1 ? '<p style="margin-top:12px;font-size:0.85rem;color:var(--text-muted);">Select all that apply</p>' : ''}
    `;
    
    // Add click handlers
    container.querySelectorAll('.quiz-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const idx = parseInt(opt.dataset.index);
        selectMCQOption(question.id, idx, question.correctAnswers.length > 1);
      });
    });
  } else if (question.type === 'frq') {
    container.innerHTML = `
      <div class="quiz-question-text">${renderLatex(question.question)}</div>
      <input type="text" class="quiz-frq-input" placeholder="Enter your answer..." value="${currentAnswer || ''}">
      <p style="margin-top:8px;font-size:0.85rem;color:var(--text-muted);">Type your answer and press Next</p>
    `;
    
    const input = container.querySelector('.quiz-frq-input');
    input.addEventListener('input', (e) => {
      quizState.answers[question.id] = e.target.value;
    });
    input.focus();
  }
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
  let correct = 0;
  const breakdown = [];
  
  quiz.questions.forEach(question => {
    const userAnswer = quizState.answers[question.id];
    let isCorrect = false;
    
    if (question.type === 'mcq') {
      const userSet = new Set(userAnswer || []);
      const correctSet = new Set(question.correctAnswers);
      isCorrect = userSet.size === correctSet.size && [...userSet].every(x => correctSet.has(x));
    } else if (question.type === 'frq') {
      const answer = (userAnswer || '').toLowerCase().trim();
      isCorrect = question.correctAnswers.some(a => 
        a.toLowerCase().trim() === answer
      );
    }
    
    if (isCorrect) correct++;
    
    breakdown.push({
      question: question.question,
      correct: isCorrect,
      userAnswer,
      correctAnswer: question.type === 'mcq' 
        ? question.correctAnswers.map(i => question.options[i]).join(', ')
        : question.correctAnswers.join(' or '),
    });
  });
  
  // Show results
  showView('quiz-results');
  document.getElementById('results-correct').textContent = correct;
  document.getElementById('results-total').textContent = quiz.questions.length;
  document.getElementById('results-percent').textContent = Math.round((correct / quiz.questions.length) * 100) + '%';
  
  const breakdownEl = document.getElementById('results-breakdown');
  breakdownEl.innerHTML = breakdown.map((item, i) => `
    <div class="results-breakdown-item">
      <span class="material-symbols-rounded results-breakdown-icon ${item.correct ? 'correct' : 'incorrect'}">
        ${item.correct ? 'check_circle' : 'cancel'}
      </span>
      <div class="results-breakdown-content">
        <div class="results-breakdown-question">Q${i + 1}: ${item.question.substring(0, 100)}${item.question.length > 100 ? '...' : ''}</div>
        <div class="results-breakdown-answer">
          ${item.correct ? 'Correct!' : `Your answer: ${Array.isArray(item.userAnswer) ? item.userAnswer.join(', ') : item.userAnswer || '(no answer)'} | Correct: ${item.correctAnswer}`}
        </div>
      </div>
    </div>
  `).join('');
}

// Quiz Creator Functions
function addQuestion(type) {
  const id = `q${Date.now()}`;
  const question = {
    id,
    type,
    question: '',
    options: type === 'mcq' ? ['', '', '', ''] : null,
    correctAnswers: type === 'mcq' ? [] : [''],
    explanation: '',
  };
  
  quizState.creatorQuestions.push(question);
  renderQuestionsList();
}

function renderQuestionsList() {
  const list = document.getElementById('questions-list');
  if (!list) return;
  
  if (quizState.creatorQuestions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">help_outline</span>
        <h3>No questions yet</h3>
        <p>Click "Add MCQ" or "Add FRQ" to add questions to your quiz</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = quizState.creatorQuestions.map((q, i) => `
    <div class="question-item" data-question-id="${q.id}">
      <div class="question-item-header">
        <span class="question-number">Question ${i + 1}</span>
        <span class="question-type-badge">${q.type.toUpperCase()}</span>
        <div class="question-actions">
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
        <label>Question Text (LaTeX supported: use $...$ for inline, $$...$$ for block)</label>
        <textarea class="question-text-input latex-enabled" placeholder="Enter your question..."
          onchange="updateQuestion('${q.id}', 'question', this.value)">${q.question}</textarea>
        <span class="latex-hint">Example: What is $\\int x^2 dx$?</span>
      </div>
      ${q.type === 'mcq' ? renderMCQOptions(q) : renderFRQAnswers(q)}
      <div class="explanation-container">
        <div class="form-group">
          <label>Explanation (optional)</label>
          <textarea placeholder="Explain the correct answer..."
            onchange="updateQuestion('${q.id}', 'explanation', this.value)">${q.explanation || ''}</textarea>
        </div>
      </div>
    </div>
  `).join('');
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

async function saveQuiz() {
  const title = document.getElementById('quiz-title')?.value?.trim();
  const subject = document.getElementById('quiz-subject')?.value?.trim();
  const topic = document.getElementById('quiz-topic')?.value?.trim();
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
    }
  }
  
  try {
    const quiz = {
      title,
      subject,
      topic,
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
  document.getElementById('add-frq-btn')?.addEventListener('click', () => addQuestion('frq'));
  document.getElementById('save-quiz-btn')?.addEventListener('click', saveQuiz);
  
  // Quiz navigation
  document.getElementById('quiz-prev-btn')?.addEventListener('click', () => navigateQuiz(-1));
  document.getElementById('quiz-next-btn')?.addEventListener('click', () => navigateQuiz(1));
  document.getElementById('quiz-submit-btn')?.addEventListener('click', submitQuiz);
  document.getElementById('quit-quiz-btn')?.addEventListener('click', () => showView('quiz-browse'));
  
  // Quiz results
  document.getElementById('retake-quiz-btn')?.addEventListener('click', () => {
    quizState.currentQuestionIndex = 0;
    quizState.answers = {};
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

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

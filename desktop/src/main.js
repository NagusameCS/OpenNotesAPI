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

function toggleDevConsole() {
  const panel = document.getElementById('dev-console');
  if (panel) {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      devConsole.render();
    }
  }
}

// ==================== CONFIGURATION ====================
const CONFIG = {
  API_BASE: 'https://open-notes.tebby2008-li.workers.dev',
  GATEWAY_URL: '', // Set via secrets if using gateway
  APP_TOKEN: '', // Set via secrets
  STORAGE_KEY: 'opennotes_desktop',
  MAX_STORAGE_MB: 500,
  NOTES_PER_PAGE: 20, // Match API default
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
  
  async fetchTrending() {
    return this.fetchNotes({ sort: 'views', limit: 12 });
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
    return this.get('saved_notes') || [];
  },
  
  async saveNoteOffline(note) {
    const saved = this.getSavedNotes();
    
    // Check if already saved
    if (saved.find(n => n.name === note.name)) {
      showToast('Note already saved offline', 'info');
      return false;
    }
    
    // Download and cache the file
    try {
      const response = await httpFetch(note.dl);
      const blob = await response.blob();
      const base64 = await this.blobToBase64(blob);
      
      const noteData = {
        ...note,
        cachedFile: base64,
        cachedAt: Date.now(),
        fileSize: blob.size,
      };
      
      saved.push(noteData);
      this.set('saved_notes', saved);
      state.savedNotes = saved;
      
      showToast('Note saved for offline access', 'success');
      return true;
    } catch (error) {
      console.error('Failed to save note offline:', error);
      showToast('Failed to save note offline', 'error');
      return false;
    }
  },
  
  removeOfflineNote(name) {
    let saved = this.getSavedNotes();
    saved = saved.filter(n => n.name !== name);
    this.set('saved_notes', saved);
    state.savedNotes = saved;
    showToast('Note removed from offline storage', 'info');
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
    renderSavedNotes();
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
  
  return `
    <article class="note-card" data-note-id="${escapeHtml(note.name)}">
      <div class="note-thumbnail">
        <img src="${note.img || 'https://via.placeholder.com/320x200?text=No+Preview'}" 
             alt="${escapeHtml(note.name)}" 
             loading="lazy"
             onerror="this.src='https://via.placeholder.com/320x200?text=No+Preview'">
        <span class="format-badge ${format}">${format.toUpperCase()}</span>
      </div>
      <div class="note-content">
        <h3 class="note-title">${escapeHtml(note.name)}</h3>
        <div class="note-meta">
          <span class="note-author">
            <span class="material-symbols-rounded">person</span>
            ${escapeHtml(note.author || 'Unknown')}
          </span>
          <div class="note-stats">
            <span class="note-stat">
              <span class="material-symbols-rounded">visibility</span>
              ${formatNumber(note.views || 0)}
            </span>
            <span class="note-stat">
              <span class="material-symbols-rounded">download</span>
              ${formatNumber(note.downloads || 0)}
            </span>
          </div>
        </div>
      </div>
      <div class="note-actions">
        <button class="note-action-btn btn-save-offline ${isSaved ? 'saved' : ''}" title="${isSaved ? 'Remove from offline' : 'Save offline'}">
          <span class="material-symbols-rounded">${isSaved ? 'bookmark' : 'bookmark_border'}</span>
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

function renderSavedNotes() {
  const container = document.getElementById('saved-grid');
  const emptyState = document.getElementById('saved-empty');
  
  if (!container) return;
  
  state.savedNotes = storage.getSavedNotes();
  
  if (state.savedNotes.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  
  container.innerHTML = state.savedNotes.map(note => `
    <article class="note-card" data-note-id="${escapeHtml(note.name)}">
      <div class="note-thumbnail">
        <img src="${note.img || 'https://via.placeholder.com/320x200?text=No+Preview'}" 
             alt="${escapeHtml(note.name)}" 
             loading="lazy">
        <span class="format-badge ${getFileFormat(note.name)}">${getFileFormat(note.name).toUpperCase()}</span>
      </div>
      <div class="note-content">
        <h3 class="note-title">${escapeHtml(note.name)}</h3>
        <div class="note-meta">
          <span class="note-author">
            <span class="material-symbols-rounded">person</span>
            ${escapeHtml(note.author || 'Unknown')}
          </span>
          <span class="note-stat">
            <span class="material-symbols-rounded">save</span>
            ${formatBytes(note.fileSize || 0)}
          </span>
        </div>
      </div>
      <div class="note-actions">
        <button class="note-action-btn" onclick="openOfflineNote('${escapeHtml(note.name)}')" title="Open">
          <span class="material-symbols-rounded">open_in_new</span>
        </button>
        <button class="note-action-btn" onclick="storage.removeOfflineNote('${escapeHtml(note.name)}'); renderSavedNotes();" title="Remove">
          <span class="material-symbols-rounded">delete</span>
        </button>
      </div>
    </article>
  `).join('');
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

async function loadTrending() {
  const container = document.getElementById('trending-content');
  if (!container) return;
  
  try {
    const result = await api.fetchTrending();
    const notes = result.notes || result.data || [];
    renderNotesGrid(notes, 'trending-content');
  } catch (error) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-rounded">trending_up</span>
        <h3>Failed to load trending</h3>
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
  
  // Populate modal
  document.getElementById('modal-title').textContent = note.name;
  document.getElementById('modal-thumbnail').src = note.img || 'https://via.placeholder.com/600x400?text=No+Preview';
  document.getElementById('modal-author').textContent = note.author || 'Unknown';
  document.getElementById('modal-format').textContent = getFileFormat(note.name).toUpperCase();
  document.getElementById('modal-views').textContent = formatNumber(note.views || 0);
  document.getElementById('modal-downloads').textContent = formatNumber(note.downloads || 0);
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
  state.currentNote = null;
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
    trending: 'Trending',
    saved: 'Saved Offline',
    editor: 'New Document',
    upload: 'Upload Notes',
    'my-uploads': 'My Uploads',
    storage: 'Storage',
  };
  
  document.getElementById('view-title').textContent = titles[viewId] || 'OpenNotes';
  state.activeView = viewId;
  
  // Load data for specific views
  if (viewId === 'browse' && state.notes.length === 0) loadNotes();
  if (viewId === 'trending') loadTrending();
  if (viewId === 'saved') renderSavedNotes();
  if (viewId === 'storage') {
    storage.updateStorageIndicator();
    renderStorageBreakdown();
  }
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
  return 'pdf';
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
  
  // Initialize uploader
  uploader.init();
  
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

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

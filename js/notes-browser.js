/**
 * OpenNotes Browser Module
 * UI components for browsing and displaying notes.
 * 
 * Features:
 * - Note card rendering
 * - Grid and list views
 * - Infinite scroll
 * - Filtering and sorting
 * - Favorites management
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class NotesBrowser {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' 
            ? document.querySelector(container) 
            : container;
        
        if (!this.container) {
            throw new Error('NotesBrowser: Container element not found');
        }

        this.api = options.api || openNotesAPI;
        this.options = {
            viewMode: options.viewMode || 'grid',
            pageSize: options.pageSize || 20,
            showFilters: options.showFilters !== false,
            showSorting: options.showSorting !== false,
            showPagination: options.showPagination !== false,
            infiniteScroll: options.infiniteScroll || false,
            onNoteClick: options.onNoteClick || null,
            onDownload: options.onDownload || null,
            showThumbnails: options.showThumbnails !== false,
            enableFavorites: options.enableFavorites || false
        };

        this.state = {
            notes: [],
            currentPage: 1,
            totalNotes: 0,
            loading: false,
            error: null,
            filters: {
                format: null,
                author: null,
                verified: false,
                query: ''
            },
            sort: 'relevance'
        };

        this.favorites = this.loadFavorites();
        this.init();
    }

    // ==================== INITIALIZATION ====================

    init() {
        this.render();
        this.bindEvents();
        this.loadNotes();
    }

    render() {
        this.container.innerHTML = `
            <div class="notes-browser">
                ${this.options.showFilters ? this.renderFilters() : ''}
                ${this.options.showSorting ? this.renderSorting() : ''}
                <div class="notes-toolbar">
                    <div class="view-toggle">
                        <button class="btn-view ${this.options.viewMode === 'grid' ? 'active' : ''}" data-view="grid" title="Grid View">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/>
                            </svg>
                        </button>
                        <button class="btn-view ${this.options.viewMode === 'list' ? 'active' : ''}" data-view="list" title="List View">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h16v2H4v-2z"/>
                            </svg>
                        </button>
                    </div>
                    <div class="notes-count">
                        <span class="count-value">0</span> notes
                    </div>
                </div>
                <div class="notes-container ${this.options.viewMode}-view"></div>
                <div class="notes-loading" style="display: none;">
                    <div class="spinner"></div>
                    <p>Loading notes...</p>
                </div>
                <div class="notes-error" style="display: none;">
                    <p class="error-message"></p>
                    <button class="btn-retry">Retry</button>
                </div>
                ${this.options.showPagination ? this.renderPagination() : ''}
            </div>
        `;

        // Cache DOM references
        this.notesContainer = this.container.querySelector('.notes-container');
        this.loadingEl = this.container.querySelector('.notes-loading');
        this.errorEl = this.container.querySelector('.notes-error');
        this.countEl = this.container.querySelector('.count-value');
    }

    renderFilters() {
        return `
            <div class="notes-filters">
                <div class="filter-group">
                    <label for="filter-search">Search</label>
                    <input type="text" id="filter-search" class="filter-input" placeholder="Search notes...">
                </div>
                <div class="filter-group">
                    <label for="filter-format">Format</label>
                    <select id="filter-format" class="filter-select">
                        <option value="">All Formats</option>
                        <option value="pdf">PDF</option>
                        <option value="docx">Word (DOCX)</option>
                        <option value="doc">Word (DOC)</option>
                        <option value="pptx">PowerPoint</option>
                        <option value="xlsx">Excel</option>
                        <option value="txt">Text</option>
                        <option value="md">Markdown</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="filter-author">Author</label>
                    <select id="filter-author" class="filter-select">
                        <option value="">All Authors</option>
                    </select>
                </div>
                <div class="filter-group filter-checkbox">
                    <label>
                        <input type="checkbox" id="filter-verified">
                        Verified Only
                    </label>
                </div>
                <button class="btn-clear-filters">Clear Filters</button>
            </div>
        `;
    }

    renderSorting() {
        return `
            <div class="notes-sorting">
                <label for="sort-select">Sort by:</label>
                <select id="sort-select" class="sort-select">
                    <option value="relevance">Relevance</option>
                    <option value="views">Most Viewed</option>
                    <option value="downloads">Most Downloaded</option>
                    <option value="updated">Recently Updated</option>
                    <option value="name">Name (A-Z)</option>
                    <option value="name-desc">Name (Z-A)</option>
                    <option value="size">Size (Largest)</option>
                    <option value="size-asc">Size (Smallest)</option>
                </select>
            </div>
        `;
    }

    renderPagination() {
        return `
            <div class="notes-pagination">
                <button class="btn-page btn-prev" disabled>Previous</button>
                <div class="page-info">
                    Page <span class="current-page">1</span> of <span class="total-pages">1</span>
                </div>
                <button class="btn-page btn-next" disabled>Next</button>
            </div>
        `;
    }

    // ==================== DATA LOADING ====================

    async loadNotes(page = 1) {
        if (this.state.loading) return;

        this.state.loading = true;
        this.state.currentPage = page;
        this.showLoading();

        try {
            const response = await this.api.searchNotes(
                this.state.filters.query,
                {
                    sort: this.state.sort,
                    limit: this.options.pageSize,
                    offset: (page - 1) * this.options.pageSize,
                    format: this.state.filters.format,
                    author: this.state.filters.author,
                    verifiedOnly: this.state.filters.verified
                }
            );

            this.state.notes = response?.items || [];
            this.state.totalNotes = response?.meta?.total || this.state.notes.length;
            this.state.error = null;

            this.renderNotes();
            this.updateCount();
            this.updatePagination();
            this.populateAuthorFilter(response?.items || []);

        } catch (error) {
            this.state.error = error;
            this.showError(error.message);
        } finally {
            this.state.loading = false;
            this.hideLoading();
        }
    }

    async loadMore() {
        if (this.state.loading) return;
        
        const nextPage = this.state.currentPage + 1;
        const maxPages = Math.ceil(this.state.totalNotes / this.options.pageSize);
        
        if (nextPage > maxPages) return;

        this.state.loading = true;
        this.showLoading();

        try {
            const response = await this.api.searchNotes(
                this.state.filters.query,
                {
                    sort: this.state.sort,
                    limit: this.options.pageSize,
                    offset: (nextPage - 1) * this.options.pageSize,
                    format: this.state.filters.format,
                    author: this.state.filters.author,
                    verifiedOnly: this.state.filters.verified
                }
            );

            const newNotes = response?.items || [];
            this.state.notes = [...this.state.notes, ...newNotes];
            this.state.currentPage = nextPage;

            this.renderNotes(true);

        } catch (error) {
            console.error('Load more error:', error);
        } finally {
            this.state.loading = false;
            this.hideLoading();
        }
    }

    // ==================== RENDERING ====================

    renderNotes(append = false) {
        if (!append) {
            this.notesContainer.innerHTML = '';
        }

        if (this.state.notes.length === 0) {
            this.notesContainer.innerHTML = `
                <div class="no-notes">
                    <p>No notes found.</p>
                    <p>Try adjusting your filters or search query.</p>
                </div>
            `;
            return;
        }

        const notesToRender = append 
            ? this.state.notes.slice(-this.options.pageSize)
            : this.state.notes;

        const fragment = document.createDocumentFragment();
        notesToRender.forEach(note => {
            const card = this.createNoteCard(note);
            fragment.appendChild(card);
        });

        this.notesContainer.appendChild(fragment);
    }

    createNoteCard(note) {
        const card = document.createElement('div');
        card.className = 'note-card';
        card.dataset.noteId = note.id;
        card.dataset.noteName = note.name;

        const isFavorite = this.favorites.includes(note.name);
        const formatIcon = this.getFormatIcon(note.fmt || note.format);

        card.innerHTML = `
            ${this.options.showThumbnails ? `
                <div class="note-thumbnail">
                    <img src="${note.thumb}" alt="${note.title}" loading="lazy" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 200%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22200%22/><text x=%22100%22 y=%22100%22 text-anchor=%22middle%22 fill=%22%23999%22>No Preview</text></svg>'">
                    ${note.is_verified ? '<span class="badge verified" title="Verified">✓</span>' : ''}
                    ${note.ai ? '<span class="badge ai" title="AI Generated">AI</span>' : ''}
                </div>
            ` : ''}
            <div class="note-content">
                <h3 class="note-title">${this.escapeHtml(note.title)}</h3>
                <div class="note-meta">
                    <span class="note-author">${formatIcon} ${this.escapeHtml(note.auth || 'Unknown')}</span>
                    <span class="note-format">${(note.fmt || note.format || '').toUpperCase()}</span>
                </div>
                <div class="note-stats">
                    <span class="stat views" title="Views">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                        </svg>
                        ${this.formatNumber(note.v || 0)}
                    </span>
                    <span class="stat downloads" title="Downloads">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                        </svg>
                        ${this.formatNumber(note.d || 0)}
                    </span>
                    <span class="stat size" title="File Size">${note.size || 'N/A'}</span>
                </div>
                <div class="note-updated">
                    Updated: ${this.formatDate(note.upd)}
                </div>
            </div>
            <div class="note-actions">
                ${this.options.enableFavorites ? `
                    <button class="btn-favorite ${isFavorite ? 'active' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                    </button>
                ` : ''}
                <button class="btn-view-note" title="View Details">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
                    </svg>
                </button>
                <a class="btn-download" href="${note.dl}" target="_blank" download title="Download">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                </a>
            </div>
        `;

        return card;
    }

    // ==================== EVENT HANDLING ====================

    bindEvents() {
        // View toggle
        this.container.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.setViewMode(view);
            });
        });

        // Filter events
        if (this.options.showFilters) {
            const searchInput = this.container.querySelector('#filter-search');
            if (searchInput) {
                let debounceTimer;
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        this.state.filters.query = e.target.value;
                        this.loadNotes(1);
                    }, 300);
                });
            }

            const formatSelect = this.container.querySelector('#filter-format');
            if (formatSelect) {
                formatSelect.addEventListener('change', (e) => {
                    this.state.filters.format = e.target.value || null;
                    this.loadNotes(1);
                });
            }

            const authorSelect = this.container.querySelector('#filter-author');
            if (authorSelect) {
                authorSelect.addEventListener('change', (e) => {
                    this.state.filters.author = e.target.value || null;
                    this.loadNotes(1);
                });
            }

            const verifiedCheckbox = this.container.querySelector('#filter-verified');
            if (verifiedCheckbox) {
                verifiedCheckbox.addEventListener('change', (e) => {
                    this.state.filters.verified = e.target.checked;
                    this.loadNotes(1);
                });
            }

            const clearBtn = this.container.querySelector('.btn-clear-filters');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => this.clearFilters());
            }
        }

        // Sort events
        if (this.options.showSorting) {
            const sortSelect = this.container.querySelector('#sort-select');
            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    this.state.sort = e.target.value;
                    this.loadNotes(1);
                });
            }
        }

        // Pagination events
        if (this.options.showPagination) {
            const prevBtn = this.container.querySelector('.btn-prev');
            const nextBtn = this.container.querySelector('.btn-next');

            if (prevBtn) {
                prevBtn.addEventListener('click', () => {
                    if (this.state.currentPage > 1) {
                        this.loadNotes(this.state.currentPage - 1);
                    }
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', () => {
                    const maxPages = Math.ceil(this.state.totalNotes / this.options.pageSize);
                    if (this.state.currentPage < maxPages) {
                        this.loadNotes(this.state.currentPage + 1);
                    }
                });
            }
        }

        // Note card events
        this.notesContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.note-card');
            if (!card) return;

            const noteName = card.dataset.noteName;
            const note = this.state.notes.find(n => n.name === noteName);

            if (e.target.closest('.btn-favorite')) {
                this.toggleFavorite(noteName);
                return;
            }

            if (e.target.closest('.btn-view-note')) {
                if (this.options.onNoteClick) {
                    this.options.onNoteClick(note);
                }
                return;
            }

            if (e.target.closest('.btn-download')) {
                this.handleDownload(note);
                return;
            }

            // Default: view note
            if (this.options.onNoteClick) {
                this.options.onNoteClick(note);
            }
        });

        // Retry button
        const retryBtn = this.container.querySelector('.btn-retry');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.loadNotes(this.state.currentPage));
        }

        // Infinite scroll
        if (this.options.infiniteScroll) {
            this.setupInfiniteScroll();
        }
    }

    setupInfiniteScroll() {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !this.state.loading) {
                    this.loadMore();
                }
            },
            { threshold: 0.1 }
        );

        // Create sentinel element
        const sentinel = document.createElement('div');
        sentinel.className = 'scroll-sentinel';
        this.container.appendChild(sentinel);
        observer.observe(sentinel);
    }

    // ==================== FAVORITES ====================

    loadFavorites() {
        try {
            return JSON.parse(localStorage.getItem('openNotes_favorites') || '[]');
        } catch {
            return [];
        }
    }

    saveFavorites() {
        localStorage.setItem('openNotes_favorites', JSON.stringify(this.favorites));
    }

    toggleFavorite(noteName) {
        const index = this.favorites.indexOf(noteName);
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push(noteName);
        }
        this.saveFavorites();
        
        // Update UI
        const card = this.notesContainer.querySelector(`[data-note-name="${noteName}"]`);
        if (card) {
            const btn = card.querySelector('.btn-favorite');
            if (btn) {
                btn.classList.toggle('active');
                const svg = btn.querySelector('svg');
                if (svg) {
                    svg.setAttribute('fill', this.favorites.includes(noteName) ? 'currentColor' : 'none');
                }
            }
        }
    }

    getFavorites() {
        return this.favorites;
    }

    async loadFavoriteNotes() {
        if (this.favorites.length === 0) {
            this.state.notes = [];
            this.renderNotes();
            return;
        }

        this.state.loading = true;
        this.showLoading();

        try {
            const notes = await this.api.batchGetNotes(this.favorites);
            this.state.notes = notes.filter(n => n !== null);
            this.renderNotes();
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.state.loading = false;
            this.hideLoading();
        }
    }

    // ==================== UI UPDATES ====================

    setViewMode(mode) {
        this.options.viewMode = mode;
        this.notesContainer.className = `notes-container ${mode}-view`;
        
        this.container.querySelectorAll('.btn-view').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });
    }

    showLoading() {
        if (this.loadingEl) this.loadingEl.style.display = 'flex';
        if (this.errorEl) this.errorEl.style.display = 'none';
    }

    hideLoading() {
        if (this.loadingEl) this.loadingEl.style.display = 'none';
    }

    showError(message) {
        if (this.errorEl) {
            this.errorEl.style.display = 'flex';
            const msgEl = this.errorEl.querySelector('.error-message');
            if (msgEl) {
                // Check if it's a connection/fetch error
                if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('ERR_NAME_NOT_RESOLVED')) {
                    msgEl.innerHTML = `
                        <strong>API Connection Unavailable</strong><br>
                        Unable to connect to the OpenNotes API. This could be due to network issues or the API may be temporarily unavailable.
                        <br><br>
                        <button onclick="openAccessModal()" class="btn btn-secondary" style="margin-right: 8px;">Request API Access</button>
                    `;
                } else {
                    msgEl.textContent = message;
                }
            }
        }
    }

    updateCount() {
        if (this.countEl) {
            this.countEl.textContent = this.state.totalNotes;
        }
    }

    updatePagination() {
        if (!this.options.showPagination) return;

        const totalPages = Math.ceil(this.state.totalNotes / this.options.pageSize) || 1;
        const currentPage = this.state.currentPage;

        const currentPageEl = this.container.querySelector('.current-page');
        const totalPagesEl = this.container.querySelector('.total-pages');
        const prevBtn = this.container.querySelector('.btn-prev');
        const nextBtn = this.container.querySelector('.btn-next');

        if (currentPageEl) currentPageEl.textContent = currentPage;
        if (totalPagesEl) totalPagesEl.textContent = totalPages;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    }

    populateAuthorFilter(notes) {
        const authorSelect = this.container.querySelector('#filter-author');
        if (!authorSelect) return;

        const authors = new Set();
        notes.forEach(note => {
            if (note.auth) authors.add(note.auth);
        });

        const currentValue = authorSelect.value;
        authorSelect.innerHTML = '<option value="">All Authors</option>';
        
        Array.from(authors).sort().forEach(author => {
            const option = document.createElement('option');
            option.value = author;
            option.textContent = author;
            if (author === currentValue) option.selected = true;
            authorSelect.appendChild(option);
        });
    }

    clearFilters() {
        this.state.filters = {
            format: null,
            author: null,
            verified: false,
            query: ''
        };

        const searchInput = this.container.querySelector('#filter-search');
        const formatSelect = this.container.querySelector('#filter-format');
        const authorSelect = this.container.querySelector('#filter-author');
        const verifiedCheckbox = this.container.querySelector('#filter-verified');

        if (searchInput) searchInput.value = '';
        if (formatSelect) formatSelect.value = '';
        if (authorSelect) authorSelect.value = '';
        if (verifiedCheckbox) verifiedCheckbox.checked = false;

        this.loadNotes(1);
    }

    async handleDownload(note) {
        try {
            await this.api.incrementDownloads(note.name);
            if (this.options.onDownload) {
                this.options.onDownload(note);
            }
        } catch (error) {
            console.error('Download tracking error:', error);
        }
    }

    // ==================== UTILITY METHODS ====================

    getFormatIcon(format) {
        const icons = {
            pdf: '📕',
            docx: '📘',
            doc: '📘',
            pptx: '📙',
            xlsx: '📗',
            txt: '📄',
            md: '📝'
        };
        return icons[format?.toLowerCase()] || '📄';
    }

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ==================== PUBLIC API ====================

    refresh() {
        this.loadNotes(1);
    }

    getNotes() {
        return this.state.notes;
    }

    getState() {
        return { ...this.state };
    }

    setFilter(key, value) {
        this.state.filters[key] = value;
        this.loadNotes(1);
    }

    setSort(sort) {
        this.state.sort = sort;
        const sortSelect = this.container.querySelector('#sort-select');
        if (sortSelect) sortSelect.value = sort;
        this.loadNotes(1);
    }

    destroy() {
        this.container.innerHTML = '';
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotesBrowser;
}

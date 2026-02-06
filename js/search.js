/**
 * OpenNotes Search Module
 * Advanced search functionality with autocomplete, suggestions, and history.
 * 
 * Features:
 * - Real-time search
 * - Search suggestions
 * - Search history
 * - Advanced filters
 * - Query parsing
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesSearch {
    constructor(options = {}) {
        this.api = options.api || openNotesAPI;
        this.container = options.container 
            ? (typeof options.container === 'string' 
                ? document.querySelector(options.container) 
                : options.container)
            : null;
        
        this.options = {
            debounceMs: options.debounceMs || 300,
            minChars: options.minChars || 2,
            maxSuggestions: options.maxSuggestions || 8,
            maxHistory: options.maxHistory || 10,
            showHistory: options.showHistory !== false,
            showSuggestions: options.showSuggestions !== false,
            onSearch: options.onSearch || null,
            onSelect: options.onSelect || null,
            placeholder: options.placeholder || 'Search notes...'
        };

        this.state = {
            query: '',
            suggestions: [],
            isOpen: false,
            selectedIndex: -1,
            loading: false
        };

        this.searchHistory = this.loadHistory();
        this.debounceTimer = null;

        if (this.container) {
            this.render();
            this.bindEvents();
        }
    }

    // ==================== RENDERING ====================

    render() {
        this.container.innerHTML = `
            <div class="search-wrapper">
                <div class="search-input-container">
                    <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <input type="text" 
                           class="search-input" 
                           placeholder="${this.options.placeholder}"
                           autocomplete="off"
                           aria-label="Search notes">
                    <button class="search-clear" style="display: none;" aria-label="Clear search">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                    <div class="search-spinner" style="display: none;">
                        <div class="spinner-small"></div>
                    </div>
                </div>
                <div class="search-dropdown" style="display: none;">
                    <div class="search-history-section">
                        <div class="dropdown-header">
                            <span>Recent Searches</span>
                            <button class="clear-history">Clear</button>
                        </div>
                        <ul class="history-list"></ul>
                    </div>
                    <div class="search-suggestions-section">
                        <div class="dropdown-header">
                            <span>Suggestions</span>
                        </div>
                        <ul class="suggestions-list"></ul>
                    </div>
                </div>
            </div>
        `;

        // Cache DOM references
        this.inputEl = this.container.querySelector('.search-input');
        this.clearBtn = this.container.querySelector('.search-clear');
        this.spinnerEl = this.container.querySelector('.search-spinner');
        this.dropdownEl = this.container.querySelector('.search-dropdown');
        this.historySection = this.container.querySelector('.search-history-section');
        this.historyList = this.container.querySelector('.history-list');
        this.suggestionsSection = this.container.querySelector('.search-suggestions-section');
        this.suggestionsList = this.container.querySelector('.suggestions-list');
    }

    // ==================== EVENT BINDING ====================

    bindEvents() {
        // Input events
        this.inputEl.addEventListener('input', (e) => this.handleInput(e));
        this.inputEl.addEventListener('focus', () => this.handleFocus());
        this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));

        // Clear button
        this.clearBtn.addEventListener('click', () => this.clear());

        // Clear history
        const clearHistoryBtn = this.container.querySelector('.clear-history');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => this.clearHistory());
        }

        // Click on suggestions/history
        this.dropdownEl.addEventListener('click', (e) => {
            const item = e.target.closest('.dropdown-item');
            if (item) {
                this.selectItem(item.dataset.value);
            }
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.closeDropdown();
            }
        });
    }

    // ==================== EVENT HANDLERS ====================

    handleInput(e) {
        const query = e.target.value.trim();
        this.state.query = query;

        // Show/hide clear button
        this.clearBtn.style.display = query ? 'flex' : 'none';

        // Debounce search
        clearTimeout(this.debounceTimer);

        if (query.length >= this.options.minChars) {
            this.showSpinner();
            this.debounceTimer = setTimeout(() => {
                this.fetchSuggestions(query);
            }, this.options.debounceMs);
        } else {
            this.state.suggestions = [];
            this.showHistoryOnly();
        }
    }

    handleFocus() {
        if (this.state.query.length >= this.options.minChars) {
            this.openDropdown();
        } else {
            this.showHistoryOnly();
        }
    }

    handleKeydown(e) {
        const items = this.dropdownEl.querySelectorAll('.dropdown-item');
        const itemCount = items.length;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                this.state.selectedIndex = Math.min(this.state.selectedIndex + 1, itemCount - 1);
                this.updateSelection(items);
                break;

            case 'ArrowUp':
                e.preventDefault();
                this.state.selectedIndex = Math.max(this.state.selectedIndex - 1, -1);
                this.updateSelection(items);
                break;

            case 'Enter':
                e.preventDefault();
                if (this.state.selectedIndex >= 0 && items[this.state.selectedIndex]) {
                    this.selectItem(items[this.state.selectedIndex].dataset.value);
                } else if (this.state.query) {
                    this.performSearch(this.state.query);
                }
                break;

            case 'Escape':
                this.closeDropdown();
                this.inputEl.blur();
                break;
        }
    }

    updateSelection(items) {
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.state.selectedIndex);
        });

        if (this.state.selectedIndex >= 0 && items[this.state.selectedIndex]) {
            items[this.state.selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // ==================== SUGGESTIONS ====================

    async fetchSuggestions(query) {
        this.state.loading = true;

        try {
            const response = await this.api.searchNotes(query, {
                limit: this.options.maxSuggestions
            });

            const notes = response?.items || [];
            this.state.suggestions = notes.map(note => ({
                value: note.title,
                name: note.name,
                type: 'note',
                format: note.fmt || note.format,
                author: note.auth
            }));

            this.renderDropdown();
            this.openDropdown();

        } catch (error) {
            console.error('Search suggestions error:', error);
            this.state.suggestions = [];
        } finally {
            this.state.loading = false;
            this.hideSpinner();
        }
    }

    renderDropdown() {
        // Render history
        if (this.options.showHistory && this.searchHistory.length > 0) {
            this.historySection.style.display = 'block';
            this.historyList.innerHTML = this.searchHistory
                .map(item => `
                    <li class="dropdown-item history-item" data-value="${this.escapeHtml(item)}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>
                        </svg>
                        <span>${this.escapeHtml(item)}</span>
                    </li>
                `).join('');
        } else {
            this.historySection.style.display = 'none';
        }

        // Render suggestions
        if (this.options.showSuggestions && this.state.suggestions.length > 0) {
            this.suggestionsSection.style.display = 'block';
            this.suggestionsList.innerHTML = this.state.suggestions
                .map(item => `
                    <li class="dropdown-item suggestion-item" data-value="${this.escapeHtml(item.value)}">
                        <span class="suggestion-icon">${this.getFormatIcon(item.format)}</span>
                        <div class="suggestion-content">
                            <span class="suggestion-title">${this.highlightMatch(item.value, this.state.query)}</span>
                            <span class="suggestion-meta">${this.escapeHtml(item.author || '')} · ${(item.format || '').toUpperCase()}</span>
                        </div>
                    </li>
                `).join('');
        } else {
            this.suggestionsSection.style.display = 'none';
        }

        this.state.selectedIndex = -1;
    }

    showHistoryOnly() {
        this.state.suggestions = [];
        this.renderDropdown();
        if (this.searchHistory.length > 0) {
            this.openDropdown();
        } else {
            this.closeDropdown();
        }
    }

    // ==================== SEARCH EXECUTION ====================

    async performSearch(query) {
        if (!query) return;

        this.addToHistory(query);
        this.closeDropdown();

        if (this.options.onSearch) {
            this.options.onSearch(query);
        }

        return this.search(query);
    }

    async search(query, options = {}) {
        try {
            const response = await this.api.searchNotes(query, options);
            return response;
        } catch (error) {
            console.error('Search error:', error);
            throw error;
        }
    }

    selectItem(value) {
        this.inputEl.value = value;
        this.state.query = value;
        this.clearBtn.style.display = 'flex';
        this.performSearch(value);

        if (this.options.onSelect) {
            this.options.onSelect(value);
        }
    }

    // ==================== ADVANCED SEARCH ====================

    /**
     * Parse advanced search query
     * Supports: author:name, format:pdf, is:verified, etc.
     */
    parseAdvancedQuery(query) {
        const result = {
            text: '',
            filters: {}
        };

        const patterns = {
            author: /author:([^\s]+)/gi,
            format: /format:([^\s]+)/gi,
            is: /is:([^\s]+)/gi,
            before: /before:([^\s]+)/gi,
            after: /after:([^\s]+)/gi
        };

        let cleanQuery = query;

        // Extract filters
        for (const [key, pattern] of Object.entries(patterns)) {
            const matches = query.matchAll(pattern);
            for (const match of matches) {
                if (!result.filters[key]) {
                    result.filters[key] = [];
                }
                result.filters[key].push(match[1]);
                cleanQuery = cleanQuery.replace(match[0], '');
            }
        }

        result.text = cleanQuery.trim();
        return result;
    }

    /**
     * Perform advanced search with parsed query
     */
    async advancedSearch(query, additionalOptions = {}) {
        const parsed = this.parseAdvancedQuery(query);
        
        const options = {
            ...additionalOptions
        };

        // Apply parsed filters
        if (parsed.filters.author?.length) {
            options.author = parsed.filters.author[0];
        }
        if (parsed.filters.format?.length) {
            options.format = parsed.filters.format[0];
        }
        if (parsed.filters.is?.includes('verified')) {
            options.verifiedOnly = true;
        }

        return this.api.searchNotes(parsed.text, options);
    }

    /**
     * Full-text search across all fields
     */
    async fullTextSearch(query, options = {}) {
        const response = await this.api.getNotes({ limit: 1000 });
        const notes = response?.items || [];
        const queryLower = query.toLowerCase();

        const results = notes.filter(note => {
            const searchableText = [
                note.title,
                note.name,
                note.auth,
                note.fmt || note.format
            ].join(' ').toLowerCase();

            return searchableText.includes(queryLower);
        });

        // Score and sort results
        const scored = results.map(note => {
            let score = 0;
            const titleLower = (note.title || '').toLowerCase();
            
            if (titleLower === queryLower) score += 100;
            else if (titleLower.startsWith(queryLower)) score += 50;
            else if (titleLower.includes(queryLower)) score += 25;
            
            if ((note.auth || '').toLowerCase().includes(queryLower)) score += 10;
            
            score += (note.v || 0) / 100; // Boost by views
            
            return { note, score };
        });

        scored.sort((a, b) => b.score - a.score);

        const limit = options.limit || 20;
        return {
            items: scored.slice(0, limit).map(s => s.note),
            meta: {
                total: scored.length
            }
        };
    }

    // ==================== SEARCH HISTORY ====================

    loadHistory() {
        try {
            return JSON.parse(localStorage.getItem('openNotes_searchHistory') || '[]');
        } catch {
            return [];
        }
    }

    saveHistory() {
        localStorage.setItem('openNotes_searchHistory', JSON.stringify(this.searchHistory));
    }

    addToHistory(query) {
        // Remove duplicate
        this.searchHistory = this.searchHistory.filter(q => q !== query);
        
        // Add to front
        this.searchHistory.unshift(query);
        
        // Limit size
        if (this.searchHistory.length > this.options.maxHistory) {
            this.searchHistory = this.searchHistory.slice(0, this.options.maxHistory);
        }

        this.saveHistory();
    }

    clearHistory() {
        this.searchHistory = [];
        this.saveHistory();
        this.renderDropdown();
        this.closeDropdown();
    }

    getHistory() {
        return [...this.searchHistory];
    }

    // ==================== UI HELPERS ====================

    openDropdown() {
        this.state.isOpen = true;
        this.dropdownEl.style.display = 'block';
    }

    closeDropdown() {
        this.state.isOpen = false;
        this.dropdownEl.style.display = 'none';
        this.state.selectedIndex = -1;
    }

    showSpinner() {
        this.spinnerEl.style.display = 'flex';
    }

    hideSpinner() {
        this.spinnerEl.style.display = 'none';
    }

    clear() {
        this.inputEl.value = '';
        this.state.query = '';
        this.state.suggestions = [];
        this.clearBtn.style.display = 'none';
        this.closeDropdown();
        this.inputEl.focus();

        if (this.options.onSearch) {
            this.options.onSearch('');
        }
    }

    setValue(value) {
        this.inputEl.value = value;
        this.state.query = value;
        this.clearBtn.style.display = value ? 'flex' : 'none';
    }

    getValue() {
        return this.state.query;
    }

    focus() {
        this.inputEl.focus();
    }

    // ==================== UTILITY METHODS ====================

    highlightMatch(text, query) {
        if (!query) return this.escapeHtml(text);
        const escaped = this.escapeHtml(text);
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

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

    // ==================== DESTRUCTION ====================

    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

/**
 * Static search helper functions
 */
OpenNotesSearch.helpers = {
    /**
     * Quick search without UI
     */
    async quickSearch(query, options = {}) {
        const api = options.api || openNotesAPI;
        return api.searchNotes(query, options);
    },

    /**
     * Find notes by keyword in title
     */
    async findByKeyword(keyword, options = {}) {
        const api = options.api || openNotesAPI;
        const response = await api.getNotes({ limit: 1000 });
        const notes = response?.items || [];
        const keywordLower = keyword.toLowerCase();
        
        return notes.filter(note => 
            (note.title || '').toLowerCase().includes(keywordLower)
        );
    },

    /**
     * Find related notes (by same author or similar title)
     */
    async findRelated(note, options = {}) {
        const api = options.api || openNotesAPI;
        const response = await api.getNotes({ limit: 1000 });
        const notes = response?.items || [];
        
        const related = notes.filter(n => {
            if (n.name === note.name) return false;
            if (n.auth === note.auth) return true;
            
            // Check title similarity
            const words1 = (note.title || '').toLowerCase().split(/\s+/);
            const words2 = (n.title || '').toLowerCase().split(/\s+/);
            const common = words1.filter(w => words2.includes(w) && w.length > 3);
            return common.length >= 2;
        });

        const limit = options.limit || 5;
        return related.slice(0, limit);
    }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenNotesSearch;
}

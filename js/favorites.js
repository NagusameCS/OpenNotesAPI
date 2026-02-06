/**
 * OpenNotes Favorites Module
 * Manage favorite/bookmarked notes with persistence.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesFavorites {
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'opennotes_favorites';
        this.maxFavorites = options.maxFavorites || 100;
        this.favorites = this.load();
        this.eventBus = options.eventBus || window.openNotesEventBus;
    }

    /**
     * Load favorites from localStorage.
     * @returns {Map} Favorites map
     */
    load() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                return new Map(parsed);
            }
        } catch (error) {
            console.error('Failed to load favorites:', error);
        }
        return new Map();
    }

    /**
     * Save favorites to localStorage.
     */
    save() {
        try {
            const data = JSON.stringify(Array.from(this.favorites.entries()));
            localStorage.setItem(this.storageKey, data);
        } catch (error) {
            console.error('Failed to save favorites:', error);
        }
    }

    /**
     * Add a note to favorites.
     * @param {Object} note - Note object to favorite
     * @returns {boolean} Success status
     */
    add(note) {
        if (!note || !note.id) {
            throw new Error('Invalid note object');
        }

        if (this.favorites.size >= this.maxFavorites) {
            // Remove oldest favorite if at capacity
            const oldestKey = this.favorites.keys().next().value;
            this.favorites.delete(oldestKey);
        }

        const favoriteData = {
            id: note.id,
            title: note.title,
            author: note.auth,
            format: note.fmt || note.format,
            thumbnail: note.thumb,
            downloadUrl: note.dl,
            addedAt: new Date().toISOString()
        };

        this.favorites.set(note.id.toString(), favoriteData);
        this.save();

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('note:favorited', favoriteData);
        }

        return true;
    }

    /**
     * Remove a note from favorites.
     * @param {string|number} noteId - Note ID to remove
     * @returns {boolean} Whether note was removed
     */
    remove(noteId) {
        const key = noteId.toString();
        const existed = this.favorites.has(key);
        
        if (existed) {
            const favorite = this.favorites.get(key);
            this.favorites.delete(key);
            this.save();

            // Emit event
            if (this.eventBus) {
                this.eventBus.emit('note:unfavorited', { id: noteId, ...favorite });
            }
        }

        return existed;
    }

    /**
     * Toggle favorite status.
     * @param {Object} note - Note object
     * @returns {boolean} New favorite status (true = favorited)
     */
    toggle(note) {
        if (this.isFavorite(note.id)) {
            this.remove(note.id);
            return false;
        } else {
            this.add(note);
            return true;
        }
    }

    /**
     * Check if a note is favorited.
     * @param {string|number} noteId - Note ID
     * @returns {boolean} Whether note is favorited
     */
    isFavorite(noteId) {
        return this.favorites.has(noteId.toString());
    }

    /**
     * Get a favorite by ID.
     * @param {string|number} noteId - Note ID
     * @returns {Object|null} Favorite data or null
     */
    get(noteId) {
        return this.favorites.get(noteId.toString()) || null;
    }

    /**
     * Get all favorites.
     * @param {Object} options - Filter/sort options
     * @returns {Array} Array of favorite note data
     */
    getAll(options = {}) {
        let favorites = Array.from(this.favorites.values());

        // Filter by format
        if (options.format) {
            favorites = favorites.filter(f => f.format === options.format);
        }

        // Filter by author
        if (options.author) {
            favorites = favorites.filter(f => f.author === options.author);
        }

        // Search query
        if (options.query) {
            const query = options.query.toLowerCase();
            favorites = favorites.filter(f => 
                (f.title && f.title.toLowerCase().includes(query)) ||
                (f.author && f.author.toLowerCase().includes(query))
            );
        }

        // Sort
        const sortBy = options.sortBy || 'addedAt';
        const sortOrder = options.sortOrder || 'desc';
        
        favorites.sort((a, b) => {
            let aVal = a[sortBy];
            let bVal = b[sortBy];

            if (sortBy === 'addedAt') {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }

            if (typeof aVal === 'string') {
                return sortOrder === 'asc' 
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            }

            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });

        return favorites;
    }

    /**
     * Get favorites count.
     * @returns {number} Number of favorites
     */
    count() {
        return this.favorites.size;
    }

    /**
     * Clear all favorites.
     */
    clear() {
        this.favorites.clear();
        this.save();

        if (this.eventBus) {
            this.eventBus.emit('favorites:cleared');
        }
    }

    /**
     * Export favorites as JSON.
     * @returns {string} JSON string
     */
    exportJSON() {
        return JSON.stringify(this.getAll(), null, 2);
    }

    /**
     * Import favorites from JSON.
     * @param {string} jsonString - JSON string of favorites
     * @param {boolean} merge - Whether to merge with existing (default: true)
     * @returns {number} Number of imported favorites
     */
    importJSON(jsonString, merge = true) {
        try {
            const data = JSON.parse(jsonString);
            
            if (!Array.isArray(data)) {
                throw new Error('Invalid favorites data format');
            }

            if (!merge) {
                this.favorites.clear();
            }

            let imported = 0;
            data.forEach(item => {
                if (item.id && !this.favorites.has(item.id.toString())) {
                    this.favorites.set(item.id.toString(), {
                        id: item.id,
                        title: item.title || 'Unknown',
                        author: item.author || 'Unknown',
                        format: item.format,
                        thumbnail: item.thumbnail,
                        downloadUrl: item.downloadUrl,
                        addedAt: item.addedAt || new Date().toISOString()
                    });
                    imported++;
                }
            });

            this.save();
            return imported;
        } catch (error) {
            console.error('Failed to import favorites:', error);
            throw error;
        }
    }

    /**
     * Get recently added favorites.
     * @param {number} limit - Number to return
     * @returns {Array} Recent favorites
     */
    getRecent(limit = 10) {
        return this.getAll({ sortBy: 'addedAt', sortOrder: 'desc' }).slice(0, limit);
    }

    /**
     * Get unique formats in favorites.
     * @returns {Array} Format strings
     */
    getFormats() {
        const formats = new Set();
        this.favorites.forEach(f => {
            if (f.format) formats.add(f.format);
        });
        return Array.from(formats);
    }

    /**
     * Get unique authors in favorites.
     * @returns {Array} Author names
     */
    getAuthors() {
        const authors = new Set();
        this.favorites.forEach(f => {
            if (f.author) authors.add(f.author);
        });
        return Array.from(authors);
    }

    /**
     * Create a favorites UI badge.
     * @returns {HTMLElement} Badge element
     */
    createBadge() {
        const badge = document.createElement('span');
        badge.className = 'favorites-badge';
        badge.textContent = this.count();
        badge.title = `${this.count()} favorites`;
        return badge;
    }

    /**
     * Create a favorite button for a note.
     * @param {Object} note - Note object
     * @returns {HTMLButtonElement} Button element
     */
    createButton(note) {
        const button = document.createElement('button');
        button.className = 'favorite-button';
        button.setAttribute('aria-label', 'Toggle favorite');
        
        const updateButton = () => {
            const isFav = this.isFavorite(note.id);
            button.innerHTML = isFav ? '★' : '☆';
            button.classList.toggle('is-favorite', isFav);
            button.title = isFav ? 'Remove from favorites' : 'Add to favorites';
        };

        updateButton();

        button.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(note);
            updateButton();
        });

        return button;
    }
}

// Create default instance
const openNotesFavorites = new OpenNotesFavorites();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OpenNotesFavorites, openNotesFavorites };
}

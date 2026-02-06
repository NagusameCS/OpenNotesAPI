/**
 * OpenNotes API Client
 * A comprehensive client library for interacting with the OpenNotes API.
 * 
 * Features:
 * - Full CRUD operations for notes
 * - Search and filtering
 * - Analytics and statistics
 * - Caching layer
 * - Event system
 * - Error handling with retries
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesAPIClient {
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || CONFIG.API_URL;
        this.apiKey = options.apiKey || CONFIG.API_KEY;
        this.timeout = options.timeout || CONFIG.DEFAULTS.TIMEOUT;
        this.retries = options.retries || 3;
        this.retryDelay = options.retryDelay || 1000;
        
        // Cache storage
        this.cache = new Map();
        this.cacheTimestamps = new Map();
        
        // Event listeners
        this.eventListeners = {};
        
        // Request queue for rate limiting
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.rateLimit = options.rateLimit || 10; // requests per second
        
        // Statistics
        this.stats = {
            requestCount: 0,
            successCount: 0,
            errorCount: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    // ==================== EVENT SYSTEM ====================

    /**
     * Register an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
        return this;
    }

    /**
     * Remove an event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function to remove
     */
    off(event, callback) {
        if (this.eventListeners[event]) {
            this.eventListeners[event] = this.eventListeners[event]
                .filter(cb => cb !== callback);
        }
        return this;
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Event listener error for ${event}:`, error);
                }
            });
        }
    }

    // ==================== CACHE MANAGEMENT ====================

    /**
     * Get cached data if still valid
     * @param {string} key - Cache key
     * @param {number} maxAge - Maximum age in milliseconds
     * @returns {*} Cached data or null
     */
    getCached(key, maxAge) {
        const timestamp = this.cacheTimestamps.get(key);
        if (timestamp && (Date.now() - timestamp) < maxAge) {
            this.stats.cacheHits++;
            return this.cache.get(key);
        }
        this.stats.cacheMisses++;
        return null;
    }

    /**
     * Set cache data
     * @param {string} key - Cache key
     * @param {*} data - Data to cache
     */
    setCache(key, data) {
        this.cache.set(key, data);
        this.cacheTimestamps.set(key, Date.now());
    }

    /**
     * Clear all cache
     */
    clearCache() {
        this.cache.clear();
        this.cacheTimestamps.clear();
        this.emit('cache:cleared', {});
    }

    /**
     * Clear specific cache entry
     * @param {string} key - Cache key to clear
     */
    clearCacheEntry(key) {
        this.cache.delete(key);
        this.cacheTimestamps.delete(key);
    }

    // ==================== CORE REQUEST METHOD ====================

    /**
     * Make an API request with retry logic
     * @param {Object} options - Request options
     * @returns {Promise<Object>} API response
     */
    async request(options) {
        const {
            method = 'GET',
            params = {},
            body = null,
            useCache = true,
            cacheMaxAge = CONFIG.CACHE.NOTES_LIST
        } = options;

        // Generate cache key
        const cacheKey = `${method}:${JSON.stringify(params)}`;
        
        // Check cache for GET requests
        if (method === 'GET' && useCache) {
            const cached = this.getCached(cacheKey, cacheMaxAge);
            if (cached) {
                this.emit('cache:hit', { key: cacheKey, data: cached });
                return cached;
            }
        }

        // Build URL with parameters
        const url = new URL(this.apiUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });

        // Request configuration
        const fetchOptions = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': this.apiKey
            }
        };

        if (body && method !== 'GET') {
            fetchOptions.body = JSON.stringify(body);
        }

        // Execute request with retries
        let lastError;
        for (let attempt = 1; attempt <= this.retries; attempt++) {
            try {
                this.stats.requestCount++;
                this.emit('request:start', { url: url.toString(), attempt });

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);
                fetchOptions.signal = controller.signal;

                const response = await fetch(url, fetchOptions);
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new OpenNotesAPIError(
                        errorData.error || `HTTP ${response.status}`,
                        response.status,
                        errorData
                    );
                }

                const data = await response.json();
                this.stats.successCount++;
                
                // Cache successful GET responses
                if (method === 'GET' && useCache) {
                    this.setCache(cacheKey, data);
                }

                this.emit('request:success', { url: url.toString(), data });
                return data;

            } catch (error) {
                lastError = error;
                this.stats.errorCount++;
                this.emit('request:error', { url: url.toString(), error, attempt });

                if (attempt < this.retries) {
                    await this.delay(this.retryDelay * attempt);
                }
            }
        }

        throw lastError;
    }

    /**
     * Delay utility
     * @param {number} ms - Milliseconds to delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==================== NOTES API ====================

    /**
     * Get list of all notes
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Notes list response
     */
    async getNotes(options = {}) {
        const params = {
            type: 'list',
            sort: options.sort || CONFIG.DEFAULTS.SORT,
            limit: options.limit || CONFIG.DEFAULTS.LIMIT,
            offset: options.offset || 0,
            ...options.filters
        };

        if (options.query) {
            params.q = options.query;
        }

        return this.request({ params, cacheMaxAge: CONFIG.CACHE.NOTES_LIST });
    }

    /**
     * Get a single note by ID
     * @param {number|string} noteId - Note ID or name
     * @returns {Promise<Object>} Note details
     */
    async getNote(noteId) {
        return this.request({
            params: { type: 'note', noteId },
            cacheMaxAge: CONFIG.CACHE.NOTE_DETAIL
        });
    }

    /**
     * Get note by name
     * @param {string} name - Note filename
     * @returns {Promise<Object>} Note details
     */
    async getNoteByName(name) {
        return this.request({
            params: { type: 'note', name },
            cacheMaxAge: CONFIG.CACHE.NOTE_DETAIL
        });
    }

    /**
     * Search notes
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    async searchNotes(query, options = {}) {
        return this.request({
            params: {
                type: 'list',
                q: query,
                sort: options.sort || 'relevance',
                limit: options.limit || CONFIG.DEFAULTS.LIMIT,
                offset: options.offset || 0,
                format: options.format,
                author: options.author,
                verified: options.verifiedOnly ? 'true' : undefined
            },
            cacheMaxAge: CONFIG.CACHE.NOTES_LIST
        });
    }

    /**
     * Get notes by author
     * @param {string} author - Author name
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Notes by author
     */
    async getNotesByAuthor(author, options = {}) {
        return this.request({
            params: {
                type: 'list',
                author,
                sort: options.sort || 'relevance',
                limit: options.limit || CONFIG.DEFAULTS.LIMIT
            }
        });
    }

    /**
     * Get notes by format
     * @param {string} format - File format (pdf, docx, etc.)
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Notes by format
     */
    async getNotesByFormat(format, options = {}) {
        return this.request({
            params: {
                type: 'list',
                format,
                sort: options.sort || 'relevance',
                limit: options.limit || CONFIG.DEFAULTS.LIMIT
            }
        });
    }

    /**
     * Get verified notes only
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Verified notes
     */
    async getVerifiedNotes(options = {}) {
        return this.request({
            params: {
                type: 'list',
                verified: 'true',
                sort: options.sort || 'relevance',
                limit: options.limit || CONFIG.DEFAULTS.LIMIT
            }
        });
    }

    /**
     * Get trending notes (most views)
     * @param {number} limit - Number of notes to return
     * @returns {Promise<Object>} Trending notes
     */
    async getTrendingNotes(limit = 10) {
        return this.request({
            params: {
                type: 'list',
                sort: 'views',
                limit
            }
        });
    }

    /**
     * Get most downloaded notes
     * @param {number} limit - Number of notes to return
     * @returns {Promise<Object>} Most downloaded notes
     */
    async getMostDownloaded(limit = 10) {
        return this.request({
            params: {
                type: 'list',
                sort: 'downloads',
                limit
            }
        });
    }

    /**
     * Get recently updated notes
     * @param {number} limit - Number of notes to return
     * @returns {Promise<Object>} Recent notes
     */
    async getRecentNotes(limit = 10) {
        return this.request({
            params: {
                type: 'list',
                sort: 'updated',
                limit
            }
        });
    }

    /**
     * Get notes created after a specific date
     * @param {Date|string} date - Start date
     * @param {Object} options - Query options
     * @returns {Promise<Object>} Notes after date
     */
    async getNotesAfterDate(date, options = {}) {
        const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
        return this.request({
            params: {
                type: 'list',
                after: timestamp,
                sort: options.sort || 'updated',
                limit: options.limit || CONFIG.DEFAULTS.LIMIT
            }
        });
    }

    // ==================== COUNTERS API ====================

    /**
     * Increment view counter for a note
     * @param {string} noteId - Note ID or name
     * @returns {Promise<Object>} Updated counter
     */
    async incrementViews(noteId) {
        this.clearCacheEntry(`GET:${JSON.stringify({ type: 'note', noteId })}`);
        return this.request({
            method: 'POST',
            params: {
                type: 'note',
                noteId,
                counter: 'views'
            },
            useCache: false
        });
    }

    /**
     * Increment download counter for a note
     * @param {string} noteId - Note ID or name
     * @returns {Promise<Object>} Updated counter
     */
    async incrementDownloads(noteId) {
        this.clearCacheEntry(`GET:${JSON.stringify({ type: 'note', noteId })}`);
        return this.request({
            method: 'POST',
            params: {
                type: 'note',
                noteId,
                counter: 'downloads'
            },
            useCache: false
        });
    }

    /**
     * Get view count for a note
     * @param {string} noteId - Note ID or name
     * @returns {Promise<number>} View count
     */
    async getViewCount(noteId) {
        const note = await this.getNote(noteId);
        return note?.v || 0;
    }

    /**
     * Get download count for a note
     * @param {string} noteId - Note ID or name
     * @returns {Promise<number>} Download count
     */
    async getDownloadCount(noteId) {
        const note = await this.getNote(noteId);
        return note?.d || 0;
    }

    // ==================== STATISTICS API ====================

    /**
     * Get total site views
     * @returns {Promise<number>} Total views
     */
    async getTotalViews() {
        const response = await this.request({
            params: { type: 'list' },
            cacheMaxAge: CONFIG.CACHE.STATS
        });
        return response?.meta?.views || 0;
    }

    /**
     * Get current user info
     * @returns {Promise<Object>} User information
     */
    async getCurrentUser() {
        const response = await this.request({
            params: { type: 'list' },
            cacheMaxAge: CONFIG.CACHE.STATS
        });
        return response?.meta?.user || null;
    }

    /**
     * Get comprehensive statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStatistics() {
        const response = await this.getNotes({ limit: 1000 });
        const notes = response?.items || [];
        
        const stats = {
            totalNotes: notes.length,
            totalViews: response?.meta?.views || 0,
            totalDownloads: notes.reduce((sum, note) => sum + (note.d || 0), 0),
            noteViews: notes.reduce((sum, note) => sum + (note.v || 0), 0),
            verifiedNotes: notes.filter(n => n.is_verified).length,
            ownerNotes: notes.filter(n => n.is_owner).length,
            aiGeneratedNotes: notes.filter(n => n.ai).length,
            formats: {},
            authors: {},
            averageViews: 0,
            averageDownloads: 0,
            topViewedNotes: [],
            topDownloadedNotes: [],
            recentlyUpdated: [],
            totalSize: 0
        };

        // Calculate format distribution
        notes.forEach(note => {
            const format = note.fmt || note.format;
            stats.formats[format] = (stats.formats[format] || 0) + 1;
        });

        // Calculate author distribution
        notes.forEach(note => {
            const author = note.auth;
            if (author) {
                stats.authors[author] = (stats.authors[author] || 0) + 1;
            }
        });

        // Calculate averages
        if (notes.length > 0) {
            stats.averageViews = stats.noteViews / notes.length;
            stats.averageDownloads = stats.totalDownloads / notes.length;
        }

        // Get top notes
        stats.topViewedNotes = [...notes].sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, 5);
        stats.topDownloadedNotes = [...notes].sort((a, b) => (b.d || 0) - (a.d || 0)).slice(0, 5);
        stats.recentlyUpdated = [...notes].sort((a, b) => 
            new Date(b.upd) - new Date(a.upd)
        ).slice(0, 5);

        // Calculate total size (parse size strings)
        notes.forEach(note => {
            if (note.size) {
                const sizeMatch = note.size.match(/([\d.]+)\s*(KiB|MiB|GiB|KB|MB|GB)/i);
                if (sizeMatch) {
                    let size = parseFloat(sizeMatch[1]);
                    const unit = sizeMatch[2].toUpperCase();
                    if (unit === 'MIB' || unit === 'MB') size *= 1024;
                    if (unit === 'GIB' || unit === 'GB') size *= 1024 * 1024;
                    stats.totalSize += size;
                }
            }
        });

        return stats;
    }

    /**
     * Get format statistics
     * @returns {Promise<Object>} Format distribution
     */
    async getFormatStats() {
        const stats = await this.getStatistics();
        return stats.formats;
    }

    /**
     * Get author statistics
     * @returns {Promise<Object>} Author distribution
     */
    async getAuthorStats() {
        const stats = await this.getStatistics();
        return stats.authors;
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Generate download URL for a note
     * @param {Object} note - Note object
     * @returns {string} Download URL
     */
    getDownloadUrl(note) {
        return note.dl || `${CONFIG.RAW_CONTENT_URL}/Notes/${encodeURIComponent(note.name)}`;
    }

    /**
     * Generate thumbnail URL for a note
     * @param {Object} note - Note object
     * @returns {string} Thumbnail URL
     */
    getThumbnailUrl(note) {
        return note.thumb || `${CONFIG.RAW_CONTENT_URL}/resources/thumbnails/${encodeURIComponent(note.name.replace('.', '_'))}.jpg`;
    }

    /**
     * Track a note view (increments counter and returns updated note)
     * @param {string|Object} note - Note or note ID
     * @returns {Promise<Object>} Updated note
     */
    async trackView(note) {
        const noteId = typeof note === 'object' ? note.name : note;
        await this.incrementViews(noteId);
        this.emit('note:viewed', { noteId });
        return this.getNote(noteId);
    }

    /**
     * Track a note download (increments counter and returns download URL)
     * @param {Object} note - Note object
     * @returns {Promise<string>} Download URL
     */
    async trackDownload(note) {
        await this.incrementDownloads(note.name);
        this.emit('note:downloaded', { noteId: note.name });
        return this.getDownloadUrl(note);
    }

    /**
     * Get client statistics
     * @returns {Object} Client stats
     */
    getClientStats() {
        return { ...this.stats };
    }

    /**
     * Reset client statistics
     */
    resetClientStats() {
        this.stats = {
            requestCount: 0,
            successCount: 0,
            errorCount: 0,
            cacheHits: 0,
            cacheMisses: 0
        };
    }

    /**
     * Health check
     * @returns {Promise<boolean>} True if API is healthy
     */
    async healthCheck() {
        try {
            await this.request({
                params: { type: 'list', limit: 1 },
                useCache: false
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Paginate through all notes
     * @param {Object} options - Pagination options
     * @yields {Object} Page of notes
     */
    async *paginateNotes(options = {}) {
        const limit = options.limit || 20;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const response = await this.getNotes({
                ...options,
                limit,
                offset
            });

            const items = response?.items || [];
            if (items.length === 0) {
                hasMore = false;
            } else {
                yield {
                    items,
                    offset,
                    total: response?.meta?.total || items.length,
                    page: Math.floor(offset / limit) + 1
                };
                offset += limit;
                if (items.length < limit) {
                    hasMore = false;
                }
            }
        }
    }

    /**
     * Batch get multiple notes
     * @param {Array<string>} noteIds - Array of note IDs
     * @returns {Promise<Array<Object>>} Array of notes
     */
    async batchGetNotes(noteIds) {
        const promises = noteIds.map(id => this.getNote(id).catch(() => null));
        return Promise.all(promises);
    }
}

/**
 * Custom error class for OpenNotes API errors
 */
class OpenNotesAPIError extends Error {
    constructor(message, statusCode, data = {}) {
        super(message);
        this.name = 'OpenNotesAPIError';
        this.statusCode = statusCode;
        this.data = data;
    }

    is403() { return this.statusCode === 403; }
    is401() { return this.statusCode === 401; }
    is404() { return this.statusCode === 404; }
    is500() { return this.statusCode >= 500; }
}

// Create default instance
const openNotesAPI = new OpenNotesAPIClient();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OpenNotesAPIClient, OpenNotesAPIError, openNotesAPI };
}

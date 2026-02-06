/**
 * OpenNotes SDK - Main Entry Point
 * Bundles all OpenNotes modules for easy importing.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

// Import order matters - dependencies first

// Core modules
// CONFIG, OpenNotesAPIClient, OpenNotesAPIError, openNotesAPI

// Utility modules  
// OpenNotesUtils, OpenNotesEventBus, OpenNotesEvents, openNotesEventBus

// Feature modules
// NotesBrowser, OpenNotesSearch, OpenNotesAnalytics
// OpenNotesFavorites, openNotesFavorites
// OpenNotesExport
// OpenNotesTheme, openNotesTheme

/**
 * OpenNotes SDK - Unified API
 */
window.OpenNotes = {
    // Version
    VERSION: '1.0.0',

    // Config
    get config() {
        return window.CONFIG;
    },

    // API Client
    get api() {
        return window.openNotesAPI;
    },

    // Event Bus
    get events() {
        return window.openNotesEventBus;
    },

    // Event constants
    get Events() {
        return window.OpenNotesEvents;
    },

    // Utilities
    get utils() {
        return window.OpenNotesUtils;
    },

    // Favorites
    get favorites() {
        return window.openNotesFavorites;
    },

    // Theme
    get theme() {
        return window.openNotesTheme;
    },

    // Export utilities
    get export() {
        return window.OpenNotesExport;
    },

    // Classes for instantiation
    classes: {
        get APIClient() {
            return window.OpenNotesAPIClient;
        },
        get EventBus() {
            return window.OpenNotesEventBus;
        },
        get NotesBrowser() {
            return window.NotesBrowser;
        },
        get Search() {
            return window.OpenNotesSearch;
        },
        get Analytics() {
            return window.OpenNotesAnalytics;
        },
        get Favorites() {
            return window.OpenNotesFavorites;
        },
        get Theme() {
            return window.OpenNotesTheme;
        }
    },

    /**
     * Quick search notes.
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Array>} Notes array
     */
    async search(query, options = {}) {
        const result = await window.openNotesAPI.searchNotes(query, options);
        return result.items;
    },

    /**
     * Get all notes.
     * @param {Object} options - Options
     * @returns {Promise<Array>} Notes array
     */
    async getNotes(options = {}) {
        const result = await window.openNotesAPI.getNotes(options);
        return result.items;
    },

    /**
     * Get single note by ID.
     * @param {string|number} id - Note ID
     * @returns {Promise<Object|null>} Note object
     */
    async getNote(id) {
        return await window.openNotesAPI.getNote(id);
    },

    /**
     * Get API statistics.
     * @returns {Promise<Object>} Statistics
     */
    async getStats() {
        return await window.openNotesAPI.getStatistics();
    },

    /**
     * Check API health.
     * @returns {Promise<boolean>} Health status
     */
    async healthCheck() {
        return await window.openNotesAPI.healthCheck();
    },

    /**
     * Initialize SDK with custom config.
     * @param {Object} config - Configuration overrides
     */
    init(config = {}) {
        if (config.apiUrl) {
            window.CONFIG.API_URL = config.apiUrl;
        }
        if (config.apiKey) {
            window.CONFIG.API_KEY = config.apiKey;
        }
        if (config.debug !== undefined) {
            window.CONFIG.DEBUG = config.debug;
        }
        
        console.log('OpenNotes SDK initialized', this.VERSION);
        return this;
    },

    /**
     * Log SDK info.
     */
    info() {
        console.log(`
╔═══════════════════════════════════════════╗
║         OpenNotes SDK v${this.VERSION}            ║
╠═══════════════════════════════════════════╣
║  API URL: ${window.CONFIG?.API_URL || 'Not configured'}
║  Modules: api, events, utils, favorites,  ║
║           theme, export, search, browser  ║
╚═══════════════════════════════════════════╝
        `);
    }
};

// Auto-log on load if debug mode
document.addEventListener('DOMContentLoaded', () => {
    if (window.CONFIG?.DEBUG) {
        window.OpenNotes.info();
    }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.OpenNotes;
}

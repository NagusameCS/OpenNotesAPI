/**
 * OpenNotes API Configuration
 * This file contains all configuration settings for the OpenNotes API integration.
 * 
 * SECURITY: API keys are stored server-side in the gateway proxy.
 * The frontend never has direct access to the OpenNotes API key.
 */

const CONFIG = {
    // Gateway Proxy URL (handles authentication securely)
    // Replace with your deployed Cloudflare Worker gateway URL
    // See /worker folder for the gateway implementation
    GATEWAY_URL: '', // e.g., 'https://opennotes-gateway.your-subdomain.workers.dev'
    
    // Direct API URL (for reference - requires gateway for CORS)
    API_URL: 'https://open-notes.tebby2008-li.workers.dev',
    
    // App Token for gateway authentication (optional)
    // Leave empty if using from official frontend (nagusamecs.github.io)
    APP_TOKEN: '',
    
    // OpenNotes GitHub repository base URL
    REPO_URL: 'https://github.com/Tebby2008/OpenNotes',
    
    // Raw content base URL for direct file access
    RAW_CONTENT_URL: 'https://raw.githubusercontent.com/Tebby2008/OpenNotes/main',
    
    // OpenNotes site URL
    SITE_URL: 'https://opennotes.pages.dev',
    
    // API Endpoints
    ENDPOINTS: {
        // Notes endpoints
        NOTES: '/notes',                    // GET - List all notes
        NOTE: '/notes/:id',                 // GET - Get single note by ID
        SEARCH: '/notes/search',            // GET - Search notes (?q=query)
        
        // Counter endpoints
        VIEWS: '/notes/:id/views',          // POST - Increment view count
        DOWNLOADS: '/notes/:id/downloads',  // POST - Increment download count
        
        // Statistics endpoints  
        STATS: '/stats',                    // GET - Get overall statistics
        
        // Health endpoint
        HEALTH: '/health'                   // GET - API health check
    },
    
    // Default request settings
    DEFAULTS: {
        LIMIT: 20,
        SORT: 'upd',   // Sort by updated date
        TIMEOUT: 10000
    },
    
    // Supported file formats
    FORMATS: ['pdf', 'docx', 'doc', 'pptx', 'xlsx', 'txt', 'md'],
    
    // Cache settings (in milliseconds)
    CACHE: {
        NOTES_LIST: 5 * 60 * 1000,      // 5 minutes
        NOTE_DETAIL: 10 * 60 * 1000,    // 10 minutes
        STATS: 2 * 60 * 1000            // 2 minutes
    },
    
    // Debug mode
    DEBUG: false
};

// Freeze config to prevent modifications
Object.freeze(CONFIG);
Object.freeze(CONFIG.ENDPOINTS);
Object.freeze(CONFIG.DEFAULTS);
Object.freeze(CONFIG.CACHE);

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}

/**
 * OpenNotes Events Module
 * Custom event system for cross-component communication.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesEventBus {
    constructor() {
        this.listeners = new Map();
        this.oneTimeListeners = new Map();
        this.history = [];
        this.maxHistory = 100;
    }

    /**
     * Subscribe to an event.
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @param {Object} options - Options { once: boolean, priority: number }
     * @returns {Function} Unsubscribe function
     */
    on(event, callback, options = {}) {
        const listenerMap = options.once ? this.oneTimeListeners : this.listeners;
        
        if (!listenerMap.has(event)) {
            listenerMap.set(event, []);
        }
        
        const listener = {
            callback,
            priority: options.priority || 0
        };
        
        listenerMap.get(event).push(listener);
        
        // Sort by priority (higher first)
        listenerMap.get(event).sort((a, b) => b.priority - a.priority);
        
        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event (fires once).
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
        return this.on(event, callback, { once: true });
    }

    /**
     * Unsubscribe from an event.
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     */
    off(event, callback) {
        for (const listenerMap of [this.listeners, this.oneTimeListeners]) {
            if (listenerMap.has(event)) {
                const listeners = listenerMap.get(event);
                const index = listeners.findIndex(l => l.callback === callback);
                if (index > -1) {
                    listeners.splice(index, 1);
                }
            }
        }
    }

    /**
     * Emit an event with data.
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data = null) {
        const eventRecord = {
            event,
            data,
            timestamp: new Date().toISOString()
        };
        
        // Store in history
        this.history.push(eventRecord);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        // Call regular listeners
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(listener => {
                try {
                    listener.callback(data, eventRecord);
                } catch (error) {
                    console.error(`Error in event listener for '${event}':`, error);
                }
            });
        }

        // Call one-time listeners and remove them
        if (this.oneTimeListeners.has(event)) {
            const oneTimeListeners = this.oneTimeListeners.get(event);
            this.oneTimeListeners.set(event, []);
            
            oneTimeListeners.forEach(listener => {
                try {
                    listener.callback(data, eventRecord);
                } catch (error) {
                    console.error(`Error in one-time event listener for '${event}':`, error);
                }
            });
        }

        // Emit wildcard event
        if (event !== '*' && this.listeners.has('*')) {
            this.listeners.get('*').forEach(listener => {
                try {
                    listener.callback(eventRecord);
                } catch (error) {
                    console.error('Error in wildcard event listener:', error);
                }
            });
        }
    }

    /**
     * Remove all listeners for an event or all events.
     * @param {string} [event] - Optional event name
     */
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
            this.oneTimeListeners.delete(event);
        } else {
            this.listeners.clear();
            this.oneTimeListeners.clear();
        }
    }

    /**
     * Get number of listeners for an event.
     * @param {string} event - Event name
     * @returns {number} Listener count
     */
    listenerCount(event) {
        const regular = this.listeners.get(event)?.length || 0;
        const oneTime = this.oneTimeListeners.get(event)?.length || 0;
        return regular + oneTime;
    }

    /**
     * Get all registered event names.
     * @returns {string[]} Event names
     */
    eventNames() {
        const events = new Set([
            ...this.listeners.keys(),
            ...this.oneTimeListeners.keys()
        ]);
        return Array.from(events);
    }

    /**
     * Get event history.
     * @param {string} [event] - Optional filter by event name
     * @param {number} [limit] - Optional limit
     * @returns {Array} Event records
     */
    getHistory(event, limit = 50) {
        let history = this.history;
        if (event) {
            history = history.filter(h => h.event === event);
        }
        return history.slice(-limit);
    }

    /**
     * Clear event history.
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * Wait for an event to occur.
     * @param {string} event - Event name
     * @param {number} [timeout] - Optional timeout in ms
     * @returns {Promise} Resolves with event data
     */
    waitFor(event, timeout = 0) {
        return new Promise((resolve, reject) => {
            let timeoutId;
            
            const unsubscribe = this.once(event, (data) => {
                if (timeoutId) clearTimeout(timeoutId);
                resolve(data);
            });

            if (timeout > 0) {
                timeoutId = setTimeout(() => {
                    unsubscribe();
                    reject(new Error(`Timeout waiting for event '${event}'`));
                }, timeout);
            }
        });
    }
}

// Pre-defined OpenNotes events
const OpenNotesEvents = {
    // API Events
    API_REQUEST_START: 'api:request:start',
    API_REQUEST_END: 'api:request:end',
    API_REQUEST_ERROR: 'api:request:error',
    API_CACHE_HIT: 'api:cache:hit',
    API_CACHE_MISS: 'api:cache:miss',
    API_RATE_LIMITED: 'api:rate:limited',

    // Notes Events
    NOTES_LOADED: 'notes:loaded',
    NOTES_LOADING: 'notes:loading',
    NOTES_ERROR: 'notes:error',
    NOTE_SELECTED: 'note:selected',
    NOTE_VIEWED: 'note:viewed',
    NOTE_DOWNLOADED: 'note:downloaded',
    NOTE_FAVORITED: 'note:favorited',
    NOTE_UNFAVORITED: 'note:unfavorited',

    // Search Events
    SEARCH_START: 'search:start',
    SEARCH_COMPLETE: 'search:complete',
    SEARCH_ERROR: 'search:error',
    SEARCH_SUGGESTION_SHOW: 'search:suggestion:show',
    SEARCH_SUGGESTION_SELECT: 'search:suggestion:select',

    // Browser Events
    BROWSER_VIEW_CHANGE: 'browser:view:change',
    BROWSER_SORT_CHANGE: 'browser:sort:change',
    BROWSER_FILTER_CHANGE: 'browser:filter:change',
    BROWSER_PAGE_CHANGE: 'browser:page:change',

    // Analytics Events
    ANALYTICS_LOADED: 'analytics:loaded',
    ANALYTICS_REFRESH: 'analytics:refresh',
    ANALYTICS_EXPORT: 'analytics:export',

    // UI Events
    UI_THEME_CHANGE: 'ui:theme:change',
    UI_MODAL_OPEN: 'ui:modal:open',
    UI_MODAL_CLOSE: 'ui:modal:close',
    UI_TAB_CHANGE: 'ui:tab:change',
    UI_NOTIFICATION: 'ui:notification',

    // Auth Events
    AUTH_STATE_CHANGE: 'auth:state:change'
};

// Create default event bus instance
const openNotesEventBus = new OpenNotesEventBus();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OpenNotesEventBus, OpenNotesEvents, openNotesEventBus };
}

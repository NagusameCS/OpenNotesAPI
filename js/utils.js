/**
 * OpenNotes Utilities Module
 * Helper functions and utilities for the OpenNotes API.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

const OpenNotesUtils = {
    // ==================== FORMAT UTILITIES ====================

    /**
     * Get file format icon/emoji
     */
    getFormatIcon(format) {
        const icons = {
            pdf: '📕',
            docx: '📘',
            doc: '📘',
            pptx: '📙',
            ppt: '📙',
            xlsx: '📗',
            xls: '📗',
            txt: '📄',
            md: '📝',
            csv: '📊'
        };
        return icons[format?.toLowerCase()] || '📄';
    },

    /**
     * Get format color for styling - Azure monotone
     */
    getFormatColor(format) {
        const colors = {
            pdf: '#0078d4',     // Azure primary
            docx: '#005a9e',    // Azure dark
            doc: '#005a9e',
            pptx: '#004578',    // Azure darker
            ppt: '#004578',
            xlsx: '#106ebe',    // Azure medium
            xls: '#106ebe',
            txt: '#5c6970',     // Neutral
            md: '#4a90c2'       // Secondary blue
        };
        return colors[format?.toLowerCase()] || '#5c6970';
    },

    /**
     * Get format display name
     */
    getFormatName(format) {
        const names = {
            pdf: 'PDF Document',
            docx: 'Word Document',
            doc: 'Word Document (Legacy)',
            pptx: 'PowerPoint Presentation',
            ppt: 'PowerPoint (Legacy)',
            xlsx: 'Excel Spreadsheet',
            xls: 'Excel (Legacy)',
            txt: 'Plain Text',
            md: 'Markdown'
        };
        return names[format?.toLowerCase()] || 'Unknown Format';
    },

    // ==================== SIZE UTILITIES ====================

    /**
     * Parse size string to bytes
     */
    parseSize(sizeStr) {
        if (!sizeStr) return 0;
        const match = sizeStr.match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB)/i);
        if (!match) return 0;

        let size = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        const multipliers = {
            'B': 1,
            'KB': 1000,
            'KIB': 1024,
            'MB': 1000000,
            'MIB': 1048576,
            'GB': 1000000000,
            'GIB': 1073741824
        };

        return size * (multipliers[unit] || 1);
    },

    /**
     * Format bytes to human readable string
     */
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    // ==================== NUMBER FORMATTING ====================

    /**
     * Format number with K/M suffixes
     */
    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toLocaleString();
    },

    /**
     * Format as percentage
     */
    formatPercent(value, decimals = 1) {
        return value.toFixed(decimals) + '%';
    },

    // ==================== DATE UTILITIES ====================

    /**
     * Format date to locale string
     */
    formatDate(dateStr, options = {}) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: options.short ? 'short' : 'long',
            day: 'numeric',
            ...options
        });
    },

    /**
     * Format date as relative time (e.g., "2 days ago")
     */
    formatRelativeTime(dateStr) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;

        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const weeks = Math.floor(days / 7);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        if (years > 0) return years === 1 ? '1 year ago' : `${years} years ago`;
        if (months > 0) return months === 1 ? '1 month ago' : `${months} months ago`;
        if (weeks > 0) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
        if (days > 0) return days === 1 ? '1 day ago' : `${days} days ago`;
        if (hours > 0) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
        if (minutes > 0) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
        return 'Just now';
    },

    /**
     * Check if date is within last N days
     */
    isRecent(dateStr, days = 7) {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        return diff < days * 24 * 60 * 60 * 1000;
    },

    // ==================== STRING UTILITIES ====================

    /**
     * Truncate string with ellipsis
     */
    truncate(str, length = 50) {
        if (!str || str.length <= length) return str || '';
        return str.substring(0, length) + '...';
    },

    /**
     * Escape HTML special characters
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    },

    /**
     * Escape regex special characters
     */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    /**
     * Highlight search matches in text
     */
    highlightMatches(text, query) {
        if (!query) return this.escapeHtml(text);
        const escaped = this.escapeHtml(text);
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return escaped.replace(regex, '<mark>$1</mark>');
    },

    /**
     * Generate slug from string
     */
    slugify(str) {
        return str
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    },

    // ==================== URL UTILITIES ====================

    /**
     * Build URL with query parameters
     */
    buildUrl(baseUrl, params = {}) {
        const url = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, value);
            }
        });
        return url.toString();
    },

    /**
     * Parse query parameters from URL
     */
    parseQueryParams(url) {
        const urlObj = new URL(url, window.location.origin);
        const params = {};
        urlObj.searchParams.forEach((value, key) => {
            params[key] = value;
        });
        return params;
    },

    /**
     * Get file extension from URL or filename
     */
    getExtension(filename) {
        const match = filename.match(/\.([^.]+)$/);
        return match ? match[1].toLowerCase() : '';
    },

    // ==================== ARRAY UTILITIES ====================

    /**
     * Sort notes by property
     */
    sortNotes(notes, property, descending = true) {
        return [...notes].sort((a, b) => {
            let aVal = a[property];
            let bVal = b[property];

            // Handle dates
            if (property === 'upd' || property === 'created_at') {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }

            // Handle strings
            if (typeof aVal === 'string') {
                return descending 
                    ? bVal.localeCompare(aVal)
                    : aVal.localeCompare(bVal);
            }

            // Handle numbers
            return descending ? bVal - aVal : aVal - bVal;
        });
    },

    /**
     * Group notes by property
     */
    groupNotes(notes, property) {
        return notes.reduce((groups, note) => {
            const key = note[property] || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(note);
            return groups;
        }, {});
    },

    /**
     * Filter notes by criteria
     */
    filterNotes(notes, criteria = {}) {
        return notes.filter(note => {
            if (criteria.format && (note.fmt || note.format) !== criteria.format) {
                return false;
            }
            if (criteria.author && note.auth !== criteria.author) {
                return false;
            }
            if (criteria.verified && !note.is_verified) {
                return false;
            }
            if (criteria.minViews && (note.v || 0) < criteria.minViews) {
                return false;
            }
            if (criteria.query) {
                const searchText = [note.title, note.auth, note.name].join(' ').toLowerCase();
                if (!searchText.includes(criteria.query.toLowerCase())) {
                    return false;
                }
            }
            return true;
        });
    },

    /**
     * Remove duplicate notes by property
     */
    uniqueNotes(notes, property = 'id') {
        const seen = new Set();
        return notes.filter(note => {
            const key = note[property];
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    // ==================== STORAGE UTILITIES ====================

    /**
     * Get item from localStorage with default
     */
    getStorage(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    /**
     * Set item in localStorage
     */
    setStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    },

    /**
     * Remove item from localStorage
     */
    removeStorage(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch {
            return false;
        }
    },

    // ==================== DOM UTILITIES ====================

    /**
     * Create element with attributes
     */
    createElement(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(element.style, value);
            } else if (key.startsWith('on')) {
                element.addEventListener(key.slice(2).toLowerCase(), value);
            } else {
                element.setAttribute(key, value);
            }
        });

        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            }
        });

        return element;
    },

    /**
     * Wait for DOM ready
     */
    ready(callback) {
        if (document.readyState !== 'loading') {
            callback();
        } else {
            document.addEventListener('DOMContentLoaded', callback);
        }
    },

    // ==================== ASYNC UTILITIES ====================

    /**
     * Debounce function calls
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    /**
     * Throttle function calls
     */
    throttle(func, limit) {
        let inThrottle;
        return function executedFunction(...args) {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * Sleep/delay promise
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Retry async function
     */
    async retry(fn, retries = 3, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) throw error;
                await this.sleep(delay * (i + 1));
            }
        }
    },

    // ==================== VALIDATION ====================

    /**
     * Check if value is valid note ID
     */
    isValidNoteId(id) {
        return typeof id === 'number' || 
               (typeof id === 'string' && id.length > 0);
    },

    /**
     * Check if format is supported
     */
    isSupportedFormat(format) {
        const supported = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'txt', 'md'];
        return supported.includes(format?.toLowerCase());
    },

    /**
     * Validate email format
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenNotesUtils;
}

/**
 * OpenNotes Theme Module
 * Dark/light theme management with system preference detection.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesTheme {
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'opennotes_theme';
        this.defaultTheme = options.defaultTheme || 'system';
        this.themes = options.themes || ['light', 'dark', 'system'];
        this.rootElement = options.rootElement || document.documentElement;
        this.eventBus = options.eventBus || window.openNotesEventBus;
        
        this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this.currentTheme = this.load();
        
        this.init();
    }

    /**
     * Initialize theme system.
     */
    init() {
        // Apply saved theme
        this.apply(this.currentTheme);
        
        // Listen for system preference changes
        this.mediaQuery.addEventListener('change', (e) => {
            if (this.currentTheme === 'system') {
                this.updateDOM(e.matches ? 'dark' : 'light');
            }
        });
    }

    /**
     * Load theme preference from storage.
     * @returns {string} Theme name
     */
    load() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved && this.themes.includes(saved)) {
                return saved;
            }
        } catch (error) {
            console.warn('Failed to load theme preference:', error);
        }
        return this.defaultTheme;
    }

    /**
     * Save theme preference to storage.
     * @param {string} theme - Theme name
     */
    save(theme) {
        try {
            localStorage.setItem(this.storageKey, theme);
        } catch (error) {
            console.warn('Failed to save theme preference:', error);
        }
    }

    /**
     * Get the resolved theme (light or dark).
     * @returns {string} 'light' or 'dark'
     */
    getResolvedTheme() {
        if (this.currentTheme === 'system') {
            return this.mediaQuery.matches ? 'dark' : 'light';
        }
        return this.currentTheme;
    }

    /**
     * Update DOM with theme.
     * @param {string} resolvedTheme - 'light' or 'dark'
     */
    updateDOM(resolvedTheme) {
        // Set data attribute
        this.rootElement.setAttribute('data-theme', resolvedTheme);
        
        // Toggle class
        this.rootElement.classList.remove('theme-light', 'theme-dark');
        this.rootElement.classList.add(`theme-${resolvedTheme}`);
        
        // Update CSS custom properties if needed
        if (resolvedTheme === 'dark') {
            this.rootElement.style.setProperty('--theme-mode', 'dark');
        } else {
            this.rootElement.style.setProperty('--theme-mode', 'light');
        }

        // Update meta theme-color
        let metaTheme = document.querySelector('meta[name="theme-color"]');
        if (!metaTheme) {
            metaTheme = document.createElement('meta');
            metaTheme.name = 'theme-color';
            document.head.appendChild(metaTheme);
        }
        metaTheme.content = resolvedTheme === 'dark' ? '#1f2937' : '#ffffff';
    }

    /**
     * Apply a theme.
     * @param {string} theme - Theme name ('light', 'dark', or 'system')
     */
    apply(theme) {
        if (!this.themes.includes(theme)) {
            console.warn(`Invalid theme: ${theme}`);
            return;
        }

        const previousTheme = this.currentTheme;
        this.currentTheme = theme;
        
        const resolvedTheme = this.getResolvedTheme();
        this.updateDOM(resolvedTheme);
        this.save(theme);

        // Emit event
        if (this.eventBus) {
            this.eventBus.emit('ui:theme:change', {
                theme,
                resolvedTheme,
                previousTheme
            });
        }
    }

    /**
     * Set theme to light.
     */
    setLight() {
        this.apply('light');
    }

    /**
     * Set theme to dark.
     */
    setDark() {
        this.apply('dark');
    }

    /**
     * Set theme to follow system.
     */
    setSystem() {
        this.apply('system');
    }

    /**
     * Toggle between light and dark (or cycle if system is included).
     * @param {boolean} includeSystem - Whether to include system in cycle
     */
    toggle(includeSystem = false) {
        const themes = includeSystem 
            ? ['light', 'dark', 'system']
            : ['light', 'dark'];
        
        const currentIndex = themes.indexOf(this.currentTheme);
        const nextIndex = (currentIndex + 1) % themes.length;
        this.apply(themes[nextIndex]);
    }

    /**
     * Check if dark mode is active.
     * @returns {boolean}
     */
    isDark() {
        return this.getResolvedTheme() === 'dark';
    }

    /**
     * Check if light mode is active.
     * @returns {boolean}
     */
    isLight() {
        return this.getResolvedTheme() === 'light';
    }

    /**
     * Check if using system preference.
     * @returns {boolean}
     */
    isSystem() {
        return this.currentTheme === 'system';
    }

    /**
     * Get current theme setting.
     * @returns {string} Theme name
     */
    getTheme() {
        return this.currentTheme;
    }

    /**
     * Create theme toggle button.
     * @param {Object} options - Button options
     * @returns {HTMLButtonElement}
     */
    createToggleButton(options = {}) {
        const button = document.createElement('button');
        button.className = options.className || 'theme-toggle';
        button.setAttribute('aria-label', 'Toggle theme');
        button.type = 'button';

        const icons = {
            light: options.lightIcon || '☀️',
            dark: options.darkIcon || '🌙',
            system: options.systemIcon || '💻'
        };

        const updateButton = () => {
            button.innerHTML = icons[this.currentTheme];
            button.title = `Theme: ${this.currentTheme} (click to change)`;
        };

        updateButton();

        button.addEventListener('click', () => {
            this.toggle(options.includeSystem ?? true);
            updateButton();
        });

        // Subscribe to theme changes
        if (this.eventBus) {
            this.eventBus.on('ui:theme:change', updateButton);
        }

        return button;
    }

    /**
     * Create theme selector dropdown.
     * @param {Object} options - Selector options
     * @returns {HTMLSelectElement}
     */
    createSelector(options = {}) {
        const select = document.createElement('select');
        select.className = options.className || 'theme-selector';
        select.setAttribute('aria-label', 'Select theme');

        const labels = {
            light: options.lightLabel || 'Light',
            dark: options.darkLabel || 'Dark',
            system: options.systemLabel || 'System'
        };

        this.themes.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme;
            option.textContent = labels[theme] || theme;
            option.selected = theme === this.currentTheme;
            select.appendChild(option);
        });

        select.addEventListener('change', () => {
            this.apply(select.value);
        });

        return select;
    }
}

// CSS for dark theme - Azure Monotone
const darkThemeCSS = `
[data-theme="dark"] {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --text-primary: #f0f6fc;
    --text-secondary: #8b949e;
    --text-tertiary: #6e7681;
    --border-color: #30363d;
    --primary-color: #58a6ff;
    --primary-hover: #79b8ff;
    --accent-color: #58a6ff;
    --accent-hover: #79b8ff;
    --shadow-color: rgba(0, 0, 0, 0.5);
    --success-color: #58a6ff;
    --warning-color: #388bfd;
    --error-color: #1f6feb;
    color-scheme: dark;
}

[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f6f8fa;
    --bg-tertiary: #e8ecef;
    --text-primary: #1b1f23;
    --text-secondary: #5c6970;
    --text-tertiary: #8a9299;
    --border-color: #d2d8dd;
    --primary-color: #0078d4;
    --primary-hover: #005a9e;
    --accent-color: #0078d4;
    --accent-hover: #005a9e;
    --shadow-color: rgba(0, 120, 212, 0.1);
    --success-color: #0078d4;
    --warning-color: #005a9e;
    --error-color: #004578;
    color-scheme: light;
}
`;

/**
 * Inject dark theme CSS into document.
 */
function injectThemeStyles() {
    if (document.getElementById('opennotes-theme-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'opennotes-theme-styles';
    style.textContent = darkThemeCSS;
    document.head.appendChild(style);
}

// Create default instance
let openNotesTheme;

// Initialize on DOM ready
if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') {
        injectThemeStyles();
        openNotesTheme = new OpenNotesTheme();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            injectThemeStyles();
            openNotesTheme = new OpenNotesTheme();
        });
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { OpenNotesTheme, injectThemeStyles };
}

/**
 * OpenNotes Analytics Module
 * Comprehensive analytics and statistics tracking.
 * 
 * Features:
 * - View/download tracking
 * - Statistics dashboard
 * - Chart rendering
 * - Export functionality
 * - Real-time updates
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesAnalytics {
    constructor(options = {}) {
        this.api = options.api || openNotesAPI;
        this.container = options.container 
            ? (typeof options.container === 'string' 
                ? document.querySelector(options.container) 
                : options.container)
            : null;
        
        this.options = {
            refreshInterval: options.refreshInterval || 0, // 0 = no auto-refresh
            showCharts: options.showCharts !== false,
            chartLibrary: options.chartLibrary || null, // Optional Chart.js instance
            theme: options.theme || 'light'
        };

        this.state = {
            stats: null,
            loading: false,
            error: null,
            lastUpdated: null
        };

        this.refreshTimer = null;

        if (this.container) {
            this.render();
            this.loadStats();
            
            if (this.options.refreshInterval > 0) {
                this.startAutoRefresh();
            }
        }
    }

    // ==================== RENDERING ====================

    render() {
        this.container.innerHTML = `
            <div class="analytics-dashboard ${this.options.theme}">
                <div class="analytics-header">
                    <h2>Analytics Dashboard</h2>
                    <div class="analytics-actions">
                        <button class="btn-refresh" title="Refresh">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                            </svg>
                        </button>
                        <button class="btn-export" title="Export Data">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                
                <div class="analytics-loading" style="display: none;">
                    <div class="spinner"></div>
                    <p>Loading analytics...</p>
                </div>
                
                <div class="analytics-error" style="display: none;">
                    <p class="error-message"></p>
                </div>
                
                <div class="analytics-content" style="display: none;">
                    <div class="stats-cards">
                        <div class="stat-card total-notes">
                            <div class="stat-icon">📚</div>
                            <div class="stat-value" data-stat="totalNotes">0</div>
                            <div class="stat-label">Total Notes</div>
                        </div>
                        <div class="stat-card total-views">
                            <div class="stat-icon">👀</div>
                            <div class="stat-value" data-stat="totalViews">0</div>
                            <div class="stat-label">Total Views</div>
                        </div>
                        <div class="stat-card total-downloads">
                            <div class="stat-icon">📥</div>
                            <div class="stat-value" data-stat="totalDownloads">0</div>
                            <div class="stat-label">Total Downloads</div>
                        </div>
                        <div class="stat-card verified-count">
                            <div class="stat-icon">✓</div>
                            <div class="stat-value" data-stat="verifiedNotes">0</div>
                            <div class="stat-label">Verified Notes</div>
                        </div>
                    </div>
                    
                    <div class="analytics-charts">
                        <div class="chart-container">
                            <h3>Format Distribution</h3>
                            <div class="chart-area" id="chart-formats"></div>
                        </div>
                        <div class="chart-container">
                            <h3>Top Authors</h3>
                            <div class="chart-area" id="chart-authors"></div>
                        </div>
                    </div>
                    
                    <div class="analytics-tables">
                        <div class="table-container">
                            <h3>Top Viewed Notes</h3>
                            <table class="analytics-table" id="table-top-viewed">
                                <thead>
                                    <tr>
                                        <th>Title</th>
                                        <th>Author</th>
                                        <th>Views</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <div class="table-container">
                            <h3>Most Downloaded</h3>
                            <table class="analytics-table" id="table-top-downloaded">
                                <thead>
                                    <tr>
                                        <th>Title</th>
                                        <th>Author</th>
                                        <th>Downloads</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <div class="table-container">
                            <h3>Recently Updated</h3>
                            <table class="analytics-table" id="table-recent">
                                <thead>
                                    <tr>
                                        <th>Title</th>
                                        <th>Author</th>
                                        <th>Updated</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    
                    <div class="analytics-footer">
                        <span class="last-updated">Last updated: <span class="update-time">Never</span></span>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
    }

    bindEvents() {
        const refreshBtn = this.container.querySelector('.btn-refresh');
        const exportBtn = this.container.querySelector('.btn-export');

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadStats());
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportData());
        }
    }

    // ==================== DATA LOADING ====================

    async loadStats() {
        this.state.loading = true;
        this.showLoading();

        try {
            const stats = await this.api.getStatistics();
            this.state.stats = stats;
            this.state.lastUpdated = new Date();
            this.state.error = null;

            this.updateDisplay();

        } catch (error) {
            this.state.error = error;
            this.showError(error.message);
        } finally {
            this.state.loading = false;
            this.hideLoading();
        }
    }

    updateDisplay() {
        const content = this.container.querySelector('.analytics-content');
        if (content) content.style.display = 'block';

        // Update stat cards
        const stats = this.state.stats;
        this.updateStatValue('totalNotes', stats.totalNotes);
        this.updateStatValue('totalViews', stats.totalViews);
        this.updateStatValue('totalDownloads', stats.totalDownloads);
        this.updateStatValue('verifiedNotes', stats.verifiedNotes);

        // Update charts
        if (this.options.showCharts) {
            this.renderFormatChart(stats.formats);
            this.renderAuthorChart(stats.authors);
        }

        // Update tables
        this.renderTopViewedTable(stats.topViewedNotes);
        this.renderTopDownloadedTable(stats.topDownloadedNotes);
        this.renderRecentTable(stats.recentlyUpdated);

        // Update timestamp
        const timeEl = this.container.querySelector('.update-time');
        if (timeEl && this.state.lastUpdated) {
            timeEl.textContent = this.state.lastUpdated.toLocaleString();
        }
    }

    updateStatValue(stat, value) {
        const el = this.container.querySelector(`[data-stat="${stat}"]`);
        if (el) {
            el.textContent = this.formatNumber(value);
        }
    }

    // ==================== CHART RENDERING ====================

    renderFormatChart(formats) {
        const container = this.container.querySelector('#chart-formats');
        if (!container) return;

        // Simple bar chart without external library
        const entries = Object.entries(formats).sort((a, b) => b[1] - a[1]);
        const maxValue = Math.max(...entries.map(e => e[1]));

        container.innerHTML = `
            <div class="simple-chart bar-chart">
                ${entries.map(([format, count]) => `
                    <div class="bar-row">
                        <span class="bar-label">${format.toUpperCase()}</span>
                        <div class="bar-container">
                            <div class="bar" style="width: ${(count / maxValue) * 100}%">
                                <span class="bar-value">${count}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderAuthorChart(authors) {
        const container = this.container.querySelector('#chart-authors');
        if (!container) return;

        const entries = Object.entries(authors)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        const maxValue = Math.max(...entries.map(e => e[1]));

        container.innerHTML = `
            <div class="simple-chart bar-chart">
                ${entries.map(([author, count]) => `
                    <div class="bar-row">
                        <span class="bar-label" title="${this.escapeHtml(author)}">${this.truncate(author, 20)}</span>
                        <div class="bar-container">
                            <div class="bar author-bar" style="width: ${(count / maxValue) * 100}%">
                                <span class="bar-value">${count}</span>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ==================== TABLE RENDERING ====================

    renderTopViewedTable(notes) {
        const tbody = this.container.querySelector('#table-top-viewed tbody');
        if (!tbody || !notes) return;

        tbody.innerHTML = notes.map(note => `
            <tr>
                <td title="${this.escapeHtml(note.title)}">${this.truncate(note.title, 40)}</td>
                <td>${this.escapeHtml(note.auth || 'Unknown')}</td>
                <td>${this.formatNumber(note.v || 0)}</td>
            </tr>
        `).join('');
    }

    renderTopDownloadedTable(notes) {
        const tbody = this.container.querySelector('#table-top-downloaded tbody');
        if (!tbody || !notes) return;

        tbody.innerHTML = notes.map(note => `
            <tr>
                <td title="${this.escapeHtml(note.title)}">${this.truncate(note.title, 40)}</td>
                <td>${this.escapeHtml(note.auth || 'Unknown')}</td>
                <td>${this.formatNumber(note.d || 0)}</td>
            </tr>
        `).join('');
    }

    renderRecentTable(notes) {
        const tbody = this.container.querySelector('#table-recent tbody');
        if (!tbody || !notes) return;

        tbody.innerHTML = notes.map(note => `
            <tr>
                <td title="${this.escapeHtml(note.title)}">${this.truncate(note.title, 40)}</td>
                <td>${this.escapeHtml(note.auth || 'Unknown')}</td>
                <td>${this.formatDate(note.upd)}</td>
            </tr>
        `).join('');
    }

    // ==================== STATISTICS METHODS ====================

    /**
     * Get current statistics
     */
    getStats() {
        return this.state.stats;
    }

    /**
     * Get specific statistic
     */
    getStat(key) {
        return this.state.stats?.[key];
    }

    /**
     * Calculate engagement rate
     */
    getEngagementRate() {
        const stats = this.state.stats;
        if (!stats || stats.noteViews === 0) return 0;
        return (stats.totalDownloads / stats.noteViews) * 100;
    }

    /**
     * Get notes per author average
     */
    getNotesPerAuthor() {
        const stats = this.state.stats;
        if (!stats) return 0;
        const authorCount = Object.keys(stats.authors || {}).length;
        if (authorCount === 0) return 0;
        return stats.totalNotes / authorCount;
    }

    /**
     * Get format percentages
     */
    getFormatPercentages() {
        const stats = this.state.stats;
        if (!stats || stats.totalNotes === 0) return {};

        const percentages = {};
        for (const [format, count] of Object.entries(stats.formats || {})) {
            percentages[format] = ((count / stats.totalNotes) * 100).toFixed(1);
        }
        return percentages;
    }

    /**
     * Compare two notes' performance
     */
    compareNotes(note1, note2) {
        return {
            viewsDiff: (note1.v || 0) - (note2.v || 0),
            downloadsDiff: (note1.d || 0) - (note2.d || 0),
            viewsRatio: note2.v ? ((note1.v || 0) / note2.v).toFixed(2) : 'N/A',
            downloadsRatio: note2.d ? ((note1.d || 0) / note2.d).toFixed(2) : 'N/A'
        };
    }

    // ==================== EXPORT FUNCTIONALITY ====================

    exportData(format = 'json') {
        const stats = this.state.stats;
        if (!stats) return;

        let data, filename, mimeType;

        switch (format) {
            case 'csv':
                data = this.statsToCSV(stats);
                filename = 'opennotes-analytics.csv';
                mimeType = 'text/csv';
                break;
            case 'json':
            default:
                data = JSON.stringify(stats, null, 2);
                filename = 'opennotes-analytics.json';
                mimeType = 'application/json';
        }

        this.downloadFile(data, filename, mimeType);
    }

    statsToCSV(stats) {
        const lines = [
            'Metric,Value',
            `Total Notes,${stats.totalNotes}`,
            `Total Views,${stats.totalViews}`,
            `Total Downloads,${stats.totalDownloads}`,
            `Note Views,${stats.noteViews}`,
            `Verified Notes,${stats.verifiedNotes}`,
            `Average Views,${stats.averageViews.toFixed(2)}`,
            `Average Downloads,${stats.averageDownloads.toFixed(2)}`,
            '',
            'Format,Count'
        ];

        for (const [format, count] of Object.entries(stats.formats)) {
            lines.push(`${format},${count}`);
        }

        lines.push('', 'Author,Count');
        for (const [author, count] of Object.entries(stats.authors)) {
            lines.push(`"${author}",${count}`);
        }

        return lines.join('\n');
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ==================== AUTO-REFRESH ====================

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshTimer = setInterval(() => {
            this.loadStats();
        }, this.options.refreshInterval);
    }

    stopAutoRefresh() {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    // ==================== UI HELPERS ====================

    showLoading() {
        const loading = this.container.querySelector('.analytics-loading');
        const content = this.container.querySelector('.analytics-content');
        const error = this.container.querySelector('.analytics-error');
        
        if (loading) loading.style.display = 'flex';
        if (content) content.style.display = 'none';
        if (error) error.style.display = 'none';
    }

    hideLoading() {
        const loading = this.container.querySelector('.analytics-loading');
        if (loading) loading.style.display = 'none';
    }

    showError(message) {
        const error = this.container.querySelector('.analytics-error');
        if (error) {
            error.style.display = 'flex';
            const msg = error.querySelector('.error-message');
            if (msg) msg.textContent = message;
        }
    }

    // ==================== UTILITY METHODS ====================

    formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toLocaleString();
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

    truncate(str, length) {
        if (!str || str.length <= length) return str || '';
        return str.substring(0, length) + '...';
    }

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ==================== DESTRUCTION ====================

    destroy() {
        this.stopAutoRefresh();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}

/**
 * Standalone analytics helpers
 */
OpenNotesAnalytics.helpers = {
    /**
     * Quick stats fetch
     */
    async getQuickStats(api = openNotesAPI) {
        return api.getStatistics();
    },

    /**
     * Get trending analysis
     */
    async getTrendingAnalysis(api = openNotesAPI, period = 7) {
        const stats = await api.getStatistics();
        return {
            topViewed: stats.topViewedNotes,
            topDownloaded: stats.topDownloadedNotes,
            recentlyUpdated: stats.recentlyUpdated,
            totalEngagement: stats.noteViews + stats.totalDownloads
        };
    },

    /**
     * Calculate growth metrics (placeholder - needs historical data)
     */
    calculateGrowth(current, previous) {
        if (!previous || previous === 0) return null;
        return ((current - previous) / previous) * 100;
    }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenNotesAnalytics;
}

/**
 * OpenNotes Export Module
 * Export and download utilities for notes and data.
 * 
 * @version 1.0.0
 * @author NagusameCS
 */

class OpenNotesExport {
    /**
     * Download a file with the given content.
     * @param {string} content - File content
     * @param {string} filename - Target filename
     * @param {string} mimeType - MIME type
     */
    static downloadFile(content, filename, mimeType = 'text/plain') {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(link);
        }, 100);
    }

    /**
     * Export notes data as JSON.
     * @param {Array} notes - Notes array
     * @param {string} filename - Target filename
     */
    static exportJSON(notes, filename = 'opennotes-export.json') {
        const data = {
            exported_at: new Date().toISOString(),
            count: notes.length,
            notes: notes
        };
        
        const content = JSON.stringify(data, null, 2);
        this.downloadFile(content, filename, 'application/json');
    }

    /**
     * Export notes data as CSV.
     * @param {Array} notes - Notes array
     * @param {string} filename - Target filename
     * @param {Array} columns - Column definitions
     */
    static exportCSV(notes, filename = 'opennotes-export.csv', columns = null) {
        if (!columns) {
            columns = [
                { key: 'id', header: 'ID' },
                { key: 'title', header: 'Title' },
                { key: 'auth', header: 'Author' },
                { key: 'fmt', header: 'Format' },
                { key: 'v', header: 'Views' },
                { key: 'd', header: 'Downloads' },
                { key: 'size', header: 'Size' },
                { key: 'upd', header: 'Updated' },
                { key: 'is_verified', header: 'Verified' }
            ];
        }

        const escapeCSV = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };

        const headers = columns.map(c => escapeCSV(c.header)).join(',');
        
        const rows = notes.map(note => 
            columns.map(col => escapeCSV(note[col.key])).join(',')
        );

        const content = [headers, ...rows].join('\n');
        this.downloadFile(content, filename, 'text/csv');
    }

    /**
     * Export notes as Markdown.
     * @param {Array} notes - Notes array
     * @param {string} filename - Target filename
     */
    static exportMarkdown(notes, filename = 'opennotes-export.md') {
        let content = '# OpenNotes Export\n\n';
        content += `Exported: ${new Date().toLocaleString()}\n\n`;
        content += `Total Notes: ${notes.length}\n\n`;
        content += '---\n\n';

        notes.forEach((note, index) => {
            content += `## ${index + 1}. ${note.title || 'Untitled'}\n\n`;
            content += `- **Author:** ${note.auth || 'Unknown'}\n`;
            content += `- **Format:** ${note.fmt || note.format || 'Unknown'}\n`;
            content += `- **Views:** ${note.v || 0}\n`;
            content += `- **Downloads:** ${note.d || 0}\n`;
            if (note.size) content += `- **Size:** ${note.size}\n`;
            if (note.upd) content += `- **Updated:** ${note.upd}\n`;
            if (note.is_verified) content += `- **Verified:** ✓\n`;
            if (note.dl) content += `- **Download:** [Link](${note.dl})\n`;
            content += '\n---\n\n';
        });

        this.downloadFile(content, filename, 'text/markdown');
    }

    /**
     * Export notes as HTML.
     * @param {Array} notes - Notes array
     * @param {string} filename - Target filename
     */
    static exportHTML(notes, filename = 'opennotes-export.html') {
        let content = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OpenNotes Export</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        h1 { color: #0078d4; }
        .meta { color: #5c6970; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #d2d8dd; }
        th { background: #deecf9; color: #004578; }
        tr:hover { background: #f6f8fa; }
        .verified { color: #0078d4; }
        a { color: #0078d4; }
    </style>
</head>
<body>
    <h1>OpenNotes Export</h1>
    <p class="meta">Exported: ${new Date().toLocaleString()} | Total: ${notes.length} notes</p>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Title</th>
                <th>Author</th>
                <th>Format</th>
                <th>Views</th>
                <th>Downloads</th>
                <th>Verified</th>
                <th>Download</th>
            </tr>
        </thead>
        <tbody>`;

        notes.forEach((note, index) => {
            content += `
            <tr>
                <td>${index + 1}</td>
                <td>${this.escapeHTML(note.title || 'Untitled')}</td>
                <td>${this.escapeHTML(note.auth || 'Unknown')}</td>
                <td>${this.escapeHTML(note.fmt || note.format || '')}</td>
                <td>${note.v || 0}</td>
                <td>${note.d || 0}</td>
                <td>${note.is_verified ? '<span class="verified">✓</span>' : ''}</td>
                <td>${note.dl ? `<a href="${this.escapeHTML(note.dl)}">Download</a>` : ''}</td>
            </tr>`;
        });

        content += `
        </tbody>
    </table>
</body>
</html>`;

        this.downloadFile(content, filename, 'text/html');
    }

    /**
     * Export notes as XML.
     * @param {Array} notes - Notes array
     * @param {string} filename - Target filename
     */
    static exportXML(notes, filename = 'opennotes-export.xml') {
        let content = '<?xml version="1.0" encoding="UTF-8"?>\n';
        content += '<opennotes>\n';
        content += `  <export_date>${new Date().toISOString()}</export_date>\n`;
        content += `  <count>${notes.length}</count>\n`;
        content += '  <notes>\n';

        notes.forEach(note => {
            content += '    <note>\n';
            content += `      <id>${this.escapeXML(String(note.id))}</id>\n`;
            content += `      <title>${this.escapeXML(note.title || '')}</title>\n`;
            content += `      <author>${this.escapeXML(note.auth || '')}</author>\n`;
            content += `      <format>${this.escapeXML(note.fmt || note.format || '')}</format>\n`;
            content += `      <views>${note.v || 0}</views>\n`;
            content += `      <downloads>${note.d || 0}</downloads>\n`;
            content += `      <size>${this.escapeXML(note.size || '')}</size>\n`;
            content += `      <updated>${this.escapeXML(note.upd || '')}</updated>\n`;
            content += `      <verified>${note.is_verified ? 'true' : 'false'}</verified>\n`;
            if (note.dl) {
                content += `      <download_url>${this.escapeXML(note.dl)}</download_url>\n`;
            }
            content += '    </note>\n';
        });

        content += '  </notes>\n';
        content += '</opennotes>';

        this.downloadFile(content, filename, 'application/xml');
    }

    /**
     * Print notes.
     * @param {Array} notes - Notes array
     */
    static print(notes) {
        const printWindow = window.open('', '', 'width=800,height=600');
        
        let content = `<!DOCTYPE html>
<html>
<head>
    <title>OpenNotes - Print</title>
    <style>
        body { font-family: system-ui, sans-serif; padding: 20px; }
        h1 { font-size: 24px; margin-bottom: 10px; }
        .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { padding: 8px; text-align: left; border: 1px solid #ddd; }
        th { background: #f0f0f0; }
        @media print { body { padding: 0; } }
    </style>
</head>
<body>
    <h1>OpenNotes Export</h1>
    <p class="meta">Printed: ${new Date().toLocaleString()} | Total: ${notes.length} notes</p>
    <table>
        <thead>
            <tr><th>#</th><th>Title</th><th>Author</th><th>Format</th><th>Views</th></tr>
        </thead>
        <tbody>`;

        notes.forEach((note, i) => {
            content += `<tr>
                <td>${i + 1}</td>
                <td>${this.escapeHTML(note.title || 'Untitled')}</td>
                <td>${this.escapeHTML(note.auth || 'Unknown')}</td>
                <td>${this.escapeHTML(note.fmt || '')}</td>
                <td>${note.v || 0}</td>
            </tr>`;
        });

        content += '</tbody></table></body></html>';

        printWindow.document.write(content);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    }

    /**
     * Copy notes data to clipboard as text.
     * @param {Array} notes - Notes array
     */
    static async copyToClipboard(notes) {
        const text = notes.map((note, i) => 
            `${i + 1}. ${note.title || 'Untitled'} by ${note.auth || 'Unknown'} (${note.fmt || 'Unknown'})`
        ).join('\n');

        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            return false;
        }
    }

    /**
     * Generate shareable link.
     * @param {Object} note - Note object
     * @returns {string} Shareable URL
     */
    static generateShareLink(note) {
        const baseUrl = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({ note: note.id });
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Share note using Web Share API (if available).
     * @param {Object} note - Note object
     */
    static async share(note) {
        const shareData = {
            title: note.title || 'OpenNotes',
            text: `Check out "${note.title}" by ${note.auth}`,
            url: this.generateShareLink(note)
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
                return true;
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Share failed:', error);
                }
                return false;
            }
        } else {
            // Fallback: copy to clipboard
            return await this.copyToClipboard([note]);
        }
    }

    /**
     * Escape HTML special characters.
     * @private
     */
    static escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    /**
     * Escape XML special characters.
     * @private
     */
    static escapeXML(str) {
        return (str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenNotesExport;
}

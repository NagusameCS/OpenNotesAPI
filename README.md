# OpenNotes API

A comprehensive API integration for the [OpenNotes](https://opennotes.pages.dev) educational notes platform.

![OpenNotes API](https://img.shields.io/badge/OpenNotes-API-blue)
![Version](https://img.shields.io/badge/version-2.0.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Overview

OpenNotes API provides complete programmatic access to the OpenNotes platform, enabling you to:

- **Browse Notes** - Retrieve, filter, and sort educational notes
- **Search** - Full-text search with advanced filtering
- **Track Analytics** - View and download counters, statistics
- **UI Components** - Ready-to-use browser, search, and analytics widgets

## Security Architecture

This SDK uses a **secure gateway proxy** pattern for A+ security:

- **No exposed API keys** - All secrets are stored server-side in the Cloudflare Worker
- **App token authorization** - Third-party apps can be authorized with unique tokens
- **Rate limiting** - Built-in protection against abuse
- **Origin validation** - Only approved origins can access the API

See the [worker/README.md](worker/README.md) for gateway deployment instructions.

## Quick Start

### 1. Include the SDK

```html
<!-- Configuration -->
<script src="js/config.js"></script>

<!-- Core API Client -->
<script src="js/api-client.js"></script>

<!-- Optional: UI Components -->
<script src="js/notes-browser.js"></script>
<script src="js/search.js"></script>
<script src="js/analytics.js"></script>

<!-- Styles -->
<link rel="stylesheet" href="css/styles.css">
```

### 2. Make Your First Request

```javascript
// Get list of notes
const response = await openNotesAPI.getNotes({
    limit: 10,
    sort: 'views'
});

console.log(response.items); // Array of notes
```

### 3. Search for Notes

```javascript
const results = await openNotesAPI.searchNotes('physics', {
    format: 'pdf',
    limit: 20
});
```

## Features

### Core API Client

The `OpenNotesAPIClient` class provides all core functionality:

```javascript
// Get notes with various options
await openNotesAPI.getNotes({ sort: 'views', limit: 10 });
await openNotesAPI.getNote('note-id');
await openNotesAPI.searchNotes('chemistry');
await openNotesAPI.getNotesByAuthor('Chenyu Li');
await openNotesAPI.getNotesByFormat('pdf');
await openNotesAPI.getTrendingNotes(5);
await openNotesAPI.getMostDownloaded(5);
await openNotesAPI.getRecentNotes(5);

// Counters
await openNotesAPI.incrementViews('note-id');
await openNotesAPI.incrementDownloads('note-id');

// Statistics
await openNotesAPI.getStatistics();
await openNotesAPI.getTotalViews();
await openNotesAPI.getCurrentUser();

// Utilities
await openNotesAPI.healthCheck();
openNotesAPI.clearCache();
```

### Notes Browser Component

Create interactive note browsing interfaces:

```javascript
const browser = new NotesBrowser('#container', {
    viewMode: 'grid',
    pageSize: 20,
    showFilters: true,
    showSorting: true,
    showPagination: true,
    enableFavorites: true,
    onNoteClick: (note) => console.log('Clicked:', note)
});
```

### Search Component

Add powerful search with autocomplete:

```javascript
const search = new OpenNotesSearch({
    container: '#search-box',
    placeholder: 'Search notes...',
    onSearch: (query) => console.log('Searching:', query)
});

// Advanced search
const results = await search.advancedSearch('author:Chenyu format:pdf physics');
```

### Analytics Dashboard

Display comprehensive statistics:

```javascript
const analytics = new OpenNotesAnalytics({
    container: '#dashboard',
    showCharts: true,
    refreshInterval: 60000
});
```

## API Reference

### Notes Endpoints

| Method | Description |
|--------|-------------|
| `getNotes(options)` | Get list of notes |
| `getNote(noteId)` | Get single note |
| `searchNotes(query, options)` | Search notes |
| `getNotesByAuthor(author)` | Filter by author |
| `getNotesByFormat(format)` | Filter by format |
| `getVerifiedNotes()` | Get verified notes only |
| `getTrendingNotes(limit)` | Get most viewed |
| `getMostDownloaded(limit)` | Get most downloaded |
| `getRecentNotes(limit)` | Get recently updated |

### Counter Endpoints

| Method | Description |
|--------|-------------|
| `incrementViews(noteId)` | Increment view count |
| `incrementDownloads(noteId)` | Increment download count |
| `getViewCount(noteId)` | Get view count |
| `getDownloadCount(noteId)` | Get download count |

### Statistics

| Method | Description |
|--------|-------------|
| `getStatistics()` | Get comprehensive stats |
| `getFormatStats()` | Get format distribution |
| `getAuthorStats()` | Get author distribution |
| `getTotalViews()` | Get total site views |
| `getCurrentUser()` | Get current user info |

## Response Format

```json
{
    "items": [
        {
            "id": 1,
            "name": "AP Calculus AB Notes.pdf",
            "title": "AP Calculus AB Notes",
            "format": "pdf",
            "v": 110,
            "d": 5,
            "auth": "Chenyu Li",
            "is_verified": true,
            "thumb": "https://...",
            "dl": "https://...",
            "upd": "2025-08-19T03:41:58Z",
            "size": "9.18 MiB"
        }
    ],
    "meta": {
        "views": 4734,
        "user": { "name": "...", "is_admin": true }
    }
}
```

## Event System

```javascript
openNotesAPI.on('request:start', (data) => console.log('Started'));
openNotesAPI.on('request:success', (data) => console.log('Success'));
openNotesAPI.on('request:error', (data) => console.error('Error'));
openNotesAPI.on('cache:hit', (data) => console.log('Cache hit'));
```

## Caching

The SDK includes intelligent caching:

- Notes list: 5 minutes
- Note details: 10 minutes
- Statistics: 2 minutes

```javascript
// Clear all cache
openNotesAPI.clearCache();

// Clear specific entry
openNotesAPI.clearCacheEntry(key);
```

## Error Handling

```javascript
try {
    const notes = await openNotesAPI.getNotes();
} catch (error) {
    if (error instanceof OpenNotesAPIError) {
        if (error.is403()) console.error('Access denied');
        if (error.is404()) console.error('Not found');
    }
}
```

## Project Structure

```
OpenNotesAPI/
├── index.html          # Main application
├── docs.html           # API documentation
├── examples.html       # Interactive examples
├── css/
│   └── styles.css      # Complete stylesheet
├── js/
│   ├── config.js       # Configuration & API key
│   ├── utils.js        # Utility functions
│   ├── events.js       # Event bus system
│   ├── api-client.js   # Core API client
│   ├── notes-browser.js# Notes browser component
│   ├── search.js       # Search component
│   ├── analytics.js    # Analytics dashboard
│   ├── favorites.js    # Favorites management
│   ├── export.js       # Export utilities
│   ├── theme.js        # Theme management
│   └── opennotes.js    # SDK entry point
└── README.md
```

## Authentication

All API requests require the `X-Api-Key` header:

```javascript
headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'your-api-key'
}
```

**Important:** Requests must originate from an approved domain and path.

## Live Demo

Visit [NagusameCS.github.io/OpenNotesAPI](https://NagusameCS.github.io/OpenNotesAPI) to see the API in action.

## Related Links

- [OpenNotes Platform](https://opennotes.pages.dev)
- [OpenNotes GitHub](https://github.com/Tebby2008/OpenNotes)
- [API Documentation](docs.html)
- [Interactive Examples](examples.html)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with ❤️ for the OpenNotes platform
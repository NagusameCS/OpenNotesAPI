# OpenNotes API Gateway

A secure Cloudflare Worker that acts as a proxy to the OpenNotes API, providing:

- **Secure API Key Storage**: The actual API key is stored as a Cloudflare secret, never exposed in client code
- **App Token Authentication**: Third-party apps must register and use tokens to access the API
- **Rate Limiting**: Per-app rate limiting to prevent abuse
- **CORS Handling**: Proper CORS headers for cross-origin requests
- **Security Headers**: XSS protection, content-type sniffing prevention, etc.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Client App    │────▶│  API Gateway Worker  │────▶│  OpenNotes API  │
│  (with token)   │     │  (validates & proxies)│     │  (actual API)   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Cloudflare      │
                        │  Secrets         │
                        │  - API_KEY       │
                        │  - APP_TOKENS    │
                        └──────────────────┘
```

## Deployment

### Prerequisites

- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Setup

1. Install Wrangler:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Set the secrets:
   ```bash
   # The actual OpenNotes API key
   wrangler secret put OPENNOTES_API_KEY
   
   # App tokens JSON (see format below)
   wrangler secret put APP_TOKENS
   
   # Admin token for management
   wrangler secret put ADMIN_TOKEN
   ```

4. Deploy:
   ```bash
   wrangler deploy
   ```

### APP_TOKENS Format

```json
{
  "my-app": {
    "token": "app_token_my_app_secret_key_here",
    "active": true,
    "rateLimit": 100,
    "name": "My Application",
    "owner": "developer@example.com",
    "created": "2026-02-06"
  },
  "another-app": {
    "token": "app_token_another_app_secret_key",
    "active": true,
    "rateLimit": 50,
    "name": "Another App",
    "owner": "other@example.com",
    "created": "2026-02-06"
  }
}
```

## API Endpoints

| Endpoint | Method | Auth Required | Description |
|----------|--------|---------------|-------------|
| `/` | GET | No | API info |
| `/api/health` | GET | No | Health check |
| `/api/notes` | GET | Yes* | List all notes |
| `/api/notes/:id` | GET | Yes* | Get note by ID |
| `/api/search?q=query` | GET | Yes* | Search notes |

*Auth is optional for requests from the official frontend (nagusamecs.github.io)

## Authentication

Include your app token in requests:

```bash
# Using X-App-Token header
curl -H "X-App-Token: your-token-here" \
  https://your-worker.workers.dev/api/notes

# Or using Bearer token
curl -H "Authorization: Bearer your-token-here" \
  https://your-worker.workers.dev/api/notes
```

## Rate Limits

- Default: 100 requests per minute per app
- Configurable per app via `rateLimit` in APP_TOKENS
- 429 response when exceeded with Retry-After header

## Security Features

- API key never exposed to clients
- Token validation on every request
- Rate limiting per app
- Security headers on all responses
- CORS properly configured
- Input validation
- Error messages don't leak sensitive info

## License

MIT License - See LICENSE file

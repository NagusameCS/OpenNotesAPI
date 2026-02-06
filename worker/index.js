/**
 * OpenNotes API Gateway - Cloudflare Worker
 * 
 * This worker acts as a secure proxy to the OpenNotes API.
 * It validates app tokens and forwards requests with the real API key.
 * 
 * Environment Variables (set in Cloudflare dashboard):
 * - OPENNOTES_API_KEY: The actual API key for OpenNotes
 * - APP_TOKENS: JSON string of authorized app tokens
 * - ADMIN_TOKEN: Token for admin operations
 * 
 * @license MIT
 */

const OPENNOTES_API = 'https://open-notes.tebby2008-li.workers.dev';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token',
  'Access-Control-Max-Age': '86400',
};

// Rate limiting store (per worker instance)
const rateLimitStore = new Map();

/**
 * Validate app token against authorized tokens
 */
function validateAppToken(token, env) {
  if (!token) return { valid: false, app: null };
  
  try {
    const tokens = JSON.parse(env.APP_TOKENS || '{}');
    for (const [appId, config] of Object.entries(tokens)) {
      if (config.token === token && config.active) {
        return { valid: true, app: appId, config };
      }
    }
  } catch (e) {
    console.error('Token validation error:', e);
  }
  
  return { valid: false, app: null };
}

/**
 * Check rate limit for an app
 */
function checkRateLimit(appId, config) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute window
  const maxRequests = config?.rateLimit || 100;
  
  const key = `${appId}`;
  const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  
  record.count++;
  rateLimitStore.set(key, record);
  
  return {
    allowed: record.count <= maxRequests,
    remaining: Math.max(0, maxRequests - record.count),
    resetAt: record.resetAt,
  };
}

/**
 * Generate secure response headers
 */
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'",
  };
}

/**
 * Handle OPTIONS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Proxy request to OpenNotes API
 */
async function proxyToOpenNotes(request, env, appId) {
  const url = new URL(request.url);
  const targetUrl = new URL(OPENNOTES_API);
  
  // Copy search params
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });
  
  // Build proxy request
  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': env.OPENNOTES_API_KEY,
      'Origin': 'https://nagusamecs.github.io',
      'Referer': 'https://nagusamecs.github.io/OpenNotesAPI/',
    },
  });
  
  try {
    const response = await fetch(proxyRequest);
    const data = await response.text();
    
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
        'X-App-Id': appId,
        'X-Powered-By': 'OpenNotesAPI Gateway',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Upstream API error' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
      },
    });
  }
}

/**
 * Handle API info endpoint
 */
function handleApiInfo() {
  return new Response(JSON.stringify({
    name: 'OpenNotes API Gateway',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      '/': 'API info',
      '/api/notes': 'List notes (requires X-App-Token)',
      '/api/notes/:id': 'Get note by ID (requires X-App-Token)',
      '/api/search': 'Search notes (requires X-App-Token)',
      '/api/health': 'Health check',
    },
    documentation: 'https://nagusamecs.github.io/OpenNotesAPI/docs.html',
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...securityHeaders(),
    },
  });
}

/**
 * Handle health check
 */
function handleHealth() {
  return new Response(JSON.stringify({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...securityHeaders(),
    },
  });
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }
    
    // Public endpoints
    if (path === '/' || path === '') {
      return handleApiInfo();
    }
    
    if (path === '/api/health' || path === '/health') {
      return handleHealth();
    }
    
    // Protected endpoints require app token
    const appToken = request.headers.get('X-App-Token');
    const authHeader = request.headers.get('Authorization');
    const token = appToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
    
    // Allow requests from the official frontend without token
    const origin = request.headers.get('Origin') || '';
    const referer = request.headers.get('Referer') || '';
    const isOfficialFrontend = origin.includes('nagusamecs.github.io') || 
                               referer.includes('nagusamecs.github.io');
    
    let appId = 'anonymous';
    
    if (!isOfficialFrontend) {
      const validation = validateAppToken(token, env);
      
      if (!validation.valid) {
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          message: 'Valid X-App-Token header required. Request access at https://nagusamecs.github.io/OpenNotesAPI/',
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
            ...securityHeaders(),
          },
        });
      }
      
      appId = validation.app;
      
      // Check rate limit
      const rateLimit = checkRateLimit(appId, validation.config);
      if (!rateLimit.allowed) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString(),
            'X-RateLimit-Remaining': '0',
            ...corsHeaders,
            ...securityHeaders(),
          },
        });
      }
    } else {
      appId = 'official-frontend';
    }
    
    // Route API requests
    if (path.startsWith('/api/')) {
      // Map paths to OpenNotes API params
      const apiPath = path.replace('/api/', '');
      
      // Set type parameter based on path
      if (apiPath === 'notes' || apiPath === 'notes/') {
        url.searchParams.set('type', 'list');
      } else if (apiPath.startsWith('notes/')) {
        const noteId = apiPath.replace('notes/', '');
        url.searchParams.set('type', 'note');
        url.searchParams.set('noteId', noteId);
      } else if (apiPath === 'search' || apiPath === 'search/') {
        url.searchParams.set('type', 'list');
      }
      
      return proxyToOpenNotes(new Request(url.toString(), request), env, appId);
    }
    
    // 404 for unknown paths
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: path,
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        ...securityHeaders(),
      },
    });
  },
};

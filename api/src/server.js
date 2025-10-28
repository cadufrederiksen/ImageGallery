const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const SAMPLE_PATH = path.join(__dirname, 'data', 'sample_photos.json');

// OAuth/Unsplash config
const UNSPLASH_CLIENT_ID = process.env.UNSPLASH_CLIENT_ID || '';
const UNSPLASH_CLIENT_SECRET = process.env.UNSPLASH_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/api/auth/callback';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:8080';
const RAW_UNSPLASH_SCOPES = process.env.UNSPLASH_SCOPES || 'public';
// Sanitize and validate scopes to avoid malformed requests
const ALLOWED_SCOPES = new Set([
  'public',
  'read_user', 'write_user',
  'read_photos', /* 'write_photos' (deprecated/unused) */ 'write_likes',
  'read_collections', 'write_collections'
]);
const SCOPES_LIST = RAW_UNSPLASH_SCOPES
  .replace(/["']/g, '') // strip quotes
  .split(/[\s,]+/)      // split by spaces or commas
  .filter(Boolean)
  .filter(s => ALLOWED_SCOPES.has(s));
const UNSPLASH_SCOPES = (SCOPES_LIST.length ? SCOPES_LIST : ['public']).join(' ');

// In-memory session store: sid -> { access_token, createdAt }
const sessions = new Map();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
}

function writeHeadWithCors(res, statusCode, headers = {}) {
  setCors(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers,
  });
}

function jsonResponse(res, statusCode, obj) {
  if (res.headersSent || res.writableEnded) return; // avoid double-send
  setCors(res);
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function sendRawJson(res, statusCode, text) {
  if (res.headersSent || res.writableEnded) return; // avoid double-send
  writeHeadWithCors(res, statusCode);
  res.end(text);
}

function parseCookies(req) {
  const header = req.headers['cookie'];
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    const key = decodeURIComponent(part.slice(0, idx).trim());
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    acc[key] = val;
    return acc;
  }, {});
}

function makeSid() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function setSessionCookie(res, sid) {
  // Cookie for localhost; SameSite=Lax so it survives the redirect back.
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax`);
}

async function likePhoto(token, photoId, method = 'POST') {
  const resp = await fetch(`https://api.unsplash.com/photos/${encodeURIComponent(photoId)}/like`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  const text = await resp.text();
  return { status: resp.status, body: text };
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const cookies = parseCookies(req);
  const sid = cookies.sid;
  const session = sid ? sessions.get(sid) : null;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // OAuth: login -> redirect to Unsplash
  if (parsed.pathname === '/api/auth/login' && req.method === 'GET') {
    if (!UNSPLASH_CLIENT_ID) return jsonResponse(res, 500, { error: 'Server not configured with UNSPLASH_CLIENT_ID' });
    const authUrl = `https://unsplash.com/oauth/authorize?client_id=${encodeURIComponent(UNSPLASH_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(UNSPLASH_SCOPES)}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // Helper: expose the redirect URI the server is using (for easy copy/paste into Unsplash dashboard)
  if (parsed.pathname === '/api/auth/redirect-uri' && req.method === 'GET') {
    return jsonResponse(res, 200, { redirectUri: REDIRECT_URI });
  }

  // Helper: expose the exact authorize URL the server will redirect to (debug aid)
  if (parsed.pathname === '/api/auth/authorize-url' && req.method === 'GET') {
    if (!UNSPLASH_CLIENT_ID) return jsonResponse(res, 500, { error: 'Server not configured with UNSPLASH_CLIENT_ID' });
    const authorizeUrl = `https://unsplash.com/oauth/authorize?client_id=${encodeURIComponent(UNSPLASH_CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(UNSPLASH_SCOPES)}`;
    return jsonResponse(res, 200, { authorizeUrl });
  }

  // Helper: show scopes configured on server
  if (parsed.pathname === '/api/auth/scopes' && req.method === 'GET') {
    return jsonResponse(res, 200, { scopes: UNSPLASH_SCOPES, raw: RAW_UNSPLASH_SCOPES });
  }

  // OAuth callback: exchange code -> access_token; set session cookie and redirect to frontend
  if (parsed.pathname === '/api/auth/callback' && req.method === 'GET') {
    const code = parsed.query.code;
    if (!code) {
      res.writeHead(302, { Location: ALLOWED_ORIGIN });
      res.end();
      return;
    }
    try {
      // Send client credentials in the form body for maximum compatibility.
      const body = new url.URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: UNSPLASH_CLIENT_ID,
        client_secret: UNSPLASH_CLIENT_SECRET
      }).toString();

      const tokenResp = await fetch('https://unsplash.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body
      });
      const tokenText = await tokenResp.text();
      if (!tokenResp.ok) {
        console.error('Token exchange failed:', tokenResp.status, tokenText);
        res.writeHead(302, { Location: `${ALLOWED_ORIGIN}?auth=error` });
        res.end();
        return;
      }
      const tokenJson = JSON.parse(tokenText);
      const newSid = makeSid();
      sessions.set(newSid, { access_token: tokenJson.access_token, createdAt: Date.now() });
      setSessionCookie(res, newSid);
      res.writeHead(302, { Location: ALLOWED_ORIGIN });
      res.end();
      return;
    } catch (e) {
      console.error('OAuth callback error:', e);
      res.writeHead(302, { Location: `${ALLOWED_ORIGIN}?auth=error` });
      res.end();
      return;
    }
  }

  // Logout: clear session
  if (parsed.pathname === '/api/auth/logout' && req.method === 'POST') {
    if (sid) sessions.delete(sid);
    // expire cookie
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    return jsonResponse(res, 200, { ok: true });
  }

  // Who am I
  if (parsed.pathname === '/api/me' && req.method === 'GET') {
    if (!session?.access_token) return jsonResponse(res, 401, { authenticated: false });
    try {
      const me = await fetch('https://api.unsplash.com/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const obj = await me.json();
      jsonResponse(res, me.status, obj);
      return;
    } catch (e) {
      return jsonResponse(res, 502, { error: 'Failed to fetch profile' });
    }
  }

  // Search photos (authorized if logged in; otherwise app access key if provided; else sample)
  if (parsed.pathname === '/api/search' && req.method === 'GET') {
    const q = (parsed.query.q || parsed.query.query || '').trim();
    if (!q) return jsonResponse(res, 400, { error: 'query parameter required' });

    try {
      if (session?.access_token) {
        const u = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=20`;
        const resp = await fetch(u, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const obj = await resp.json();
        jsonResponse(res, resp.status, obj);
        return;
      }
      // fallback to app key (client_id) if provided in server env (less secure but server-side)
      // Accept UNSPLASH_ACCESS_KEY, ACCESSKEY, or UNSPLASH_CLIENT_ID
      const appKey = process.env.UNSPLASH_ACCESS_KEY || process.env.ACCESSKEY || UNSPLASH_CLIENT_ID;
      if (appKey) {
        const u = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=20`;
        const resp = await fetch(u, { headers: { Authorization: `Client-ID ${appKey}` } });
        const obj = await resp.json();
        jsonResponse(res, resp.status, obj);
        return;
      }
      // fallback sample
      const raw = fs.readFileSync(SAMPLE_PATH, 'utf8');
      const data = JSON.parse(raw);
      const qLower = q.toLowerCase();
      data.results = (data.results || []).filter(item => {
        const alt = (item.alt_description || '').toLowerCase();
        const id = (item.id || '').toLowerCase();
        return alt.includes(qLower) || id.includes(qLower);
      });
      return jsonResponse(res, 200, data);
    } catch (err) {
      console.error('Search error:', err);
      return jsonResponse(res, 500, { error: 'Server error' });
    }
  }

  // Random photos
  if (parsed.pathname === '/api/random' && req.method === 'GET') {
    const countRaw = parsed.query.count;
    let count = parseInt(countRaw, 10);
    if (!Number.isFinite(count) || count <= 0) count = 12;
    if (count > 30) count = 30; // Unsplash max per request
    try {
      const endpoint = `https://api.unsplash.com/photos/random?count=${count}`;
      if (session?.access_token) {
        const resp = await fetch(endpoint, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const obj = await resp.json();
        return jsonResponse(res, resp.status, { results: Array.isArray(obj) ? obj : [obj] });
      }
      const appKey = process.env.UNSPLASH_ACCESS_KEY || process.env.ACCESSKEY || UNSPLASH_CLIENT_ID;
      if (appKey) {
        const resp = await fetch(endpoint, { headers: { Authorization: `Client-ID ${appKey}` } });
        const obj = await resp.json();
        return jsonResponse(res, resp.status, { results: Array.isArray(obj) ? obj : [obj] });
      }
      // fallback sample
      const raw = fs.readFileSync(SAMPLE_PATH, 'utf8');
      const data = JSON.parse(raw);
      // just return first N
      data.results = (data.results || []).slice(0, count);
      return jsonResponse(res, 200, data);
    } catch (err) {
      console.error('Random error:', err);
      return jsonResponse(res, 500, { error: 'Server error' });
    }
  }

  // Favorites (liked photos of the authenticated user)
  if (parsed.pathname === '/api/favorites' && req.method === 'GET') {
    if (!session?.access_token) return jsonResponse(res, 401, { error: 'Not authenticated' });
    const perPageRaw = parsed.query.per_page;
    const pageRaw = parsed.query.page;
    let perPage = parseInt(perPageRaw, 10);
    let page = parseInt(pageRaw, 10);
    if (!Number.isFinite(perPage) || perPage <= 0) perPage = 30;
    if (perPage > 30) perPage = 30;
    if (!Number.isFinite(page) || page <= 0) page = 1;
    try {
      // fetch username
      const meResp = await fetch('https://api.unsplash.com/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!meResp.ok) {
        const t = await meResp.text();
        console.error('Favorites /me failed:', meResp.status, t);
        return jsonResponse(res, 502, { error: 'Failed to fetch profile for favorites' });
      }
      const me = await meResp.json();
      const username = me?.username || me?.user?.username;
      if (!username) return jsonResponse(res, 502, { error: 'Missing username in profile' });

      const likesUrl = `https://api.unsplash.com/users/${encodeURIComponent(username)}/likes?per_page=${perPage}&page=${page}`;
      const likesResp = await fetch(likesUrl, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const likesText = await likesResp.text();
      let likes;
      try { likes = JSON.parse(likesText); } catch { likes = []; }
      if (!likesResp.ok) {
        // propagate common auth/scope errors clearly
        if (likesResp.status === 401) return jsonResponse(res, 401, { error: 'Unauthorized. Please log in again.' });
        if (likesResp.status === 403) return jsonResponse(res, 403, { error: 'Access to favorites denied.' });
        return jsonResponse(res, likesResp.status, { error: 'Failed to fetch favorites', details: likes });
      }
      return jsonResponse(res, 200, { results: Array.isArray(likes) ? likes : [] });
    } catch (err) {
      console.error('Favorites error:', err);
      return jsonResponse(res, 500, { error: 'Server error' });
    }
  }

  // Like / Unlike photo (requires auth)
  if (parsed.pathname?.startsWith('/api/photos/') && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!session?.access_token) return jsonResponse(res, 401, { error: 'Not authenticated' });
    const parts = parsed.pathname.split('/');
    const photoId = parts[3];
    if (!photoId) return jsonResponse(res, 400, { error: 'Missing photo id' });
    try {
  const { status, body } = await likePhoto(session.access_token, photoId, req.method);
  let obj;
  try { obj = JSON.parse(body); } catch { obj = { raw: body }; }
  if (status === 401) {
        return jsonResponse(res, 401, { error: 'Unauthorized. Please log in again.' });
      }
      if (status === 403) {
        return jsonResponse(res, 403, { error: 'Action requires Unsplash scope "write_likes". Update UNSPLASH_SCOPES to "public write_likes" and ensure the app is approved.' });
      }
      jsonResponse(res, status, obj);
      return;
    } catch (e) {
      console.error('Like API failed:', e);
      return jsonResponse(res, 502, { error: 'Failed to like photo' });
    }
  }

  // not found
  jsonResponse(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {   
  console.log(`API listening on http://localhost:${PORT}`);
});
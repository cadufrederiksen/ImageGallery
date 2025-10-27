const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const SAMPLE_PATH = path.join(__dirname, 'data', 'sample_photos.json');

function jsonResponse(res, statusCode, obj) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname === '/api/search' && req.method === 'GET') {
    const q = (parsed.query.q || parsed.query.query || '').trim();
    if (!q) return jsonResponse(res, 400, { error: 'query parameter required' });

    const key = process.env.UNSPLASH_ACCESS_KEY;
    if (key) {
      try {
        const u = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=20`;
        const resp = await fetch(u, { headers: { Authorization: `Client-ID ${key}` } });
        const text = await resp.text();
        // forward Unsplash response status and body
        res.writeHead(resp.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(text);
        return;
      } catch (err) {
        console.error('Unsplash fetch failed:', err);
        return jsonResponse(res, 502, { error: 'Failed to fetch from Unsplash' });
      }
    }

    // fallback to local sample JSON
    try {
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
      console.error('Reading sample JSON failed:', err);
      return jsonResponse(res, 500, { error: 'Server error' });
    }
  }

  // not found
  jsonResponse(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
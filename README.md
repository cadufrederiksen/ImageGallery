# ImageGallery

A simple Unsplash-powered image gallery with a static frontend (HTML/CSS/JS) and a secure Node.js API proxy for search and user actions (login, like/unlike). Runs locally with Docker Compose.

## What’s here

- Frontend: `index.html`, `gallery.css`, `gallery.js`
- Backend API: `api/src/server.js` (Node http server, no Express)
- Docker Compose: `docker-compose.yml` (nginx for web, Node for API)

## Prerequisites

- Docker and Docker Compose

## Setup

1) Create a free Unsplash developer app and get the Client ID and Client Secret:
	- https://unsplash.com/oauth/applications
	- Add an OAuth Redirect URI: `http://localhost:3000/api/auth/callback`

2) Copy `.env` and fill values:

	- `ACCESSKEY` (optional) App access key used for anonymous searches
	- `UNSPLASH_CLIENT_ID` and `UNSPLASH_CLIENT_SECRET` (required for login/likes)
	- `REDIRECT_URI` must match the value set in the Unsplash dashboard exactly
	- `ALLOWED_ORIGIN` should be `http://localhost:8080`

Example:

```
ACCESSKEY=REPLACE_WITH_YOUR_APP_ACCESS_KEY
PORT=3000
ALLOWED_ORIGIN=http://localhost:8080
UNSPLASH_CLIENT_ID=REPLACE_ME
UNSPLASH_CLIENT_SECRET=REPLACE_ME
REDIRECT_URI=http://localhost:3000/api/auth/callback
```

## Run

Start both services:

```
docker compose up --build
```

Open the web app:

- http://localhost:8080

Actions:

- Search images: type a query and click Search
- Login with Unsplash: enables Like/Unlike on photos

To stop:

```
docker compose down
```

## Notes on security

- Secrets (client secret, tokens) are never exposed to the browser. The client calls the local API, which talks to Unsplash securely.
- `gallery.js` always uses `credentials: 'include'` so the browser sends the HttpOnly session cookie to the API.

## Troubleshooting

- 302 login goes to Unsplash with `YOUR_UNSPLASH_CLIENT_ID` → Update `.env` with your real `UNSPLASH_CLIENT_ID` and rebuild/restart the API service.
- CORS errors in the browser console → Ensure `ALLOWED_ORIGIN=http://localhost:8080` in `.env`, then rebuild/restart the API.
- `curl http://localhost:3000/api/search?q=mountain` fails → Make sure the API container is up (`docker compose ps`). If you see "Connection refused", start compose again.
- "Empty reply from server" during API calls → Ensure only one response is sent per request. The current server centralizes JSON responses and sets CORS headers once to avoid double-writes.

## Project structure

```
.
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── data/
│       └── server.js
├── docker-compose.yml
├── gallery.css
├── gallery.js
├── index.html
└── README.md
```

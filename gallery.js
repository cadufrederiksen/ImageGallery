// Loads public config, then enables search against the Unsplash API.
// Note: This exposes your public Unsplash Access Key (safe). Do NOT put secrets here.

document.addEventListener('DOMContentLoaded', () => {
	const searchInput = document.getElementById('search');
	const searchBtn = document.getElementById('searchBtn');
	const loginBtn = document.getElementById('loginBtn');
	const logoutBtn = document.getElementById('logoutBtn');
	const favoritesBtn = document.getElementById('favoritesBtn');
	const gallery = document.getElementById('gallery');

	// Resolve API base when using docker-compose (web on 8080, api on 3000)
	const API_BASE = (location.port === '8080')
		? `${location.protocol}//${location.hostname}:3000`
		: 'http://localhost:3000';

	let isAuthed = false;
	let hasWriteLikes = false;

	async function fetchScopes() {
		try {
			const res = await fetch(`${API_BASE}/api/auth/scopes`, { credentials: 'include' });
			if (res.ok) {
				const { scopes } = await res.json();
				hasWriteLikes = typeof scopes === 'string' && scopes.includes('write_likes');
			}
		} catch (_) {
			// ignore
		}
	}

	async function fetchJSON(url, options = {}) {
		const res = await fetch(url, { credentials: 'include', ...options });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}

	async function checkAuth() {
		// Call /api/me without throwing/logging to avoid console 401 noise when logged out
		try {
			const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
			isAuthed = res.ok;
		} catch (_) {
			isAuthed = false;
		}
		loginBtn.style.display = isAuthed ? 'none' : 'inline-block';
		logoutBtn.style.display = isAuthed ? 'inline-block' : 'none';
	}

	async function searchPhotos(query) {
		if (!query) return;
		const url = `${API_BASE}/api/search?q=${encodeURIComponent(query)}`;
		try {
			gallery.innerHTML = 'Loading...';
			const data = await fetchJSON(url);
			renderPhotos(data.results || []);
		} catch (e) {
			console.error(e);
			gallery.textContent = 'Error fetching photos.';
		}
	}

	async function loadRandom(count = 12) {
		try {
			gallery.innerHTML = 'Loading...';
			const data = await fetchJSON(`${API_BASE}/api/random?count=${count}`);
			renderPhotos(data.results || []);
		} catch (e) {
			console.error(e);
			gallery.textContent = 'Error loading random photos.';
		}
	}

	async function showFavorites() {
		if (!isAuthed) {
			window.location.href = `${API_BASE}/api/auth/login`;
			return;
		}
		try {
			gallery.innerHTML = 'Loading favorites...';
			const data = await fetchJSON(`${API_BASE}/api/favorites?per_page=30`);
			renderPhotos(data.results || []);
		} catch (e) {
			console.error(e);
			gallery.textContent = e.message || 'Error loading favorites.';
		}
	}

		function renderPhotos(photos) {
		gallery.innerHTML = '';
		if (!photos.length) {
			gallery.textContent = 'No photos found.';
			return;
		}
			const frag = document.createDocumentFragment();
			photos.forEach(p => {
				const card = document.createElement('div');
				card.style.display = 'inline-block';
				card.style.margin = '6px';
				card.style.textAlign = 'center';

				const a = document.createElement('a');
				a.href = p.links?.html || '#';
				a.target = '_blank'; a.rel = 'noopener noreferrer';

				const img = document.createElement('img');
				img.src = p.urls?.small || p.urls?.thumb || '';
				img.alt = p.alt_description || 'Unsplash photo';
				img.loading = 'lazy';
				img.style.width = '200px';
				img.style.height = 'auto';
				img.style.borderRadius = '6px';

				const likeBtn = document.createElement('button');
				likeBtn.textContent = p.liked_by_user ? 'Unlike' : 'Like';
				likeBtn.style.display = 'block';
				likeBtn.style.marginTop = '6px';
				if (isAuthed && !hasWriteLikes) {
					likeBtn.disabled = true;
					likeBtn.title = 'Favorites require write_likes approval on your Unsplash app.';
				}
				likeBtn.addEventListener('click', async (ev) => {
					ev.preventDefault();
					if (!isAuthed) {
						// redirect to login
						window.location.href = `${API_BASE}/api/auth/login`;
						return;
					}
					if (!hasWriteLikes) {
						alert('Adding favorites requires Unsplash scope "write_likes". Ask the developer to set UNSPLASH_SCOPES="public write_likes" and get the app approved.');
						return;
					}
					try {
						const method = likeBtn.textContent === 'Like' ? 'POST' : 'DELETE';
						const res = await fetch(`${API_BASE}/api/photos/${encodeURIComponent(p.id)}/like`, {
							method,
							credentials: 'include'
						});
						if (!res.ok) {
							let msg = 'Failed to update favorite';
							try {
								const data = await res.json();
								if (data?.error) msg = data.error;
							} catch {}
							if (res.status === 401) msg = 'Please log in again to update favorites.';
							if (res.status === 403) msg = 'Favorites require Unsplash scope "write_likes".';
							throw new Error(msg);
						}
						likeBtn.textContent = method === 'POST' ? 'Unlike' : 'Like';
					} catch (e) {
						console.error(e);
						alert(e.message || 'Failed to update favorite');
					}
				});

				a.appendChild(img);
				card.appendChild(a);
				card.appendChild(likeBtn);
				frag.appendChild(card);
			});
			gallery.appendChild(frag);
	}

	function doSearch() {
		const q = searchInput.value.trim();
		if (q) searchPhotos(q);
	}

			searchBtn.addEventListener('click', doSearch);
	searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

			loginBtn.addEventListener('click', () => {
				window.location.href = `${API_BASE}/api/auth/login`;
			});

			if (favoritesBtn) {
				favoritesBtn.addEventListener('click', showFavorites);
			}

			logoutBtn.addEventListener('click', async () => {
				try {
					await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
				} finally {
					isAuthed = false;
					loginBtn.style.display = 'inline-block';
					logoutBtn.style.display = 'none';
				}
			});

			// initial auth + scopes check
			fetchScopes();
			checkAuth();
			// load random on first render
			loadRandom();
});


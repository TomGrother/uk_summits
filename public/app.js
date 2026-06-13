const API = '/api';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let summits = [];
let markers = new Map();

// Wales bounding box, with a little padding so border summits aren't clipped
const WALES_BOUNDS = L.latLngBounds([51.3, -5.6], [53.5, -2.6]);

const map = L.map('map', {
  maxBounds: WALES_BOUNDS.pad(0.15),
  minZoom: 8,
}).fitBounds(WALES_BOUNDS);

// Esri World Imagery - aerial/satellite tiles of the UK
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 18,
}).addTo(map);

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderAuthArea() {
  const navEl = document.getElementById('navArea');
  const el = document.getElementById('authArea');
  if (currentUser) {
    navEl.innerHTML = `<button class="secondary nav-btn" id="friendsBtn">Friends</button><button class="secondary nav-btn" id="badgesBtn">Badges</button>`
      + (currentUser.isAdmin ? `<button class="secondary nav-btn" id="adminBtn">Admin</button>` : '');
    document.getElementById('friendsBtn').onclick = () => toggleDropdown('friendsDropdown', loadFriends);
    document.getElementById('badgesBtn').onclick = () => toggleDropdown('badgesDropdown', loadMyBadges);
    if (currentUser.isAdmin) {
      document.getElementById('adminBtn').onclick = () => toggleDropdown('adminDropdown', loadAdminPanel);
    }
    el.innerHTML = `<span class="welcome">Hi, ${currentUser.username}</span><button class="secondary" id="logoutBtn">Logout</button>`;
    document.getElementById('logoutBtn').onclick = logout;
  } else {
    navEl.innerHTML = '';
    el.innerHTML = `<button id="loginBtn">Login / Register</button>`;
    document.getElementById('loginBtn').onclick = () => openAuthModal('login');
  }
}

const DROPDOWNS = {
  friendsDropdown: 'friendsBtn',
  badgesDropdown: 'badgesBtn',
  adminDropdown: 'adminBtn',
};

function toggleDropdown(id, onOpen) {
  const dropdown = document.getElementById(id);
  const wasHidden = dropdown.classList.contains('hidden');
  Object.keys(DROPDOWNS).forEach(other => {
    document.getElementById(other).classList.add('hidden');
  });
  if (wasHidden) {
    dropdown.classList.remove('hidden');
    onOpen();
  }
}

document.addEventListener('click', (e) => {
  Object.entries(DROPDOWNS).forEach(([id, btnId]) => {
    const dropdown = document.getElementById(id);
    const btn = document.getElementById(btnId);
    if (!dropdown.contains(e.target) && e.target !== btn) {
      dropdown.classList.add('hidden');
    }
  });
});

function openAuthModal(tab) {
  document.getElementById('welcomeGate').classList.add('hidden');
  document.getElementById('authModal').classList.remove('hidden');
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).click();
}

function renderWelcomeGate() {
  const gate = document.getElementById('welcomeGate');
  if (currentUser) {
    gate.classList.add('hidden');
    return;
  }
  if (sessionStorage.getItem('exploreOnly')) {
    gate.classList.add('hidden');
    return;
  }
  gate.classList.remove('hidden');
}

document.getElementById('welcomeRegister').onclick = () => openAuthModal('register');
document.getElementById('welcomeLogin').onclick = () => openAuthModal('login');
document.getElementById('welcomeExplore').onclick = () => {
  sessionStorage.setItem('exploreOnly', '1');
  document.getElementById('welcomeGate').classList.add('hidden');
};

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('exploreOnly');
  renderAuthArea();
  renderWelcomeGate();
  loadSummits();
}

async function loadSummits() {
  const res = await fetch(`${API}/summits`, { headers: authHeaders() });
  summits = await res.json();
  renderMarkers();
  renderProgress();
  renderRegionList();
  renderBadges();
}

const openRegions = new Set();

function renderRegionList() {
  const el = document.getElementById('regionList');
  const groups = new Map();
  summits.forEach(s => {
    const area = s.area || 'Other';
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(s);
  });

  const sortedAreas = [...groups.keys()].sort();

  el.innerHTML = sortedAreas.map(area => {
    const list = groups.get(area).sort((a, b) => b.height_m - a.height_m);
    const completed = list.filter(s => s.completed).length;
    const isOpen = openRegions.has(area);
    return `
      <div class="region-group">
        <div class="region-header" data-area="${area}">
          <span>${area}</span>
          <span class="region-progress">${completed}/${list.length}</span>
        </div>
        <div class="region-summits ${isOpen ? 'open' : ''}" data-area="${area}">
          ${list.map(s => `
            <div class="region-summit" data-id="${s.id}">
              ${currentUser ? `<input type="checkbox" data-id="${s.id}" ${s.completed ? 'checked' : ''} />` : ''}
              <span class="summit-name">${s.name}</span>
              <span class="summit-height">${s.height_m}m</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.region-header').forEach(header => {
    header.onclick = () => {
      const area = header.dataset.area;
      const body = el.querySelector(`.region-summits[data-area="${area}"]`);
      const willOpen = !body.classList.contains('open');
      body.classList.toggle('open', willOpen);
      if (willOpen) {
        openRegions.add(area);
        zoomToRegion(area);
      } else {
        openRegions.delete(area);
      }
    };
  });

  el.querySelectorAll('.region-summit').forEach(row => {
    const id = Number(row.dataset.id);
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.onclick = (e) => {
        e.stopPropagation();
        toggleCompletion(id);
      };
    }
    row.querySelector('.summit-name').onclick = () => focusSummit(id);
  });
}

function zoomToRegion(area) {
  const list = summits.filter(s => s.area === area);
  if (!list.length) return;
  const bounds = L.latLngBounds(list.map(s => [s.lat, s.lng]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
}

function focusSummit(id) {
  const summit = summits.find(s => s.id === id);
  const marker = markers.get(id);
  if (!summit || !marker) return;
  map.setView([summit.lat, summit.lng], Math.max(map.getZoom(), 12));
  marker.openPopup();
}

async function renderBadges() {
  const el = document.getElementById('badgeStrip');
  if (!currentUser) {
    el.innerHTML = '';
    return;
  }
  const res = await fetch(`${API}/summits/badges`, { headers: authHeaders() });
  const data = await res.json();
  const earned = data.badges.filter(b => b.earned);
  if (!earned.length) {
    el.innerHTML = '<p class="badge-hint">Mark summits as climbed to start earning badges.</p>';
    return;
  }
  el.innerHTML = `
    <h3>Your Badges</h3>
    <div class="badge-icons">
      ${earned.map(b => `<span class="badge" title="${b.label}">${b.icon}</span>`).join('')}
    </div>
  `;
}

async function loadMyBadges() {
  const res = await fetch(`${API}/summits/badges`, { headers: authHeaders() });
  const data = await res.json();
  const el = document.getElementById('myBadges');
  el.innerHTML = `
    <h3>My Badges</h3>
    <div class="badge-grid">
      ${data.badges.map(b => `
        <div class="badge-tile ${b.earned ? 'earned' : 'locked'}" title="${b.label}">
          <span class="badge-tile-icon">${b.icon}</span>
          <span class="badge-tile-label">${b.label}</span>
          <span class="badge-tile-progress">${Math.min(b.progress, b.target)}/${b.target}</span>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadAdminPanel() {
  const el = document.getElementById('adminDropdown');
  const [statsRes, usersRes] = await Promise.all([
    fetch(`${API}/admin/stats`, { headers: authHeaders() }),
    fetch(`${API}/admin/users`, { headers: authHeaders() }),
  ]);
  const stats = await statsRes.json();
  const { users } = await usersRes.json();

  el.innerHTML = `
    <h3>Admin Panel</h3>
    <div class="admin-stats">
      <span>${stats.users} users</span>
      <span>${stats.summits} summits</span>
      <span>${stats.completions} completions</span>
    </div>
    <div class="admin-users">
      ${users.map(u => `
        <div class="friend-row">
          <div class="friend-info">
            <span>${u.username}${u.isAdmin ? ' 👑' : ''}</span>
            <span class="friend-progress">${u.completed} climbed</span>
          </div>
          ${!u.isAdmin ? `<button class="secondary" data-delete-user="${u.id}">Delete</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;

  el.querySelectorAll('[data-delete-user]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Delete this user?')) return;
      await fetch(`${API}/admin/users/${btn.dataset.deleteUser}`, { method: 'DELETE', headers: authHeaders() });
      loadAdminPanel();
    };
  });
}

async function loadFriends() {
  const [friendsRes, requestsRes] = await Promise.all([
    fetch(`${API}/friends`, { headers: authHeaders() }),
    fetch(`${API}/friends/requests`, { headers: authHeaders() }),
  ]);
  const { friends } = await friendsRes.json();
  const { requests } = await requestsRes.json();

  const reqEl = document.getElementById('friendRequests');
  reqEl.innerHTML = requests.length
    ? `<h3>Requests</h3>${requests.map(r => `
        <div class="friend-row">
          <span>${r.username}</span>
          <button data-accept="${r.id}">Accept</button>
          <button class="secondary" data-decline="${r.id}">Decline</button>
        </div>
      `).join('')}`
    : '';

  reqEl.querySelectorAll('[data-accept]').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`${API}/friends/${btn.dataset.accept}/accept`, { method: 'POST', headers: authHeaders() });
      loadFriends();
    };
  });
  reqEl.querySelectorAll('[data-decline]').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`${API}/friends/${btn.dataset.decline}`, { method: 'DELETE', headers: authHeaders() });
      loadFriends();
    };
  });

  const listEl = document.getElementById('friendList');
  listEl.innerHTML = friends.length
    ? `<h3>Your Friends</h3>${friends.map(f => `
        <div class="friend-row friend-card">
          <div class="friend-info">
            <span class="friend-name">${f.username}</span>
            <span class="friend-progress">${f.completed}/${f.total} summits</span>
          </div>
          <div class="badge-icons">
            ${f.badges.map(b => `<span class="badge" title="${b.label}">${b.icon}</span>`).join('')}
          </div>
        </div>
      `).join('')}`
    : '<p class="badge-hint">No friends yet. Add someone by username above.</p>';
}

document.getElementById('addFriendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await fetch(`${API}/friends/request`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: form.get('username') }),
  });
  const data = await res.json();
  const errEl = document.getElementById('friendError');
  if (!res.ok) { errEl.textContent = data.error; return; }
  errEl.textContent = '';
  e.target.reset();
  loadFriends();
});

async function renderProgress() {
  const el = document.getElementById('progress');
  if (!currentUser) {
    el.textContent = 'Login to track which summits you have climbed.';
    return;
  }
  const res = await fetch(`${API}/summits/progress`, { headers: authHeaders() });
  const data = await res.json();
  el.textContent = `${data.completed} / ${data.total} summits completed`;
}

// Small SVG mountain glyph used as a placeholder "photo" for each summit,
// tinted by classification so the popup card feels branded rather than generic.
const CLASS_COLORS = {
  Munro: '#5b7fb5',
  Wainwright: '#7a9b6e',
  Nuttall: '#b58a5b',
  Yorkshire: '#9b6eb5',
  Shropshire: '#b56e7a',
};

function classColor(classification) {
  return CLASS_COLORS[classification] || '#6b7b8c';
}

function summitImage(s) {
  const c = classColor(s.classification);
  return `
    <svg viewBox="0 0 320 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <rect width="320" height="120" fill="${c}" opacity="0.18" />
      <polygon points="0,120 70,40 120,80 180,20 260,90 320,60 320,120" fill="${c}" opacity="0.55" />
      <polygon points="120,80 180,20 240,80" fill="#ffffff" opacity="0.85" />
    </svg>
  `;
}

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers.clear();

  summits.forEach(s => {
    const color = s.completed ? '#2e7d32' : '#c0392b';
    const icon = L.divIcon({
      className: 'summit-marker',
      html: `<div class="summit-pin" style="--pin-color:${color}"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 20],
      popupAnchor: [0, -18],
    });

    const marker = L.marker([s.lat, s.lng], { icon }).addTo(map);

    marker.bindPopup(popupHtml(s), { minWidth: 240, className: 'summit-popup-wrapper' });
    marker.on('popupopen', () => bindPopupActions(s, marker));
    marker.on('mouseover', () => marker.openPopup());
    markers.set(s.id, marker);
  });
}

function popupHtml(s) {
  return `
    <div class="summit-popup">
      <div class="summit-popup-image">${summitImage(s)}</div>
      <div class="summit-popup-body">
        <h3>${s.name}</h3>
        <div class="summit-popup-tags">
          <span class="tag">${s.height_m} m</span>
          <span class="tag">${s.region}</span>
          ${s.classification ? `<span class="tag tag-class">${s.classification}</span>` : ''}
        </div>
        ${currentUser
          ? `<button class="popup-btn ${s.completed ? 'is-done' : ''}" data-action="toggle" data-id="${s.id}">
               ${s.completed ? '✓ Climbed' : 'Mark as climbed'}
             </button>`
          : '<p class="popup-hint">Login to track this summit</p>'}
      </div>
    </div>
  `;
}

function bindPopupActions(s, marker) {
  const btn = document.querySelector(`[data-action="toggle"][data-id="${s.id}"]`);
  if (btn) btn.onclick = () => toggleCompletion(s.id);
}

async function toggleCompletion(id) {
  const summit = summits.find(s => s.id === id);
  if (!summit) return;

  const method = summit.completed ? 'DELETE' : 'POST';
  await fetch(`${API}/summits/${id}/complete`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });

  summit.completed = !summit.completed;
  renderMarkers();
  renderProgress();
  renderRegionList();
  renderBadges();

  const m = markers.get(id);
  if (m) m.openPopup();
}

// --- Auth modal ---
const authModal = document.getElementById('authModal');
document.getElementById('closeAuth').onclick = () => authModal.classList.add('hidden');

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
  };
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
  });
  const data = await res.json();
  const errEl = document.getElementById('loginError');
  if (!res.ok) { errEl.textContent = data.error; return; }
  errEl.textContent = '';
  finishAuth(data);
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: form.get('username'),
      email: form.get('email'),
      password: form.get('password'),
    }),
  });
  const data = await res.json();
  const errEl = document.getElementById('registerError');
  if (!res.ok) { errEl.textContent = data.error; return; }
  errEl.textContent = '';
  finishAuth(data);
});

function finishAuth(data) {
  token = data.token;
  currentUser = data.user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(currentUser));
  authModal.classList.add('hidden');
  renderAuthArea();
  renderWelcomeGate();
  loadSummits();
}

renderAuthArea();
renderWelcomeGate();
loadSummits();

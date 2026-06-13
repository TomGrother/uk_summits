const API = '/api';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let summits = [];
let markers = new Map();

const map = L.map('map').setView([54.5, -3.5], 6);

// Esri World Imagery - aerial/satellite tiles of the UK
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 18,
}).addTo(map);

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (currentUser) {
    el.innerHTML = `<span class="welcome">Hi, ${currentUser.username}</span><button class="secondary" id="logoutBtn">Logout</button>`;
    document.getElementById('logoutBtn').onclick = logout;
  } else {
    el.innerHTML = `<button id="loginBtn">Login / Register</button>`;
    document.getElementById('loginBtn').onclick = () => document.getElementById('authModal').classList.remove('hidden');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  renderAuthArea();
  loadSummits();
}

async function loadSummits() {
  const res = await fetch(`${API}/summits`, { headers: authHeaders() });
  summits = await res.json();
  renderMarkers();
  renderProgress();
}

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
  loadSummits();
}

renderAuthArea();
loadSummits();

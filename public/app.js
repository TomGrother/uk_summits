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

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers.clear();

  summits.forEach(s => {
    const color = s.completed ? '#2e7d32' : '#d32f2f';
    const marker = L.circleMarker([s.lat, s.lng], {
      radius: 6,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 1,
    }).addTo(map);

    marker.bindPopup(popupHtml(s));
    marker.on('popupopen', () => bindPopupActions(s, marker));
    markers.set(s.id, marker);
  });
}

function popupHtml(s) {
  return `
    <strong>${s.name}</strong><br/>
    ${s.region} &middot; ${s.height_m} m${s.classification ? ` &middot; ${s.classification}` : ''}<br/>
    ${currentUser
      ? `<button data-action="toggle" data-id="${s.id}">${s.completed ? 'Mark as not climbed' : 'Mark as climbed'}</button>`
      : '<em>Login to track this summit</em>'}
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

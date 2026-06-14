function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const API = '/api';
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let summits = [];
let markers = new Map();

// Bounding box covering the whole of the UK, with a little padding
// so border summits aren't clipped
const MAP_BOUNDS = L.latLngBounds([49.8, -8.7], [60.9, 1.8]);
const INITIAL_BOUNDS = L.latLngBounds([51.3, -5.6], [55.1, -2.6]);

const map = L.map('map', {
  maxBounds: MAP_BOUNDS.pad(0.15),
  maxBoundsViscosity: 1.0,
  minZoom: 5,
  tap: true,
  zoomSnap: 1,
  wheelDebounceTime: 60,
  fadeAnimation: false,
  markerZoomAnimation: false,
}).fitBounds(INITIAL_BOUNDS);

// Esri World Imagery - aerial/satellite tiles of the UK
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri',
  maxZoom: 18,
  detectRetina: true,
  updateWhenZooming: false,
  keepBuffer: 2,
}).addTo(map);

const markerCluster = L.markerClusterGroup({
  maxClusterRadius: 50,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 13,
}).addTo(map);

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderAuthArea() {
  const navEl = document.getElementById('navArea');
  const el = document.getElementById('authArea');
  if (currentUser) {
    navEl.innerHTML = '';
    el.innerHTML = `<button class="secondary nav-btn" id="accountBtn">My Account &#9662;</button>`;
    document.getElementById('accountBtn').onclick = () => toggleDropdown('accountMenu', renderAccountMenu);
  } else {
    navEl.innerHTML = '';
    el.innerHTML = `<button id="loginBtn">Login / Register</button>`;
    document.getElementById('loginBtn').onclick = () => openAuthModal('login');
  }
}

function renderAccountMenu() {
  const list = document.getElementById('accountMenuList');
  list.innerHTML = `
    <button class="account-menu-item" id="menuBadges" data-opens-dropdown>🏆 Badges</button>
    <button class="account-menu-item" id="menuMyPhotos">📷 My Photos</button>
    ${currentUser.isAdmin ? `<button class="account-menu-item" id="menuAdmin">⚙️ Admin</button>` : ''}
    <button class="account-menu-item" id="menuLogout">🚪 Logout</button>
  `;
  document.getElementById('menuBadges').onclick = () => toggleDropdown('badgesDropdown', loadMyBadges);
  document.getElementById('menuMyPhotos').onclick = () => {
    document.getElementById('accountMenu').classList.add('hidden');
    openMyPhotos();
  };
  if (currentUser.isAdmin) {
    document.getElementById('menuAdmin').onclick = () => {
      document.getElementById('accountMenu').classList.add('hidden');
      openAdminPanel();
    };
  }
  document.getElementById('menuLogout').onclick = logout;
}

const DROPDOWNS = {
  accountMenu: 'accountBtn',
  badgesDropdown: 'accountBtn',
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
  if (e.target.closest('[data-opens-dropdown]')) return;
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
  gate.classList.remove('hidden');
}

document.getElementById('welcomeRegister').onclick = () => openAuthModal('register');
document.getElementById('welcomeLogin').onclick = () => openAuthModal('login');

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
}

const openRegions = new Set();
const openClassifications = new Set();
let summitSearchTerm = '';

const CLASSIFICATION_GROUPS = {
  Nuttall: 'Welsh Nuttalls',
  Wainwright: 'Lake District Wainwrights',
  Munro: 'Scottish Munros',
  'Peak District': 'Peak District Hills',
  'Yorkshire Dales': 'Yorkshire Dales Peaks',
  Shropshire: 'Shropshire Hills',
};

function renderRegionList() {
  const el = document.getElementById('regionList');
  const term = summitSearchTerm.trim().toLowerCase();
  const searching = term.length > 0;

  const classGroups = new Map();
  summits.forEach(s => {
    if (searching && !s.name.toLowerCase().includes(term) && !(s.alt_name || '').toLowerCase().includes(term)) return;
    const className = CLASSIFICATION_GROUPS[s.classification] || s.classification || 'Other';
    const area = s.area || 'Other';
    if (!classGroups.has(className)) classGroups.set(className, new Map());
    const areaGroups = classGroups.get(className);
    if (!areaGroups.has(area)) areaGroups.set(area, []);
    areaGroups.get(area).push(s);
  });

  const sortedClasses = [...classGroups.keys()].sort();

  if (searching && sortedClasses.length === 0) {
    el.innerHTML = '<p class="search-empty">No summits match your search.</p>';
    return;
  }

  el.innerHTML = sortedClasses.map(className => {
    const areaGroups = classGroups.get(className);
    const sortedAreas = [...areaGroups.keys()].sort();
    const allSummits = sortedAreas.flatMap(area => areaGroups.get(area));
    const completed = allSummits.filter(s => s.completed).length;
    const classOpen = searching || openClassifications.has(className);

    return `
      <div class="classification-group">
        <div class="classification-header" data-class="${className}">
          <span>${className}</span>
          <span class="region-progress">${completed}/${allSummits.length}</span>
        </div>
        <div class="classification-areas ${classOpen ? 'open' : ''}" data-class="${className}">
          ${sortedAreas.length === 1 ? (() => {
            const list = areaGroups.get(sortedAreas[0]).sort((a, b) => b.height_m - a.height_m);
            return `
              <div class="region-summits open" data-area="${sortedAreas[0]}">
                ${list.map(s => `
                  <div class="region-summit" data-id="${s.id}">
                    ${currentUser ? `<input type="checkbox" data-id="${s.id}" ${s.completed ? 'checked' : ''} />` : ''}
                    <span class="summit-name">${s.name}${s.alt_name ? ` <span class="alt-name">(${s.alt_name})</span>` : ''}</span>
                    <span class="summit-height">${s.height_m}m</span>
                    <button class="zoom-to-btn" data-zoom-id="${s.id}">Zoom to</button>
                  </div>
                `).join('')}
              </div>
            `;
          })() : sortedAreas.map(area => {
            const list = areaGroups.get(area).sort((a, b) => b.height_m - a.height_m);
            const areaCompleted = list.filter(s => s.completed).length;
            const isOpen = searching || openRegions.has(area);
            return `
              <div class="region-group">
                <div class="region-header" data-area="${area}">
                  <span>${area}</span>
                  <span class="region-progress">${areaCompleted}/${list.length}</span>
                </div>
                <div class="region-summits ${isOpen ? 'open' : ''}" data-area="${area}">
                  ${list.map(s => `
                    <div class="region-summit" data-id="${s.id}">
                      ${currentUser ? `<input type="checkbox" data-id="${s.id}" ${s.completed ? 'checked' : ''} />` : ''}
                      <span class="summit-name">${s.name}${s.alt_name ? ` <span class="alt-name">(${s.alt_name})</span>` : ''}</span>
                      <span class="summit-height">${s.height_m}m</span>
                      <button class="zoom-to-btn" data-zoom-id="${s.id}">Zoom to</button>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  el.querySelectorAll('.classification-header').forEach(header => {
    header.onclick = () => {
      const className = header.dataset.class;
      const body = el.querySelector(`.classification-areas[data-class="${className}"]`);
      const willOpen = !body.classList.contains('open');
      body.classList.toggle('open', willOpen);
      if (willOpen) {
        openClassifications.add(className);
      } else {
        openClassifications.delete(className);
      }
    };
  });

  el.querySelectorAll('.region-header').forEach(header => {
    header.onclick = (e) => {
      e.stopPropagation();
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
    row.querySelector('.zoom-to-btn').onclick = (e) => {
      e.stopPropagation();
      focusSummit(id);
    };
  });
}

let locationMarker = null;
document.getElementById('locateBtn').onclick = () => {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  const btn = document.getElementById('locateBtn');
  btn.classList.add('locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.classList.remove('locating');
      const { latitude, longitude } = pos.coords;
      if (locationMarker) map.removeLayer(locationMarker);
      locationMarker = L.circleMarker([latitude, longitude], {
        radius: 8,
        color: '#fff',
        weight: 2,
        fillColor: '#1a73e8',
        fillOpacity: 1,
      }).addTo(map);
      map.setView([latitude, longitude], Math.max(map.getZoom(), 12));
    },
    () => {
      btn.classList.remove('locating');
      alert('Unable to retrieve your location. Please check location permissions.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

document.getElementById('sidebarToggle').onclick = () => {
  document.getElementById('sidebar').classList.toggle('open');
};

document.getElementById('footerAbout').onclick = () => document.getElementById('aboutModal').classList.remove('hidden');
document.getElementById('footerFaq').onclick = () => document.getElementById('faqModal').classList.remove('hidden');
document.getElementById('footerSitemap').onclick = () => document.getElementById('sitemapModal').classList.remove('hidden');
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.onclick = () => document.getElementById(btn.dataset.closeModal).classList.add('hidden');
});

document.getElementById('summitSearch').oninput = (e) => {
  summitSearchTerm = e.target.value;
  renderRegionList();
};

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
  markerCluster.zoomToShowLayer(marker, () => marker.openPopup());
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    setTimeout(() => map.invalidateSize(), 250);
  }
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

let adminUsers = [];
let adminSelectedUserId = null;

function openAdminPanel() {
  document.getElementById('adminModal').classList.remove('hidden');
  loadAdminPanel();
}

async function loadAdminPanel() {
  const [statsRes, usersRes] = await Promise.all([
    fetch(`${API}/admin/stats`, { headers: authHeaders() }),
    fetch(`${API}/admin/users`, { headers: authHeaders() }),
  ]);
  const stats = await statsRes.json();
  ({ users: adminUsers } = await usersRes.json());
  adminSelectedUserId = null;

  renderAdminStats(stats);
  renderAdminUserList('');
}

function renderAdminStats(stats) {
  const el = document.getElementById('adminDropdown');
  el.innerHTML = `
    <div class="admin-stats">
      <span>${stats.users} users</span>
      <span>${stats.summits} summits</span>
      <span>${stats.completions} completions</span>
    </div>
    <div id="adminBody"></div>
  `;
}

function renderAdminUserList(filter) {
  const body = document.getElementById('adminBody');
  const term = filter.trim().toLowerCase();
  const filtered = term
    ? adminUsers.filter(u => u.username.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
    : adminUsers;

  body.innerHTML = `
    <div class="admin-search">
      <input type="text" id="adminUserSearch" placeholder="Search users..." value="${escapeHtml(filter)}" />
    </div>
    <div class="admin-users">
      ${filtered.length ? filtered.map(u => `
        <button class="admin-user-row" data-select-user="${u.id}">
          <span class="admin-user-name">${escapeHtml(u.username)}${u.isAdmin ? ' 👑' : ''}</span>
          <span class="admin-user-progress">${u.completed} climbed</span>
        </button>
      `).join('') : '<p class="search-empty">No users found.</p>'}
    </div>
  `;

  const search = document.getElementById('adminUserSearch');
  search.focus();
  search.setSelectionRange(filter.length, filter.length);
  search.oninput = () => renderAdminUserList(search.value);

  body.querySelectorAll('[data-select-user]').forEach(btn => {
    btn.onclick = () => {
      adminSelectedUserId = Number(btn.dataset.selectUser);
      renderAdminUserEdit();
    };
  });
}

function renderAdminUserEdit() {
  const body = document.getElementById('adminBody');
  const u = adminUsers.find(x => x.id === adminSelectedUserId);
  if (!u) return;

  body.innerHTML = `
    <button class="link-btn admin-back-btn" data-back>&larr; Back to users</button>
    <div class="admin-user-edit" data-edit="${u.id}">
      <label>Username
        <input type="text" name="username" value="${escapeHtml(u.username)}" />
      </label>
      <label>Email
        <input type="email" name="email" value="${escapeHtml(u.email)}" />
      </label>
      <label class="admin-checkbox">
        <input type="checkbox" name="isAdmin" ${u.isAdmin ? 'checked' : ''} ${u.id === currentUser.id ? 'disabled' : ''} />
        Admin
      </label>
      <label>New password <span class="hint-inline">(leave blank to keep current)</span>
        <input type="password" name="password" placeholder="••••••••" />
      </label>
      <p class="error" data-error="${u.id}"></p>
      <div class="admin-edit-actions">
        <button type="button" class="popup-btn" data-save-user="${u.id}">Save changes</button>
        ${!u.isAdmin ? `<button class="secondary" data-delete-user="${u.id}">Delete user</button>` : ''}
      </div>
    </div>
  `;

  body.querySelector('[data-back]').onclick = () => renderAdminUserList('');

  body.querySelector('[data-save-user]').onclick = async () => {
    const editEl = body.querySelector(`[data-edit="${u.id}"]`);
    const errEl = body.querySelector(`[data-error="${u.id}"]`);
    const payload = {
      username: editEl.querySelector('[name="username"]').value.trim(),
      email: editEl.querySelector('[name="email"]').value.trim(),
      isAdmin: editEl.querySelector('[name="isAdmin"]').checked,
    };
    const password = editEl.querySelector('[name="password"]').value;
    if (password) payload.password = password;

    const res = await fetch(`${API}/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error; return; }
    errEl.textContent = '';
    await loadAdminPanel();
  };

  const deleteBtn = body.querySelector('[data-delete-user]');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm('Delete this user?')) return;
      await fetch(`${API}/admin/users/${u.id}`, { method: 'DELETE', headers: authHeaders() });
      await loadAdminPanel();
    };
  }
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
  'Peak District': '#c9a13b',
  'Yorkshire Dales': '#5ba38a',
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

function iconFor(s) {
  const color = s.completed ? '#2e7d32' : '#c0392b';
  return L.divIcon({
    className: 'summit-marker',
    html: `<div class="summit-pin" style="--pin-color:${color}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 20],
    popupAnchor: [0, -18],
  });
}

function renderMarkers() {
  markerCluster.clearLayers();
  markers.clear();

  summits.forEach(s => {
    const marker = L.marker([s.lat, s.lng], { icon: iconFor(s) });

    marker.bindPopup(popupHtml(s), { minWidth: 240, className: 'summit-popup-wrapper' });
    marker.on('popupopen', () => bindPopupActions(s, marker));
    marker.on('mouseover', () => marker.openPopup());
    markers.set(s.id, marker);
    markerCluster.addLayer(marker);
  });
}

// Updates a single marker in place (icon colour + popup content) instead of
// re-rendering all markers, which is expensive on mobile.
function updateMarker(id) {
  const summit = summits.find(s => s.id === id);
  const marker = markers.get(id);
  if (!summit || !marker) return;

  marker.setIcon(iconFor(summit));
  marker.setPopupContent(popupHtml(summit));
  bindPopupActions(summit, marker);
}

function popupHtml(s) {
  return `
    <div class="summit-popup">
      <div class="summit-popup-image">${s.image ? `<img src="${s.image}" alt="${s.name}" loading="lazy" />` : summitImage(s)}</div>
      <div class="summit-popup-body">
        <h3>${s.name}${s.alt_name ? ` <span class="alt-name">(${s.alt_name})</span>` : ''}</h3>
        ${s.wiki ? `<a class="wiki-link" href="${s.wiki}" target="_blank" rel="noopener">Wikipedia &rarr;</a>` : ''}
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
        <div class="summit-gallery" data-gallery="${s.id}">
          <p class="gallery-loading">Loading photos&hellip;</p>
        </div>
        ${currentUser ? `
          <label class="popup-upload-btn">
            📷 Add a photo
            <input type="file" accept="image/*" data-upload="${s.id}" hidden />
          </label>
        ` : ''}
        <div class="summit-reviews-summary" data-reviews="${s.id}">
          <p class="reviews-loading">Loading reviews&hellip;</p>
        </div>
      </div>
    </div>
  `;
}

function starString(rating) {
  return '★★★★★☆☆☆☆☆'.slice(5 - rating, 10 - rating);
}

function bindPopupActions(s, marker) {
  const btn = document.querySelector(`[data-action="toggle"][data-id="${s.id}"]`);
  if (btn) btn.onclick = () => toggleCompletion(s.id);

  loadGallery(s.id);
  loadReviews(s.id);

  const fileInput = document.querySelector(`[data-upload="${s.id}"]`);
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${API}/summits/${s.id}/images`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });
      if (res.ok) {
        loadGallery(s.id);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Upload failed');
      }
      fileInput.value = '';
    };
  }
}

async function loadGallery(summitId) {
  const el = document.querySelector(`[data-gallery="${summitId}"]`);
  if (!el) return;
  const res = await fetch(`${API}/summits/${summitId}/images`, { headers: authHeaders() });
  const data = await res.json();
  if (!el.isConnected) return;

  if (!data.images.length) {
    el.innerHTML = '<p class="gallery-empty">No photos yet &mdash; be the first to add one!</p>';
    return;
  }

  const PREVIEW_COUNT = 4;
  const preview = data.images.slice(0, PREVIEW_COUNT);

  el.innerHTML = `
    <div class="gallery-grid">
      ${preview.map(img => `
        <button class="gallery-thumb" data-lightbox-src="${img.url}" data-lightbox-by="${escapeHtml(img.username)}" title="By ${escapeHtml(img.username)}">
          <img src="${img.url}" alt="Photo by ${escapeHtml(img.username)}" loading="lazy" />
        </button>
      `).join('')}
    </div>
    ${data.images.length > PREVIEW_COUNT ? `<button class="gallery-view-all" data-view-all="${summitId}">View all ${data.images.length} photos</button>` : ''}
  `;

  el.querySelectorAll('.gallery-thumb').forEach((btn, i) => {
    btn.onclick = () => openLightbox(data.images, i);
  });

  const viewAllBtn = el.querySelector('.gallery-view-all');
  if (viewAllBtn) {
    viewAllBtn.onclick = () => openFullGallery(data.images);
  }
}

function renderReviewRow(r) {
  return `
    <div class="review-row">
      <div class="review-row-head">
        <span class="review-stars">${starString(r.rating)}</span>
        <span class="review-author">${escapeHtml(r.username)}</span>
      </div>
      ${r.body ? `<p class="review-body">${escapeHtml(r.body)}</p>` : ''}
    </div>
  `;
}

function openFullReviews(summit, reviews) {
  document.getElementById('fullReviewsTitle').textContent = summit ? `Reviews for ${summit.name}` : 'Reviews';

  const myReview = currentUser ? reviews.find(r => r.username === currentUser.username) : null;
  const others = reviews.filter(r => r !== myReview);

  document.getElementById('fullReviewsList').innerHTML = `
    ${currentUser ? `
      <form class="review-form" data-review-form="${summit.id}">
        <select name="rating">
          ${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${myReview && myReview.rating === n ? 'selected' : ''}>${starString(n)}</option>`).join('')}
        </select>
        <textarea name="body" placeholder="Share your thoughts on this summit..." maxlength="1000">${myReview ? escapeHtml(myReview.body) : ''}</textarea>
        <div class="review-form-actions">
          <button type="submit" class="popup-btn">${myReview ? 'Update review' : 'Post review'}</button>
          ${myReview ? '<button type="button" class="review-delete-btn" data-delete-review>Delete</button>' : ''}
        </div>
      </form>
    ` : ''}
    ${myReview ? renderReviewRow(myReview) : ''}
    ${others.length ? others.map(renderReviewRow).join('') : (myReview ? '' : '<p class="reviews-empty">No reviews yet &mdash; be the first to share your experience!</p>')}
  `;

  const form = document.querySelector('#fullReviewsList [data-review-form]');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      await fetch(`${API}/summits/${summit.id}/reviews`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: Number(formData.get('rating')), body: formData.get('body') }),
      });
      const res = await fetch(`${API}/summits/${summit.id}/reviews`);
      const data = await res.json();
      openFullReviews(summit, data.reviews || []);
      loadReviews(summit.id);
    };
  }

  const deleteBtn = document.querySelector('#fullReviewsList [data-delete-review]');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      await fetch(`${API}/summits/${summit.id}/reviews`, { method: 'DELETE', headers: authHeaders() });
      const res = await fetch(`${API}/summits/${summit.id}/reviews`);
      const data = await res.json();
      openFullReviews(summit, data.reviews || []);
      loadReviews(summit.id);
    };
  }

  document.getElementById('fullReviewsModal').classList.remove('hidden');
}

async function loadReviews(summitId) {
  const el = document.querySelector(`[data-reviews="${summitId}"]`);
  if (!el) return;
  const res = await fetch(`${API}/summits/${summitId}/reviews`);
  const data = await res.json();
  if (!el.isConnected) return;

  const reviews = data.reviews || [];
  const avg = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : null;

  el.innerHTML = `
    <div class="reviews-summary-row">
      ${avg
        ? `<span class="reviews-avg">${starString(Math.round(avg))} ${avg} <span class="reviews-count">(${reviews.length})</span></span>`
        : `<span class="reviews-avg reviews-none">No reviews yet</span>`}
      <button class="read-reviews-btn" data-read-reviews="${summitId}">Read reviews</button>
    </div>
  `;

  el.querySelector('[data-read-reviews]').onclick = () => openFullReviews(summits.find(s => s.id === summitId), reviews);
}

function openFullGallery(images) {
  const grid = document.getElementById('fullGalleryGrid');
  grid.innerHTML = images.map(img => `
    <button class="gallery-thumb" title="By ${escapeHtml(img.username)}">
      <img src="${img.url}" alt="Photo by ${escapeHtml(img.username)}" loading="lazy" />
    </button>
  `).join('');
  grid.querySelectorAll('.gallery-thumb').forEach((btn, i) => {
    btn.onclick = () => openLightbox(images, i);
  });
  document.getElementById('fullGalleryModal').classList.remove('hidden');
}

let myPhotosBySummit = [];

async function openMyPhotos() {
  const grid = document.getElementById('myPhotosGrid');
  const title = document.getElementById('myPhotosTitle');
  const backBtn = document.getElementById('myPhotosBack');
  title.textContent = 'My Photos';
  backBtn.classList.add('hidden');
  grid.innerHTML = '<p>Loading...</p>';
  document.getElementById('myPhotosModal').classList.remove('hidden');

  const res = await fetch('/api/summits/my-images', { headers: authHeaders() });
  const { images } = await res.json();

  if (!images.length) {
    grid.innerHTML = '<p>You haven\'t uploaded any photos yet. Add one from a summit popup on the map!</p>';
    return;
  }

  const bySummit = new Map();
  images.forEach(img => {
    if (!bySummit.has(img.summit_id)) {
      const summit = summits.find(s => s.id === img.summit_id);
      bySummit.set(img.summit_id, {
        summit_id: img.summit_id,
        summit_name: img.summit_name,
        classification: summit ? summit.classification : null,
        area: summit ? summit.area : null,
        height_m: summit ? summit.height_m : null,
        images: [],
      });
    }
    bySummit.get(img.summit_id).images.push(img);
  });
  myPhotosBySummit = [...bySummit.values()].sort((a, b) => a.summit_name.localeCompare(b.summit_name));

  renderMyPhotosTiles();
}

function renderMyPhotosTiles() {
  const grid = document.getElementById('myPhotosGrid');
  const title = document.getElementById('myPhotosTitle');
  const backBtn = document.getElementById('myPhotosBack');
  title.textContent = `My Photos (${myPhotosBySummit.length} summit${myPhotosBySummit.length === 1 ? '' : 's'})`;
  backBtn.classList.add('hidden');
  grid.classList.add('my-photos-summit-grid');

  grid.innerHTML = myPhotosBySummit.map((entry, i) => {
    const color = CLASS_COLORS[entry.classification] || '#888';
    return `
      <button class="my-photo-card" data-summit-tile="${i}">
        <div class="my-photo-card-img">
          <img src="${entry.images[0].url}" alt="Photos at ${entry.summit_name}" loading="lazy" />
          <span class="my-photo-count">${entry.images.length} photo${entry.images.length === 1 ? '' : 's'}</span>
        </div>
        <div class="my-photo-card-body">
          <strong class="my-photo-name">${entry.summit_name}</strong>
          <div class="my-photo-tags">
            ${entry.classification ? `<span class="tag tag-class" style="background:${color}">${entry.classification}</span>` : ''}
            ${entry.height_m ? `<span class="tag">${entry.height_m} m</span>` : ''}
          </div>
          ${entry.area ? `<span class="my-photo-area">${entry.area}</span>` : ''}
        </div>
      </button>
    `;
  }).join('');
  grid.querySelectorAll('[data-summit-tile]').forEach(btn => {
    btn.onclick = () => renderMyPhotosSummit(myPhotosBySummit[Number(btn.dataset.summitTile)]);
  });
}

function renderMyPhotosSummit(entry) {
  const grid = document.getElementById('myPhotosGrid');
  const title = document.getElementById('myPhotosTitle');
  const backBtn = document.getElementById('myPhotosBack');
  const color = CLASS_COLORS[entry.classification] || '#888';
  title.innerHTML = `${entry.summit_name} `
    + (entry.classification ? `<span class="tag tag-class" style="background:${color}">${entry.classification}</span>` : '')
    + (entry.height_m ? ` <span class="tag">${entry.height_m} m</span>` : '');
  backBtn.classList.remove('hidden');
  grid.classList.remove('my-photos-summit-grid');

  grid.innerHTML = entry.images.map(img => `
    <div class="my-photo-tile">
      <button class="gallery-thumb my-photo-thumb">
        <img src="${img.url}" alt="Photo at ${entry.summit_name}" loading="lazy" />
      </button>
      <button class="my-photo-delete" data-delete-image="${img.id}" title="Delete photo" aria-label="Delete photo">&times;</button>
    </div>
  `).join('')
  + `<button class="secondary my-photo-zoom" data-zoom-summit="${entry.summit_id}">📍 Show on map</button>`;

  grid.querySelectorAll('.my-photo-thumb').forEach((btn, i) => {
    btn.onclick = () => openLightbox(entry.images, i);
  });
  grid.querySelectorAll('[data-delete-image]').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this photo? This cannot be undone.')) return;
      const imageId = btn.dataset.deleteImage;
      const res = await fetch(`${API}/summits/images/${imageId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) { alert('Failed to delete photo.'); return; }
      entry.images = entry.images.filter(img => String(img.id) !== String(imageId));
      if (!entry.images.length) {
        myPhotosBySummit = myPhotosBySummit.filter(e2 => e2.summit_id !== entry.summit_id);
        renderMyPhotosTiles();
      } else {
        renderMyPhotosSummit(entry);
      }
    };
  });
  grid.querySelector('[data-zoom-summit]').onclick = () => {
    document.getElementById('myPhotosModal').classList.add('hidden');
    focusSummit(entry.summit_id);
  };
}

document.getElementById('myPhotosBack').onclick = () => renderMyPhotosTiles();

let lightboxImages = [];
let lightboxIndex = 0;

function openLightbox(images, index) {
  lightboxImages = images;
  lightboxIndex = index;
  renderLightbox();
  document.getElementById('lightboxModal').classList.remove('hidden');
}

function renderLightbox() {
  const img = lightboxImages[lightboxIndex];
  document.getElementById('lightboxImage').src = img.url;
  document.getElementById('lightboxCaption').textContent = img.summit_name
    ? `${img.summit_name} (${lightboxIndex + 1}/${lightboxImages.length})`
    : `Photo by ${img.username} (${lightboxIndex + 1}/${lightboxImages.length})`;
  const multi = lightboxImages.length > 1;
  document.getElementById('lightboxPrev').classList.toggle('hidden', !multi);
  document.getElementById('lightboxNext').classList.toggle('hidden', !multi);
}

function lightboxStep(delta) {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
  renderLightbox();
}

document.getElementById('lightboxModal').addEventListener('click', (e) => {
  if (e.target.id === 'lightboxModal') {
    document.getElementById('lightboxModal').classList.add('hidden');
  }
});

document.getElementById('lightboxPrev').onclick = () => lightboxStep(-1);
document.getElementById('lightboxNext').onclick = () => lightboxStep(1);
document.addEventListener('keydown', (e) => {
  if (document.getElementById('lightboxModal').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') lightboxStep(-1);
  if (e.key === 'ArrowRight') lightboxStep(1);
});

async function toggleCompletion(id) {
  const summit = summits.find(s => s.id === id);
  if (!summit) return;

  const method = summit.completed ? 'DELETE' : 'POST';
  await fetch(`${API}/summits/${id}/complete`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });

  summit.completed = !summit.completed;
  updateMarker(id);
  renderProgress();
  renderRegionList();

  const m = markers.get(id);
  if (m) markerCluster.zoomToShowLayer(m, () => m.openPopup());
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
    document.getElementById('forgotForm').classList.add('hidden');
  };
});

document.getElementById('showForgotPassword').onclick = () => {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('forgotForm').classList.remove('hidden');
  document.getElementById('forgotSuccess').classList.add('hidden');
  document.getElementById('forgotError').textContent = '';
};

document.getElementById('backToLogin').onclick = () => {
  document.getElementById('forgotForm').classList.add('hidden');
  document.querySelector('.tab-btn[data-tab="login"]').click();
};

document.getElementById('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = document.getElementById('forgotError');
  const successEl = document.getElementById('forgotSuccess');
  errEl.textContent = '';
  try {
    await fetch(`${API}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email') }),
    });
  } catch {}
  successEl.classList.remove('hidden');
  e.target.reset();
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

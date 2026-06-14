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

function authHeaders() {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function renderAuthArea() {
  const navEl = document.getElementById('navArea');
  const el = document.getElementById('authArea');
  if (currentUser) {
    navEl.innerHTML = `<button class="secondary nav-btn" id="badgesBtn">Badges</button>`
      + (currentUser.isAdmin ? `<button class="secondary nav-btn" id="adminBtn">Admin</button>` : '');
    document.getElementById('badgesBtn').onclick = () => toggleDropdown('badgesDropdown', loadMyBadges);
    if (currentUser.isAdmin) {
      document.getElementById('adminBtn').onclick = () => openAdminPanel();
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
  badgesDropdown: 'badgesBtn',
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
          ${sortedAreas.map(area => {
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
  marker.openPopup();
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
      <input type="text" id="adminUserSearch" placeholder="Search users..." value="${filter}" />
    </div>
    <div class="admin-users">
      ${filtered.length ? filtered.map(u => `
        <button class="admin-user-row" data-select-user="${u.id}">
          <span class="admin-user-name">${u.username}${u.isAdmin ? ' 👑' : ''}</span>
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
        <input type="text" name="username" value="${u.username}" />
      </label>
      <label>Email
        <input type="email" name="email" value="${u.email}" />
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
  markers.forEach(m => map.removeLayer(m));
  markers.clear();

  summits.forEach(s => {
    const marker = L.marker([s.lat, s.lng], { icon: iconFor(s) }).addTo(map);

    marker.bindPopup(popupHtml(s), { minWidth: 240, className: 'summit-popup-wrapper' });
    marker.on('popupopen', () => bindPopupActions(s, marker));
    marker.on('mouseover', () => marker.openPopup());
    markers.set(s.id, marker);
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
        <button class="gallery-thumb" data-lightbox-src="${img.url}" data-lightbox-by="${img.username}" title="By ${img.username}">
          <img src="${img.url}" alt="Photo by ${img.username}" loading="lazy" />
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
        <span class="review-author">${r.username}</span>
      </div>
      ${r.body ? `<p class="review-body">${r.body}</p>` : ''}
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
        <textarea name="body" placeholder="Share your thoughts on this summit..." maxlength="1000">${myReview ? myReview.body : ''}</textarea>
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
    <button class="gallery-thumb" title="By ${img.username}">
      <img src="${img.url}" alt="Photo by ${img.username}" loading="lazy" />
    </button>
  `).join('');
  grid.querySelectorAll('.gallery-thumb').forEach((btn, i) => {
    btn.onclick = () => openLightbox(images, i);
  });
  document.getElementById('fullGalleryModal').classList.remove('hidden');
}

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
  document.getElementById('lightboxCaption').textContent = `Photo by ${img.username} (${lightboxIndex + 1}/${lightboxImages.length})`;
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

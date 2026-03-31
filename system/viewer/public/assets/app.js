/**
 * KAV (KidsNote Archive Viewer) - Frontend App Logic
 * Vanilla JS | Lazy Loading | Infinite Scroll | Dual Theme
 */

// ─── State ──────────────────────────────────────────────────────────
const state = {
  type: 'report',          // 'report' | 'album'
  page: 1,
  limit: 20,
  hasNext: false,
  total: 0,
  filter: 'all',           // 'all' | 'YYYY-MM'
  query: '',
  isLoading: false,
  items: [],
  monthlyStats: {},

  // Lightbox
  lightboxPhotos: [],
  lightboxIndex: 0,
};

// ─── DOM Refs ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const dom = {
  cardGrid: $('card-grid'),
  loadMoreWrap: $('load-more-wrap'),
  loadMoreBtn: $('load-more-btn'),
  emptyState: $('empty-state'),
  totalCount: $('total-count'),
  filterChips: $('filter-chips'),
  themeToggle: $('theme-toggle'),
  searchInput: $('search-input'),
  modalOverlay: $('modal-overlay'),
  detailModal: $('detail-modal'),
  modalBody: $('modal-body'),
  modalClose: $('modal-close'),
  lightboxOverlay: $('lightbox-overlay'),
  lightboxImg: $('lightbox-img'),
  lightboxClose: $('lightbox-close'),
  lightboxPrev: $('lightbox-prev'),
  lightboxNext: $('lightbox-next'),
  lightboxCounter: $('lightbox-counter'),
  globalLoader: $('global-loader'),
  navReport: $('nav-report'),
  navAlbum: $('nav-album'),
};

// ─── Theme ──────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('kav-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kav-theme', next);
}

// ─── API ─────────────────────────────────────────────────────────────
async function fetchItems(reset = false) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (reset) {
    state.page = 1;
    state.items = [];
    dom.cardGrid.innerHTML = '';
    dom.loadMoreWrap.style.display = 'none';
  }

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
  });

  if (state.filter !== 'all') {
    const [year, month] = state.filter.split('-');
    if (year) params.set('year', year);
    if (month) params.set('month', month);
  }

  if (state.query) params.set('q', state.query);

  const endpoint = state.type === 'album' ? '/api/albums' : '/api/reports';

  try {
    const res = await fetch(`${endpoint}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    state.total = data.total;
    state.hasNext = data.hasNext;
    state.items.push(...data.items);

    dom.totalCount.textContent = data.total.toLocaleString();
    renderCards(data.items, reset);

    dom.loadMoreWrap.style.display = state.hasNext ? 'block' : 'none';
    dom.emptyState.style.display = state.items.length === 0 ? 'flex' : 'none';
    dom.emptyState.style.flexDirection = 'column';

    state.page++;
  } catch (e) {
    console.error('[KAV] 데이터 로딩 실패:', e.message);
    if (state.items.length === 0) {
      dom.emptyState.style.display = 'flex';
    }
  } finally {
    state.isLoading = false;
  }
}

async function fetchItemDetail(id) {
  const res = await fetch(`/api/item?type=${state.type === 'album' ? 'album' : 'report'}&id=${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();
    state.monthlyStats = stats;
    renderFilterChips(stats);
  } catch (e) { }
}

// ─── Render: Cards ──────────────────────────────────────────────────
function renderCards(items, reset = false) {
  items.forEach((item, idx) => {
    const card = buildCard(item, reset ? idx : state.items.length - items.length + idx);
    dom.cardGrid.appendChild(card);
  });

  // Intersection Observer로 Lazy Loading 트리거
  observeCards();
}

function buildCard(item) {
  const card = document.createElement('article');
  card.className = 'kav-card';
  card.dataset.id = item.id;
  card.style.animationDelay = '0ms'; // 초기화 후 개별 지연

  const dateFormatted = formatDate(item.date);
  const excerpt = (item.content || '').replace(/[=\-▶]/g, '').trim().slice(0, 80);

  const badgesHtml = [
    item.photoCount > 0 ? `<span class="badge badge-photo">📷 ${item.photoCount}</span>` : '',
    item.videoCount > 0 ? `<span class="badge badge-video">🎬 ${item.videoCount}</span>` : '',
    item.commentCount > 0 ? `<span class="badge badge-comment">💬 ${item.commentCount}</span>` : '',
  ].filter(Boolean).join('');

  const thumbnailHtml = item.thumbnail
    ? `<img class="card-thumbnail" src="${item.thumbnail}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    + `<div class="card-thumbnail-placeholder" style="display:none">${getTypeEmoji(item)}</div>`
    : `<div class="card-thumbnail-placeholder">${getTypeEmoji(item)}</div>`;

  card.innerHTML = `
    ${thumbnailHtml}
    <div class="card-body">
      <div class="card-meta">
        <span class="card-date">${dateFormatted}</span>
        <div class="card-badges">${badgesHtml}</div>
      </div>
      <h2 class="card-title">${escapeHtml(item.title)}</h2>
      ${excerpt ? `<p class="card-excerpt">${escapeHtml(excerpt)}</p>` : ''}
    </div>
  `;

  card.addEventListener('click', () => openDetail(item.id));
  return card;
}

function getTypeEmoji(item) {
  if (item.videoCount > 0) return '🎬';
  if (item.photoCount > 0) return '📷';
  return state.type === 'album' ? '🖼️' : '📋';
}

// ─── Render: Filter Chips ────────────────────────────────────────────
function renderFilterChips(stats) {
  // 기존 칩 제거 (전체 칩 유지)
  const existing = dom.filterChips.querySelectorAll('.chip:not([data-filter="all"])');
  existing.forEach(c => c.remove());

  const months = Object.keys(stats).sort().reverse();
  for (const ym of months) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.filter = ym;
    const [year, month] = ym.split('-');
    chip.textContent = `${year}년 ${parseInt(month)}월`;
    chip.addEventListener('click', () => setFilter(ym, chip));
    dom.filterChips.appendChild(chip);
  }
}

function setFilter(filter, chip) {
  state.filter = filter;

  // 칩 활성화
  dom.filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');

  fetchItems(true);
}

// ─── Detail Modal ────────────────────────────────────────────────────
async function openDetail(id) {
  dom.modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  dom.modalBody.innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--text-muted)">불러오는 중...</div>';

  try {
    const item = await fetchItemDetail(id);
    renderDetail(item);
  } catch (e) {
    dom.modalBody.innerHTML = `<div style="text-align:center;padding:60px 0;color:var(--text-muted)">데이터를 불러오지 못했습니다.</div>`;
  }
}

function closeDetail() {
  dom.modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

function renderDetail(item) {
  const date = formatDate(item.date);
  const roleLabel = (role) => role === 'teacher' ? '교사' : role === 'parent' ? '학부모' : role;

  // 생활기록 HTML
  let lifeRecordHtml = '';
  if (item.lifeRecord) {
    const lr = item.lifeRecord;
    const entries = [];
    if (lr.mood) entries.push(['기분', lr.mood]);
    if (lr.health) entries.push(['건강', lr.health]);
    if (lr.temperature) entries.push(['체온', `${lr.temperature}°C`]);

    // 식사
    const meal = lr.meals || {};
    if (meal.breakfast) entries.push(['아침식사', meal.breakfast]);
    if (meal.lunch) entries.push(['점심식사', meal.lunch]);
    if (meal.dinner) entries.push(['저녁식사', meal.dinner]);
    if (meal.snack) entries.push(['간식', meal.snack]);

    // 수면
    const sleep = lr.sleep || {};
    if (sleep.bedtime) entries.push(['취침', sleep.bedtime]);
    if (sleep.wakeup) entries.push(['기상', sleep.wakeup]);
    if (sleep.duration) entries.push(['수면시간', sleep.duration]);

    // 배변
    const toilet = lr.toilet || {};
    if (toilet.count) entries.push(['배변횟수', `${toilet.count}회`]);

    if (lr.height) entries.push(['키', `${lr.height}cm`]);
    if (lr.weight) entries.push(['몸무게', `${lr.weight}kg`]);
    if (lr.medicine) entries.push(['투약', lr.medicine]);
    if (lr.special_note) entries.push(['특이사항', lr.special_note]);

    if (entries.length > 0) {
      const itemsHtml = entries.map(([label, val]) => `
        <div class="life-record-item">
          <div class="life-record-label">${label}</div>
          <div class="life-record-value">${escapeHtml(String(val))}</div>
        </div>
      `).join('');

      lifeRecordHtml = `
        <div class="life-record-section">
          <div class="life-record-title">📊 생활기록</div>
          <div class="life-record-grid">${itemsHtml}</div>
        </div>
      `;
    }
  }

  // 사진 갤러리 HTML
  let photosHtml = '';
  if (item.photos && item.photos.length > 0) {
    const imgs = item.photos.map((src, i) =>
      `<img class="gallery-img" src="${src}" alt="사진 ${i + 1}" loading="lazy"
        data-index="${i}" onerror="this.style.display='none'">`
    ).join('');
    photosHtml = `<div class="photo-gallery" id="modal-gallery">${imgs}</div>`;
  }

  // 영상 HTML
  let videosHtml = '';
  if (item.videos && item.videos.length > 0) {
    const videoEls = item.videos.map(src =>
      `<video class="video-player" controls preload="metadata">
        <source src="${src}">
        <p>브라우저에서 영상을 지원하지 않습니다.</p>
      </video>`
    ).join('');
    videosHtml = `<div class="video-section">${videoEls}</div>`;
  }

  // 댓글 HTML
  let commentsHtml = '';
  if (item.comments && item.comments.length > 0) {
    const commentItems = item.comments.map(c => {
      const avatarEmoji = c.role === 'teacher' ? '👩‍🏫' : c.role === 'parent' ? '👨‍👩‍👧' : '💬';
      const role = c.role ? `<span class="comment-role">(${roleLabel(c.role)})</span>` : '';
      const dateStr = c.date ? formatDate(c.date, true) : '';
      return `
        <div class="comment-item">
          <div class="comment-avatar">${avatarEmoji}</div>
          <div class="comment-content">
            <div>
              <span class="comment-author">${escapeHtml(c.author || '작성자')}</span>
              ${role}
            </div>
            ${dateStr ? `<div class="comment-date">${dateStr}</div>` : ''}
            <div class="comment-text">${escapeHtml(c.content || '')}</div>
          </div>
        </div>
      `;
    }).join('');
    commentsHtml = `
      <div class="comments-section">
        <div class="comments-title">💬 댓글 ${item.comments.length}개</div>
        ${commentItems}
      </div>
    `;
  }

  // 본문 정리 (텍스트 파일의 헤더/댓글 섹션 제거)
  let contentText = (item.content || '').trim();
  // metadata.json 기반이면 깔끔한 content만 표시
  contentText = contentText.replace(/={40,}/g, '').replace(/\[본문 게시글\][^\n]*/g, '').trim();

  dom.modalBody.innerHTML = `
    <div class="modal-header">
      <div class="modal-date">📅 ${date}</div>
      <h2 class="modal-title">${escapeHtml(item.title || '제목 없음')}</h2>
      ${item.author ? `<div class="modal-author">✍️ ${escapeHtml(item.author)}</div>` : ''}
    </div>
    ${photosHtml}
    ${videosHtml}
    ${contentText ? `<div class="modal-content">${escapeHtml(contentText)}</div>` : ''}
    ${lifeRecordHtml}
    ${commentsHtml}
  `;

  // 갤러리 클릭 → 라이트박스
  if (item.photos && item.photos.length > 0) {
    state.lightboxPhotos = item.photos;
    const gallery = document.getElementById('modal-gallery');
    if (gallery) {
      gallery.querySelectorAll('.gallery-img').forEach(img => {
        img.addEventListener('click', () => {
          openLightbox(parseInt(img.dataset.index));
        });
      });
    }
  }
}

// ─── Lightbox ────────────────────────────────────────────────────────
function openLightbox(index) {
  state.lightboxIndex = index;
  dom.lightboxOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  updateLightboxImage();
}

function closeLightbox() {
  dom.lightboxOverlay.classList.remove('open');
}

function updateLightboxImage() {
  const src = state.lightboxPhotos[state.lightboxIndex];
  dom.lightboxImg.style.opacity = '0';
  dom.lightboxImg.src = src;
  dom.lightboxImg.onload = () => { dom.lightboxImg.style.opacity = '1'; };
  dom.lightboxCounter.textContent = `${state.lightboxIndex + 1} / ${state.lightboxPhotos.length}`;

  dom.lightboxPrev.style.display = state.lightboxIndex > 0 ? 'flex' : 'none';
  dom.lightboxNext.style.display = state.lightboxIndex < state.lightboxPhotos.length - 1 ? 'flex' : 'none';
}

// ─── Lazy Loading (IntersectionObserver) ─────────────────────────────
let cardObserver = null;

function observeCards() {
  if (cardObserver) cardObserver.disconnect();

  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const delay = parseInt(card.dataset.delay || 0);
        setTimeout(() => {
          card.style.animationDelay = `${delay}ms`;
          card.style.animationPlayState = 'running';
        }, delay);
        cardObserver.unobserve(card);
      }
    });
  }, { rootMargin: '100px' });

  const cards = dom.cardGrid.querySelectorAll('.kav-card');
  cards.forEach((card, i) => {
    card.style.animationPlayState = 'paused';
    card.dataset.delay = String(Math.min(i * 50, 400));
    cardObserver.observe(card);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────
function formatDate(dateStr, withTime = false) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    
    // 강제 KST (UTC+9) 보정: 
    // 브라우저의 현재 오프셋을 더해 UTC로 만든 뒤, 한국 시간(9시간)을 더함
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 60 * 60 * 1000));
    
    const y = kst.getFullYear();
    const m = String(kst.getMonth() + 1).padStart(2, '0');
    const day = String(kst.getDate()).padStart(2, '0');
    const week = ['일', '월', '화', '수', '목', '금', '토'][kst.getDay()];
    
    let result = `${y}년 ${m}월 ${day}일 (${week})`;
    if (withTime) {
      const hh = String(kst.getHours()).padStart(2, '0');
      const mm = String(kst.getMinutes()).padStart(2, '0');
      result += ` ${hh}:${mm}`;
    }
    return result;
  } catch (e) { return dateStr; }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Search (debounce) ───────────────────────────────────────────────
let searchTimer = null;
function handleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = dom.searchInput.value.trim();
    fetchItems(true);
  }, 400);
}

// ─── Event Bindings ──────────────────────────────────────────────────
function bindEvents() {
  // 테마
  dom.themeToggle.addEventListener('click', toggleTheme);

  // 탭 전환
  dom.navReport.addEventListener('click', () => switchType('report'));
  dom.navAlbum.addEventListener('click', () => switchType('album'));

  // 검색
  dom.searchInput.addEventListener('input', handleSearch);

  // 더보기
  dom.loadMoreBtn.addEventListener('click', () => fetchItems(false));

  // 모달 닫기
  dom.modalClose.addEventListener('click', closeDetail);
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) closeDetail();
  });

  // 라이트박스
  dom.lightboxClose.addEventListener('click', closeLightbox);
  dom.lightboxOverlay.addEventListener('click', (e) => {
    if (e.target === dom.lightboxOverlay) closeLightbox();
  });
  dom.lightboxPrev.addEventListener('click', () => {
    if (state.lightboxIndex > 0) { state.lightboxIndex--; updateLightboxImage(); }
  });
  dom.lightboxNext.addEventListener('click', () => {
    if (state.lightboxIndex < state.lightboxPhotos.length - 1) { state.lightboxIndex++; updateLightboxImage(); }
  });

  // 전체 칩
  const allChip = dom.filterChips.querySelector('[data-filter="all"]');
  if (allChip) allChip.addEventListener('click', () => setFilter('all', allChip));

  // 키보드 단축키
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dom.lightboxOverlay.classList.contains('open')) closeLightbox();
      else if (dom.modalOverlay.classList.contains('open')) closeDetail();
    }
    if (dom.lightboxOverlay.classList.contains('open')) {
      if (e.key === 'ArrowLeft' && state.lightboxIndex > 0) { state.lightboxIndex--; updateLightboxImage(); }
      if (e.key === 'ArrowRight' && state.lightboxIndex < state.lightboxPhotos.length - 1) { state.lightboxIndex++; updateLightboxImage(); }
    }
  });
}

function switchType(type) {
  state.type = type;
  state.filter = 'all';
  state.query = '';
  dom.searchInput.value = '';

  dom.navReport.classList.toggle('active', type === 'report');
  dom.navAlbum.classList.toggle('active', type === 'album');

  dom.filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  const allChip = dom.filterChips.querySelector('[data-filter="all"]');
  if (allChip) allChip.classList.add('active');

  fetchStats();
  fetchItems(true);
}

// ─── Init ─────────────────────────────────────────────────────────────
async function init() {
  initTheme();
  bindEvents();

  // 통계 + 첫 데이터 로딩
  await Promise.all([fetchStats(), fetchItems(true)]);

  // 로더 숨기기
  dom.globalLoader.classList.add('hidden');
}

init();

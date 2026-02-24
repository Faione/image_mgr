const API = '/api';
const PAGE_SIZE = 5;

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadDates() {
  const select = document.getElementById('dateSelect');
  try {
    const dates = await fetchJSON(`${API}/dates`);
    select.innerHTML = dates.length
      ? ['<option value="">全部镜像（按日期）</option>', ...dates.map(d => `<option value="${d}">${d}</option>`)].join('')
      : '<option value="">暂无数据</option>';
  } catch (e) {
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

function renderImageItem(img) {
  return `
    <div class="image-item">
      <span class="name">${escapeHtml(img.filename)}</span>
      <span class="meta">${formatSize(img.size)} · ${img.modified.slice(0, 19)}</span>
      <a href="${img.url}" download>下载</a>
    </div>
  `;
}

async function loadImages(date) {
  const list = document.getElementById('imagesList');
  const title = document.getElementById('imagesTitle');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  loadMoreWrap.classList.add('hidden');

  if (date) {
    title.textContent = `镜像文件 - ${date}`;
    list.innerHTML = '<p class="hint">加载中...</p>';
    try {
      const images = await fetchJSON(`${API}/images?date=${date}`);
      if (!images.length) {
        list.innerHTML = '<p class="hint">该日期暂无镜像</p>';
        return;
      }
      list.innerHTML = images.map(renderImageItem).join('');
    } catch (e) {
      list.innerHTML = '<p class="hint">加载失败</p>';
    }
    return;
  }

  title.textContent = '全部镜像';
  await loadAllImages(0, true);
}

let allImagesOffset = 0;
let isLoadingAll = false;

async function loadAllImages(offset, replace) {
  const list = document.getElementById('imagesList');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (isLoadingAll) return;
  isLoadingAll = true;
  if (replace) list.innerHTML = '<p class="hint">加载中...</p>';

  try {
    const data = await fetchJSON(`${API}/images/all?offset=${offset}&limit=${PAGE_SIZE}`);
    const items = data.items || [];

    if (replace) {
      allImagesOffset = items.length;
      if (!items.length) {
        list.innerHTML = '<p class="hint">暂无镜像</p>';
      } else {
        list.innerHTML = items.map(g => `
          <div class="date-group">
            <div class="date-group-title">${escapeHtml(g.date)}</div>
            ${(g.images || []).map(renderImageItem).join('')}
          </div>
        `).join('');
      }
    } else {
      allImagesOffset += items.length;
      const frag = items.map(g => `
        <div class="date-group">
          <div class="date-group-title">${escapeHtml(g.date)}</div>
          ${(g.images || []).map(renderImageItem).join('')}
        </div>
      `).join('');
      if (list.querySelector('.date-group')) {
        list.insertAdjacentHTML('beforeend', frag);
      } else {
        list.innerHTML = items.length ? frag : '<p class="hint">暂无镜像</p>';
      }
    }

    loadMoreWrap.classList.toggle('hidden', !data.has_more);
  } catch (e) {
    if (replace) list.innerHTML = '<p class="hint">加载失败</p>';
  } finally {
    isLoadingAll = false;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function doRefresh() {
  const hint = document.getElementById('pullHint');
  hint.textContent = '刷新中...';
  hint.classList.add('refreshing');
  const date = document.getElementById('dateSelect').value;
  loadImages(date).then(() => {
    hint.textContent = '下拉刷新';
    hint.classList.remove('refreshing');
  });
}

function setupPullRefresh() {
  const section = document.getElementById('imagesSection');
  const hint = document.getElementById('pullHint');
  let startY = 0;

  hint.addEventListener('click', () => doRefresh());

  section.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
  }, { passive: true });

  section.addEventListener('touchmove', (e) => {
    if (window.scrollY <= 0 && e.touches[0].clientY - startY > 30) {
      hint.textContent = '释放刷新';
    } else {
      hint.textContent = '下拉刷新';
    }
  }, { passive: true });

  section.addEventListener('touchend', (e) => {
    if (window.scrollY <= 0 && e.changedTouches[0].clientY - startY > 60) {
      doRefresh();
    } else {
      hint.textContent = '下拉刷新';
    }
  }, { passive: true });
}

function initImagesPage() {
  loadDates();
  const select = document.getElementById('dateSelect');
  select.onchange = () => {
    const date = select.value;
    loadImages(date);
  };
  loadImages(''); // 默认加载全部
  setupPullRefresh();

  document.getElementById('loadMoreBtn').onclick = () => {
    if (select.value) return;
    loadAllImages(allImagesOffset, false);
  };
}

async function loadBuildLog() {
  const el = document.getElementById('buildLog');
  try {
    const log = await fetchJSON(`${API}/builds`);
    if (!log.length) {
      el.innerHTML = '<p class="hint">暂无构建记录</p>';
      return;
    }
    el.innerHTML = log.reverse().map(r => `
      <div class="build-record">
        <strong>${escapeHtml(r.name)}</strong> · 
        <span class="status ${r.status.includes('fail') ? 'failed' : 'success'}">${escapeHtml(r.status)}</span> ·
        ${r.time}
        ${r.artifacts?.length ? `<br>产物: ${r.artifacts.join(', ')}` : ''}
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '<p class="hint">加载失败</p>';
  }
}

function initBuildsPage() {
  loadBuildLog();
  document.getElementById('buildForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value,
      interval_minutes: +form.interval.value,
      script: form.script.value,
    };
    try {
      const r = await fetch(`${API}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        loadBuildLog();
        form.script.value = '';
      }
    } catch (_) {}
  };
}

function route() {
  const path = location.pathname;
  const app = document.getElementById('app');
  const buildsApp = document.getElementById('builds-app');
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', (path === '/' && a.href.endsWith('/')) || (path === '/builds' && a.href.endsWith('/builds')));
  });
  if (path === '/builds') {
    app.classList.add('hidden');
    buildsApp.classList.remove('hidden');
    initBuildsPage();
  } else {
    app.classList.remove('hidden');
    buildsApp.classList.add('hidden');
    initImagesPage();
  }
}

route();
window.addEventListener('popstate', route);

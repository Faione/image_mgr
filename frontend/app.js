const API = '/api';

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
      ? ['<option value="">-- 选择日期 --', ...dates.map(d => `<option value="${d}">${d}</option>`)].join('')
      : '<option value="">暂无数据</option>';
  } catch (e) {
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

async function loadImages(date) {
  const list = document.getElementById('imagesList');
  const title = document.getElementById('imagesTitle');
  if (!date) {
    list.innerHTML = '<p class="hint">请选择日期</p>';
    return;
  }
  title.textContent = `镜像文件 - ${date}`;
  list.innerHTML = '<p class="hint">加载中...</p>';
  try {
    const images = await fetchJSON(`${API}/images?date=${date}`);
    if (!images.length) {
      list.innerHTML = '<p class="hint">该日期暂无镜像</p>';
      return;
    }
    list.innerHTML = images.map(img => `
      <div class="image-item">
        <span class="name">${escapeHtml(img.filename)}</span>
        <span class="meta">${formatSize(img.size)} · ${img.modified.slice(0, 19)}</span>
        <a href="${img.url}" download>下载</a>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<p class="hint">加载失败</p>';
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

function initImagesPage() {
  loadDates();
  document.getElementById('dateSelect').onchange = () => {
    loadImages(document.getElementById('dateSelect').value);
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

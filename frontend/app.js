const API = '/api';
const PAGE_SIZE = 5;
const THEME_KEY = 'theme';
let IS_ADMIN_VIEW = false;
let IS_ADMIN_AUTH = false;

function initTheme() {
  let theme = localStorage.getItem(THEME_KEY) || 'light';
  document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '深色' : '浅色';
    btn.onclick = () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, theme);
      document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : '');
      btn.textContent = theme === 'dark' ? '深色' : '浅色';
    };
  }
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadAnnouncement() {
  const bar = document.getElementById('announcementBar');
  if (!bar) return;
  try {
    const r = await fetch(`${API}/announcement`);
    const data = r.ok ? await r.json() : {};
    const t = (data.content || '').trim();
    if (t) {
      bar.textContent = t;
      bar.classList.remove('hidden');
    } else {
      bar.textContent = '';
      bar.classList.add('hidden');
    }
  } catch (_) {
    bar.classList.add('hidden');
  }
}

function setReleaseNotesBlock(text) {
  const el = document.getElementById('releaseNotesBlock');
  if (!el) return;
  const t = (text || '').trim();
  if (t) {
    el.textContent = t;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function refreshAdminChrome() {
  const btn = document.getElementById('stableEditToggle');
  const panel = document.getElementById('stableEditPanel');
  if (!btn || !panel) return;
  const show = IS_ADMIN_VIEW && IS_ADMIN_AUTH;
  btn.classList.toggle('hidden', !show);
  if (!show) panel.classList.add('hidden');
}

async function loadStableImages() {
  const list = document.getElementById('stableImagesList');
  if (!list) return;
  try {
    const r = await fetch(`${API}/images/stable`);
    const data = r.ok ? await r.json() : null;
    const images = Array.isArray(data) ? data : [];
    if (!images.length) {
      list.innerHTML = '<p class="hint">暂无固定发布</p>';
    } else {
      list.innerHTML = images.map(img => renderImageItem(img, 'stable')).join('');
      bindDeleteButtons(list);
    }
  } catch (e) {
    list.innerHTML = '<p class="hint">加载失败</p>';
  }
  refreshAdminChrome();
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

function renderImageItem(img, date) {
  const d = date || '';
  return `
    <div class="image-item">
      <span class="name">${escapeHtml(img.filename)}</span>
      <span class="meta">${formatSize(img.size)} · ${img.modified.slice(0, 19)}</span>
      <a href="${img.url}" download>下载</a>
      ${renderDeleteButton(d, img.filename)}
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
    setReleaseNotesBlock('');
    try {
      const [images, notesRes] = await Promise.all([
        fetchJSON(`${API}/images?date=${date}`),
        fetch(`${API}/release-notes?date=${encodeURIComponent(date)}`).then(r => (r.ok ? r.json() : { content: '' })),
      ]);
      const notesTrimmed = (notesRes.content || '').trim();
      list.innerHTML = renderSingleDateBlock(date, images, notesTrimmed);
      bindDeleteButtons(list);
      bindDateGroupEditors(list);
    } catch (e) {
      list.innerHTML = '<p class="hint">加载失败</p>';
    }
    return;
  }

  setReleaseNotesBlock('');
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
        list.innerHTML = items.map(g => renderDateGroupBlock(g)).join('');
        bindDeleteButtons(list);
        bindDateGroupEditors(list);
      }
    } else {
      allImagesOffset += items.length;
      const frag = items.map(g => renderDateGroupBlock(g)).join('');
      if (list.querySelector('.date-group')) {
        list.insertAdjacentHTML('beforeend', frag);
      } else {
        list.innerHTML = items.length ? frag : '<p class="hint">暂无镜像</p>';
      }
      bindDeleteButtons(list);
      bindDateGroupEditors(list);
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

function renderDeleteButton(date, filename) {
  if (!IS_ADMIN_VIEW || !IS_ADMIN_AUTH) return '';
  return `<button type="button" class="btn-delete" data-date="${escapeHtml(date)}" data-filename="${escapeHtml(filename)}">删除</button>`;
}

function renderDateEditPanel(date, notes) {
  const d = escapeHtml(date);
  const n = escapeHtml(notes || '');
  return `
    <div class="date-group-edit-panel hidden js-date-edit-panel" data-date="${d}">
      <label class="edit-label">当日发布说明</label>
      <textarea class="js-release-notes-ta" rows="3" data-date="${d}">${n}</textarea>
      <div class="edit-row">
        <button type="button" class="js-save-release-notes" data-date="${d}">保存说明</button>
      </div>
      <label class="edit-label">上传到此日期</label>
      <div class="drop-zone drop-zone-compact js-date-drop" data-date="${d}" tabindex="0" role="button">
        <span class="drop-zone-text">拖放文件或点击选择</span>
      </div>
      <div class="edit-row">
        <input type="file" multiple class="js-date-file" data-date="${d}">
        <button type="button" class="js-date-upload-btn" data-date="${d}">上传</button>
      </div>
    </div>`;
}

function renderDateGroupBlock(g) {
  const date = g.date;
  const notes = (g.notes || '').trim();
  const images = g.images || [];
  const notesHtml = notes ? `<div class="group-release-notes">${escapeHtml(notes)}</div>` : '';
  const adminHeader =
    IS_ADMIN_VIEW && IS_ADMIN_AUTH
      ? `<div class="date-group-header"><div class="date-group-title">${escapeHtml(date)}</div><button type="button" class="btn-edit-entry js-toggle-date-edit" data-date="${escapeHtml(date)}">管理</button></div>`
      : `<div class="date-group-title">${escapeHtml(date)}</div>`;
  const adminPanel = IS_ADMIN_VIEW && IS_ADMIN_AUTH ? renderDateEditPanel(date, notes) : '';
  const body = images.length
    ? images.map(img => renderImageItem(img, date)).join('')
    : '<p class="hint">该日期暂无镜像</p>';
  return `<div class="date-group" data-date="${escapeHtml(date)}">${adminHeader}${notesHtml}${adminPanel}${body}</div>`;
}

function renderSingleDateBlock(date, images, notesTrimmed) {
  const notesHtml = notesTrimmed ? `<div class="group-release-notes">${escapeHtml(notesTrimmed)}</div>` : '';
  const adminHeader =
    IS_ADMIN_VIEW && IS_ADMIN_AUTH
      ? `<div class="date-group-header"><div class="date-group-title">${escapeHtml(date)}</div><button type="button" class="btn-edit-entry js-toggle-date-edit" data-date="${escapeHtml(date)}">管理</button></div>`
      : `<div class="date-group-title">${escapeHtml(date)}</div>`;
  const adminPanel = IS_ADMIN_VIEW && IS_ADMIN_AUTH ? renderDateEditPanel(date, notesTrimmed) : '';
  const body = images.length
    ? images.map(img => renderImageItem(img, date)).join('')
    : '<p class="hint">该日期暂无镜像</p>';
  return `<div class="date-group" data-date="${escapeHtml(date)}">${adminHeader}${notesHtml}${adminPanel}${body}</div>`;
}

function bindCompactDropZone(dropEl, fileInput, onFiles) {
  if (!dropEl || !fileInput) return;
  ['dragenter', 'dragover'].forEach(ev => {
    dropEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.remove('drag-over');
    });
  });
  dropEl.addEventListener('drop', e => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
  dropEl.addEventListener('click', () => fileInput.click());
}

function bindDateGroupEditors(root) {
  if (!root || !IS_ADMIN_VIEW || !IS_ADMIN_AUTH) return;
  root.querySelectorAll('.js-toggle-date-edit').forEach(btn => {
    btn.onclick = () => {
      const group = btn.closest('.date-group');
      const panel = group && group.querySelector('.js-date-edit-panel');
      if (panel) panel.classList.toggle('hidden');
    };
  });
  root.querySelectorAll('.js-save-release-notes').forEach(btn => {
    btn.onclick = async () => {
      const date = btn.dataset.date;
      const group = btn.closest('.date-group');
      const ta = group && group.querySelector('.js-release-notes-ta');
      const content = ta ? ta.value : '';
      const r = await fetchWithAdmin(`${API}/admin/release-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, content }),
      });
      if (r.ok) {
        const ds = document.getElementById('dateSelect');
        const cur = ds && ds.value;
        if (cur === date) await loadImages(date);
        else if (!cur) await loadAllImages(0, true);
        else await loadImages(cur);
        alert('发布说明已保存');
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || '保存失败');
      }
    };
  });
  root.querySelectorAll('.js-date-upload-btn').forEach(btn => {
    btn.onclick = async () => {
      const group = btn.closest('.date-group');
      const input = group && group.querySelector('.js-date-file');
      if (!input) return;
      await doAdminUploadToTarget(input.files, btn.dataset.date);
      input.value = '';
    };
  });
  root.querySelectorAll('.js-date-drop').forEach(drop => {
    if (drop.dataset.dropBound === '1') return;
    drop.dataset.dropBound = '1';
    const group = drop.closest('.date-group');
    const input = group && group.querySelector('.js-date-file');
    const date = drop.dataset.date;
    if (!input || !date) return;
    bindCompactDropZone(drop, input, files => doAdminUploadToTarget(files, date));
  });
}

async function doAdminUploadToTarget(files, target) {
  if (!files || !files.length) {
    alert('请先选择文件');
    return;
  }
  try {
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append('file', files[i]);
    const url = `${API}/admin/upload?target=${encodeURIComponent(target)}`;
    const r = await fetchWithAdmin(url, { method: 'POST', body: fd });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.saved && data.saved.length) {
      const d = document.getElementById('dateSelect')?.value || '';
      await Promise.all([loadStableImages(), loadImages(d)]);
      alert(`已上传 ${data.saved.length} 个文件`);
    } else if (!r.ok) {
      alert(data.error || '上传失败');
    } else {
      alert('未保存任何文件，请检查格式');
    }
  } catch (err) {
    alert('上传请求失败: ' + (err.message || err));
  }
}

let stableAdminBound = false;
function setupStableAdminPanel() {
  if (stableAdminBound) return;
  stableAdminBound = true;
  const toggle = document.getElementById('stableEditToggle');
  const panel = document.getElementById('stableEditPanel');
  const drop = document.getElementById('stableMiniDrop');
  const input = document.getElementById('stableFileInput');
  const btn = document.getElementById('stableUploadBtn');
  if (!toggle || !panel || !drop || !input || !btn) return;
  toggle.onclick = () => panel.classList.toggle('hidden');
  btn.onclick = async () => {
    await doAdminUploadToTarget(input.files, 'stable');
    input.value = '';
  };
  bindCompactDropZone(drop, input, files => doAdminUploadToTarget(files, 'stable'));
}

function bindDeleteButtons(root) {
  if (!root) return;
  root.querySelectorAll('.btn-delete').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('确定删除该镜像？')) return;
      const date = btn.dataset.date;
      const filename = btn.dataset.filename;
      const r = await fetchWithAdmin(`${API}/admin/image/${date}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (r.ok) {
        const currentDate = document.getElementById('dateSelect')?.value || '';
        await Promise.all([loadStableImages(), loadImages(currentDate)]);
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || '删除失败');
      }
    };
  });
}

function doRefresh() {
  const hint = document.getElementById('pullHint');
  hint.textContent = '刷新中...';
  hint.classList.add('refreshing');
  const date = document.getElementById('dateSelect').value;
  Promise.all([loadStableImages(), loadImages(date), loadAnnouncement()]).then(() => {
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
  loadStableImages();
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
  if (!el) return;
  try {
    const r = await fetchWithAdmin(`${API}/builds`);
    if (!r.ok) {
      el.innerHTML = '<p class="hint">加载失败（需管理员）</p>';
      return;
    }
    const log = await r.json();
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

function setupBuildFormInAdmin() {
  const form = document.getElementById('buildForm');
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const data = {
      name: formEl.name.value,
      interval_minutes: +formEl.interval.value,
      script: formEl.script.value,
    };
    try {
      const r = await fetchWithAdmin(`${API}/builds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        loadBuildLog();
        formEl.script.value = '';
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || '构建启动失败');
      }
    } catch (_) {}
  };
}

const ADMIN_TOKEN_KEY = 'admin_token';

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function setAdminToken(t) {
  if (t) sessionStorage.setItem(ADMIN_TOKEN_KEY, t);
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function fetchWithAdmin(url, opts = {}) {
  const token = getAdminToken();
  opts.headers = opts.headers || {};
  opts.headers['X-Admin-Token'] = token;
  return fetch(url, opts);
}

async function checkAdminStatus() {
  const r = await fetch(`${API}/admin/status`);
  const data = await r.json();
  return data.enabled === true;
}

async function initAdminPage() {
  const loginEl = document.getElementById('adminLogin');
  const panelEl = document.getElementById('adminPanel');
  const tokenInput = document.getElementById('adminTokenInput');
  const tokenBtn = document.getElementById('adminTokenBtn');

  const enabled = await checkAdminStatus();
  if (!enabled) {
    loginEl.innerHTML = '<p class="hint">未配置管理员（config.toml 中未设置 admin_token）</p>';
    return;
  }

  const saved = getAdminToken();
  if (saved) {
    const ok = await fetchWithAdmin(`${API}/admin/verify`).then(r => r.ok);
    if (ok) {
      loginEl.classList.add('hidden');
      panelEl.classList.remove('hidden');
      IS_ADMIN_AUTH = true;
      const currentDate = document.getElementById('dateSelect')?.value || '';
      Promise.all([loadStableImages(), loadImages(currentDate)]);
      document.getElementById('buildAdminBlock')?.classList.remove('hidden');
      loadBuildLog();
      setupStableAdminPanel();
      setupBuildFormInAdmin();
      setupAdminNewsForms();
      refreshAdminChrome();
      document.getElementById('adminLogout').onclick = () => {
        setAdminToken('');
        IS_ADMIN_AUTH = false;
        panelEl.classList.add('hidden');
        loginEl.classList.remove('hidden');
        document.getElementById('buildAdminBlock')?.classList.add('hidden');
        const d = document.getElementById('dateSelect')?.value || '';
        refreshAdminChrome();
        Promise.all([loadStableImages(), loadImages(d)]);
      };
      return;
    }
    setAdminToken('');
  }

  tokenBtn.onclick = async () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    const r = await fetch(`${API}/admin/verify`, { headers: { 'X-Admin-Token': token } });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert(err.error || '令牌无效');
      return;
    }
    setAdminToken(token);
    tokenInput.value = '';
    loginEl.classList.add('hidden');
    panelEl.classList.remove('hidden');
    IS_ADMIN_AUTH = true;
    const currentDate = document.getElementById('dateSelect')?.value || '';
    Promise.all([loadStableImages(), loadImages(currentDate)]);
    document.getElementById('buildAdminBlock')?.classList.remove('hidden');
    loadBuildLog();
    setupStableAdminPanel();
    setupBuildFormInAdmin();
    setupAdminNewsForms();
    refreshAdminChrome();
    document.getElementById('adminLogout').onclick = () => {
      setAdminToken('');
      IS_ADMIN_AUTH = false;
      panelEl.classList.add('hidden');
      loginEl.classList.remove('hidden');
      document.getElementById('buildAdminBlock')?.classList.add('hidden');
      const d = document.getElementById('dateSelect')?.value || '';
      refreshAdminChrome();
      Promise.all([loadStableImages(), loadImages(d)]);
    };
  };
}

async function loadAdminAnnouncementField() {
  const ta = document.getElementById('adminAnnouncement');
  if (!ta) return;
  try {
    const r = await fetch(`${API}/announcement`);
    const data = r.ok ? await r.json() : {};
    ta.value = data.content || '';
  } catch (_) {}
}

function setupAdminNewsForms() {
  loadAdminAnnouncementField();

  const saveAnn = document.getElementById('adminAnnouncementSave');
  if (saveAnn) {
    saveAnn.onclick = async () => {
      const content = document.getElementById('adminAnnouncement')?.value || '';
      const r = await fetchWithAdmin(`${API}/admin/announcement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (r.ok) {
        await loadAnnouncement();
        alert('公告已保存');
      } else {
        const err = await r.json().catch(() => ({}));
        alert(err.error || '保存失败');
      }
    };
  }
}

function route() {
  const path = location.pathname;
  const app = document.getElementById('app');
  const adminInline = document.getElementById('adminInlineSection');
  const buildBlock = document.getElementById('buildAdminBlock');
  IS_ADMIN_VIEW = path === '/admin';
  loadAnnouncement();
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', (path === '/' && a.href.endsWith('/')) || (path === '/admin' && a.href.endsWith('/admin')));
  });
  app.classList.remove('hidden');
  if (IS_ADMIN_VIEW) {
    adminInline.classList.remove('hidden');
    initAdminPage();
  } else {
    IS_ADMIN_AUTH = false;
    adminInline.classList.add('hidden');
  }
  if (buildBlock) buildBlock.classList.toggle('hidden', !(IS_ADMIN_VIEW && IS_ADMIN_AUTH));
  refreshAdminChrome();
  initImagesPage();
}

route();
initTheme();
window.addEventListener('popstate', route);

const API = '/api';
const PAGE_SIZE = 5;
const THEME_KEY = 'theme';
/** 刷新提示在非进行中时的文案（与 index.html 初始文案一致） */
const PULL_HINT_IDLE = '下拉或滚轮刷新';
let IS_ADMIN_VIEW = false;
let IS_ADMIN_AUTH = false;
/** @type {Record<string, number>} */
let downloadStatsCache = {};

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

let announcementMarkdownInited = false;
function ensureAnnouncementMarkdown() {
  if (announcementMarkdownInited) return;
  announcementMarkdownInited = true;
  if (typeof marked !== 'undefined' && marked.setOptions) {
    marked.setOptions({
      mangle: false,
      headerIds: false,
      breaks: true,
    });
  }
}

function announcementPlainFallback(md) {
  const div = document.createElement('div');
  div.textContent = md;
  return `<p class="announcement-fallback">${div.innerHTML.replace(/\n/g, '<br>')}</p>`;
}

function renderAnnouncementMarkdown(md) {
  ensureAnnouncementMarkdown();
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    try {
      const html = marked.parse(md);
      if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html);
      }
      return html;
    } catch (_) {
      /* fall through */
    }
  }
  return announcementPlainFallback(md);
}

async function loadAnnouncement() {
  const bar = document.getElementById('announcementBar');
  const inner = document.getElementById('announcementBarInner');
  if (!bar || !inner) return;
  try {
    const r = await fetch(`${API}/announcement`);
    const data = r.ok ? await r.json() : {};
    const t = (data.content || '').trim();
    if (t) {
      inner.innerHTML = renderAnnouncementMarkdown(t);
      bar.classList.remove('hidden');
    } else {
      inner.innerHTML = '';
      bar.classList.add('hidden');
    }
  } catch (_) {
    inner.innerHTML = '';
    bar.classList.add('hidden');
  }
}

function setReleaseNotesBlock(text) {
  const wrap = document.getElementById('releaseNotesBlock');
  const inner = document.getElementById('releaseNotesInner');
  if (!wrap || !inner) return;
  const t = (text || '').trim();
  if (t) {
    inner.innerHTML = renderAnnouncementMarkdown(t);
    wrap.classList.remove('hidden');
  } else {
    inner.innerHTML = '';
    wrap.classList.add('hidden');
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

function populateStableCategorySelect(categoryIds) {
  const sel = document.getElementById('stableCategorySelect');
  if (!sel) return;
  const ids = Array.isArray(categoryIds) ? categoryIds : [];
  const cur = sel.value;
  sel.innerHTML = ids.length
    ? ids.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
    : '<option value="default">default</option>';
  if (cur && ids.includes(cur)) sel.value = cur;
  else if (ids.includes('default')) sel.value = 'default';
  else if (ids.length) sel.value = ids[0];
}

async function ensureDownloadStats() {
  if (!IS_ADMIN_AUTH) {
    downloadStatsCache = {};
    return;
  }
  try {
    const r = await fetchWithAdmin(`${API}/admin/download-stats`);
    if (!r.ok) return;
    const data = await r.json();
    downloadStatsCache = data.counts && typeof data.counts === 'object' ? data.counts : {};
  } catch (_) {
    downloadStatsCache = {};
  }
}

async function loadStableImages() {
  const list = document.getElementById('stableImagesList');
  if (!list) return;
  try {
    await ensureDownloadStats();
    const r = await fetch(`${API}/images/stable`);
    const data = r.ok ? await r.json() : null;
    const groups = data && Array.isArray(data.categories) ? data.categories : [];
    const categoryIds = groups.map((g) => g.category).filter(Boolean);
    populateStableCategorySelect(categoryIds.length ? categoryIds : ['default']);

    if (!groups.length) {
      list.innerHTML = '<p class="hint">暂无固定发布</p>';
    } else {
      const html = groups
        .map((g) => {
          const cat = g.category || 'default';
          const images = Array.isArray(g.images) ? g.images : [];
          const title =
            groups.length > 1
              ? `<h3 class="stable-cat-title">${escapeHtml(cat)}</h3>`
              : '';
          const body = images.length
            ? images.map((img) => renderImageItem(img, 'stable', { stableCategory: cat })).join('')
            : '<p class="hint">该分类下暂无文件</p>';
          return `<div class="stable-category-block" data-category="${escapeHtml(cat)}">${title}${body}</div>`;
        })
        .join('');
      list.innerHTML = html;
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
      ? [
          '<option value="">全部镜像（按日期）</option>',
          ...dates.map((d) => `<option value="${d}">${d}</option>`),
        ].join('')
      : '<option value="">暂无数据</option>';
  } catch (e) {
    select.innerHTML = '<option value="">加载失败</option>';
  }
}

function renderImageItem(img, date, opts = {}) {
  const d = date || '';
  const stableCat = opts.stableCategory;
  const statKey =
    stableCat != null && stableCat !== ''
      ? `stable/${stableCat}/${img.filename}`
      : `${d}/${img.filename}`;
  const dlCount = IS_ADMIN_AUTH ? downloadStatsCache[statKey] || 0 : null;
  const sizeText = formatSize(img.size);
  const timeText = img.modified.slice(0, 19);
  const dlMeta =
    IS_ADMIN_AUTH && dlCount !== null
      ? `
          <span class="meta-sep">·</span>
          <span class="meta-dl-count">下载 ${dlCount} 次</span>`
      : '';
  return `
    <div class="image-item">
      <div class="image-main">
        <div class="name">${escapeHtml(img.filename)}</div>
        <div class="meta">
          <span class="meta-size">${sizeText}</span>
          <span class="meta-sep">·</span>
          <span class="meta-time">${timeText}</span>
          ${dlMeta}
        </div>
      </div>
      <div class="image-actions">
        <a href="${img.url}" download class="btn-download">下载</a>
        ${renderDeleteButton(d, img.filename, stableCat)}
      </div>
    </div>
  `;
}

async function loadImages(date) {
  const list = document.getElementById('imagesList');
  const title = document.getElementById('imagesTitle');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  loadMoreWrap.classList.add('hidden');
  resetImagesListScrollTop();

  if (date) {
    title.textContent = `镜像文件 - ${date}`;
    list.innerHTML = '<p class="hint">加载中...</p>';
    setReleaseNotesBlock('');
    try {
      await ensureDownloadStats();
      const [images, notesRes] = await Promise.all([
        fetchJSON(`${API}/images?date=${date}`),
        fetch(`${API}/release-notes?date=${encodeURIComponent(date)}`).then((r) =>
          r.ok ? r.json() : { content: '' }
        ),
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
let isRefreshing = false;
let pullRefreshBound = false;
/** 避免移动端 touchend 触发刷新后又合成 click 重复执行 */
let suppressPullHintClick = false;
let refreshResetTimer = null;
/** 镜像列表无限滚动是否已绑定 */
let imagesListScrollBound = false;
/** 串行执行「补满列表可视高度」预加载，避免并发触发 */
let imagesListPrefetchChain = Promise.resolve();

function resetImagesListScrollTop() {
  const scrollEl = document.getElementById('imagesListScroll');
  if (scrollEl) scrollEl.scrollTop = 0;
}

/**
 * 首屏内容若不足以撑满列表可视高度，则无法滚动触底加载更早镜像；
 * 在仍有下一页时自动连续加载直至出现纵向溢出或无更多数据。
 */
async function fillImagesListUntilScrollableOrDone() {
  const scrollEl = document.getElementById('imagesListScroll');
  const dateSelect = document.getElementById('dateSelect');
  const slack = 24;
  for (let i = 0; i < 24; i++) {
    if (!scrollEl || dateSelect?.value) return;
    const wrap = document.getElementById('loadMoreWrap');
    if (!wrap || wrap.classList.contains('hidden')) return;
    if (scrollEl.scrollHeight > scrollEl.clientHeight + slack) return;
    await loadAllImages(allImagesOffset, false);
  }
}

function schedulePrefetchUntilScrollable() {
  imagesListPrefetchChain = imagesListPrefetchChain
    .then(() => fillImagesListUntilScrollableOrDone())
    .catch(() => {});
}

/** 滚轮 delta 转为像素（兼容 deltaMode） */
function wheelEventVerticalPixels(e, viewportPx) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  else if (e.deltaMode === 2) dy *= Math.max(120, viewportPx);
  return dy;
}

/** 「全部镜像」模式下：列表滚到底或底部继续向下滚轮时加载更早日期 */
function setupImagesListInfiniteScroll() {
  const scrollEl = document.getElementById('imagesListScroll');
  const dateSelect = document.getElementById('dateSelect');
  if (!scrollEl || imagesListScrollBound) return;
  imagesListScrollBound = true;

  const tryLoadMore = () => {
    if (!dateSelect || dateSelect.value) return;
    if (isLoadingAll) return;
    const wrap = document.getElementById('loadMoreWrap');
    if (!wrap || wrap.classList.contains('hidden')) return;
    const threshold = 72;
    if (
      scrollEl.scrollTop + scrollEl.clientHeight >=
      scrollEl.scrollHeight - threshold
    ) {
      loadAllImages(allImagesOffset, false);
    }
  };

  scrollEl.addEventListener('scroll', tryLoadMore, { passive: true });

  /**
   * 部分浏览器不把 wheel 交给嵌套的 overflow 子容器，导致列表内滚轮无响应。
   * 使用非 passive 监听，在容器内自行滚动并在触底时加载更多。
   */
  scrollEl.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.15) return;

      const dy = wheelEventVerticalPixels(e, scrollEl.clientHeight);
      if (Math.abs(dy) < 0.25) return;

      const tol = 2;
      const maxScroll = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const top = scrollEl.scrollTop;

      const goingDown = dy > 0;
      const goingUp = dy < 0;

      if (goingDown && top < maxScroll - tol) {
        e.preventDefault();
        scrollEl.scrollTop = Math.min(maxScroll, top + dy);
        return;
      }

      if (goingUp && top > tol) {
        e.preventDefault();
        scrollEl.scrollTop = Math.max(0, top + dy);
        return;
      }

      const allMode = dateSelect && !dateSelect.value;

      if (goingDown && allMode && maxScroll <= tol) {
        const wrap = document.getElementById('loadMoreWrap');
        if (wrap && !wrap.classList.contains('hidden') && !isLoadingAll) {
          e.preventDefault();
          loadAllImages(allImagesOffset, false);
        }
        return;
      }

      if (goingDown && allMode && maxScroll > 0 && top >= maxScroll - tol) {
        const wrap = document.getElementById('loadMoreWrap');
        if (wrap && !wrap.classList.contains('hidden') && !isLoadingAll) {
          e.preventDefault();
          loadAllImages(allImagesOffset, false);
        }
      }
    },
    { passive: false }
  );
}

async function loadAllImages(offset, replace) {
  const list = document.getElementById('imagesList');
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (isLoadingAll) return;
  isLoadingAll = true;
  if (loadMoreBtn) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.classList.add('is-loading');
    if (!replace) loadMoreBtn.textContent = '加载中';
  }
  if (replace) {
    resetImagesListScrollTop();
    list.innerHTML = '<p class="hint">加载中...</p>';
  }

  try {
    await ensureDownloadStats();
    const data = await fetchJSON(`${API}/images/all?offset=${offset}&limit=${PAGE_SIZE}`);
    const items = data.items || [];

    if (replace) {
      allImagesOffset = items.length;
      if (!items.length) {
        list.innerHTML = '<p class="hint">暂无镜像</p>';
      } else {
        list.innerHTML = items.map((g) => renderDateGroupBlock(g)).join('');
        bindDeleteButtons(list);
        bindDateGroupEditors(list);
      }
    } else {
      allImagesOffset += items.length;
      const frag = items.map((g) => renderDateGroupBlock(g)).join('');
      if (list.querySelector('.date-group')) {
        list.insertAdjacentHTML('beforeend', frag);
      } else {
        list.innerHTML = items.length ? frag : '<p class="hint">暂无镜像</p>';
      }
      bindDeleteButtons(list);
      bindDateGroupEditors(list);
    }

    loadMoreWrap.classList.toggle('hidden', !data.has_more);

    const dsPrefetch = document.getElementById('dateSelect');
    if (!dsPrefetch?.value && data.has_more) {
      schedulePrefetchUntilScrollable();
    }
  } catch (e) {
    if (replace) list.innerHTML = '<p class="hint">加载失败</p>';
  } finally {
    isLoadingAll = false;
    if (loadMoreBtn) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.classList.remove('is-loading');
      loadMoreBtn.textContent = '加载更多';
    }
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

function renderDeleteButton(date, filename, stableCategory) {
  if (!IS_ADMIN_VIEW || !IS_ADMIN_AUTH) return '';
  if (stableCategory != null && stableCategory !== '') {
    return `<button type="button" class="btn-delete" data-stable="1" data-category="${escapeHtml(stableCategory)}" data-filename="${escapeHtml(filename)}">删除</button>`;
  }
  return `<button type="button" class="btn-delete" data-date="${escapeHtml(date)}" data-filename="${escapeHtml(filename)}">删除</button>`;
}

function renderDateEditPanel(date, notes) {
  const d = escapeHtml(date);
  const n = escapeHtml(notes || '');
  return `
    <div class="date-group-edit-panel hidden js-date-edit-panel" data-date="${d}">
      <label class="edit-label">当日发布说明（支持 Markdown）</label>
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
  const notesHtml = notes
    ? `<div class="group-release-notes announcement-md">${renderAnnouncementMarkdown(notes)}</div>`
    : '';
  const adminHeader =
    IS_ADMIN_VIEW && IS_ADMIN_AUTH
      ? `<div class="date-group-header"><div class="date-group-title">${escapeHtml(date)}</div><button type="button" class="btn-edit-entry js-toggle-date-edit" data-date="${escapeHtml(date)}">管理</button></div>`
      : `<div class="date-group-title">${escapeHtml(date)}</div>`;
  const adminPanel = IS_ADMIN_VIEW && IS_ADMIN_AUTH ? renderDateEditPanel(date, notes) : '';
  const body = images.length
    ? images.map((img) => renderImageItem(img, date)).join('')
    : '<p class="hint">该日期暂无镜像</p>';
  return `<div class="date-group" data-date="${escapeHtml(date)}">${adminHeader}${notesHtml}${adminPanel}${body}</div>`;
}

function renderSingleDateBlock(date, images, notesTrimmed) {
  const notesHtml = notesTrimmed
    ? `<div class="group-release-notes announcement-md">${renderAnnouncementMarkdown(notesTrimmed)}</div>`
    : '';
  const adminHeader =
    IS_ADMIN_VIEW && IS_ADMIN_AUTH
      ? `<div class="date-group-header"><div class="date-group-title">${escapeHtml(date)}</div><button type="button" class="btn-edit-entry js-toggle-date-edit" data-date="${escapeHtml(date)}">管理</button></div>`
      : `<div class="date-group-title">${escapeHtml(date)}</div>`;
  const adminPanel = IS_ADMIN_VIEW && IS_ADMIN_AUTH ? renderDateEditPanel(date, notesTrimmed) : '';
  const body = images.length
    ? images.map((img) => renderImageItem(img, date)).join('')
    : '<p class="hint">该日期暂无镜像</p>';
  return `<div class="date-group" data-date="${escapeHtml(date)}">${adminHeader}${notesHtml}${adminPanel}${body}</div>`;
}

function bindCompactDropZone(dropEl, fileInput, onFiles) {
  if (!dropEl || !fileInput) return;
  ['dragenter', 'dragover'].forEach((ev) => {
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropEl.classList.remove('drag-over');
    });
  });
  dropEl.addEventListener('drop', (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
  dropEl.addEventListener('click', () => fileInput.click());
}

function bindDateGroupEditors(root) {
  if (!root || !IS_ADMIN_VIEW || !IS_ADMIN_AUTH) return;
  root.querySelectorAll('.js-toggle-date-edit').forEach((btn) => {
    btn.onclick = () => {
      const group = btn.closest('.date-group');
      const panel = group && group.querySelector('.js-date-edit-panel');
      if (panel) panel.classList.toggle('hidden');
    };
  });
  root.querySelectorAll('.js-save-release-notes').forEach((btn) => {
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
  root.querySelectorAll('.js-date-upload-btn').forEach((btn) => {
    btn.onclick = async () => {
      const group = btn.closest('.date-group');
      const input = group && group.querySelector('.js-date-file');
      if (!input) return;
      await doAdminUploadToTarget(input.files, btn.dataset.date, btn);
      input.value = '';
    };
  });
  root.querySelectorAll('.js-date-drop').forEach((drop) => {
    if (drop.dataset.dropBound === '1') return;
    drop.dataset.dropBound = '1';
    const group = drop.closest('.date-group');
    const input = group && group.querySelector('.js-date-file');
    const date = drop.dataset.date;
    if (!input || !date) return;
    bindCompactDropZone(drop, input, (files) => doAdminUploadToTarget(files, date));
  });
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    const token = getAdminToken();
    if (token) xhr.setRequestHeader('X-Admin-Token', token);
    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch (_) {}
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body,
      });
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(formData);
  });
}

async function doAdminUploadToTarget(files, target, triggerBtn) {
  if (!files || !files.length) {
    alert('请先选择文件');
    return;
  }
  const originalText = triggerBtn ? triggerBtn.textContent : '';
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.classList.add('is-loading');
    triggerBtn.textContent = '上传中 0%';
  }
  try {
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append('file', files[i]);
    let url = `${API}/admin/upload?target=${encodeURIComponent(target)}`;
    if (target === 'stable') {
      const cat = document.getElementById('stableCategorySelect')?.value || 'default';
      url += `&category=${encodeURIComponent(cat)}`;
    }
    const result = await uploadWithProgress(url, fd, (percent) => {
      if (triggerBtn) triggerBtn.textContent = `上传中 ${percent}%`;
    });
    const data = result.body || {};
    if (result.ok && data.saved && data.saved.length) {
      const d = document.getElementById('dateSelect')?.value || '';
      await Promise.all([loadStableImages(), loadImages(d)]);
      alert(`已上传 ${data.saved.length} 个文件`);
    } else if (!result.ok) {
      if (result.status === 413) {
        alert('上传失败：文件超过服务端大小限制');
        return;
      }
      alert(data.error || '上传失败');
    } else {
      alert('未保存任何文件，请检查格式');
    }
  } catch (err) {
    alert('上传请求失败: ' + (err.message || err));
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.classList.remove('is-loading');
      triggerBtn.textContent = originalText || '上传';
    }
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
  const addCatBtn = document.getElementById('stableAddCategoryBtn');
  if (!toggle || !panel || !drop || !input || !btn) return;
  toggle.onclick = () => panel.classList.toggle('hidden');
  btn.onclick = async () => {
    await doAdminUploadToTarget(input.files, 'stable', btn);
    input.value = '';
  };
  bindCompactDropZone(drop, input, (files) => doAdminUploadToTarget(files, 'stable'));
  if (addCatBtn) {
    addCatBtn.onclick = async () => {
      const idInput = document.getElementById('stableNewCategoryId');
      const id = (idInput && idInput.value.trim()) || '';
      if (!id) {
        alert('请输入分类 id');
        return;
      }
      const r = await fetchWithAdmin(`${API}/admin/stable/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        if (idInput) idInput.value = '';
        await loadStableImages();
        const sel = document.getElementById('stableCategorySelect');
        if (sel && data.id) sel.value = data.id;
        alert('分类已添加');
      } else {
        alert(data.error || '添加失败');
      }
    };
  }
}

function bindDeleteButtons(root) {
  if (!root) return;
  root.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('确定删除该镜像？')) return;
      const filename = btn.dataset.filename;
      let r;
      if (btn.dataset.stable === '1') {
        const cat = btn.dataset.category || 'default';
        r = await fetchWithAdmin(
          `${API}/admin/image/stable/${encodeURIComponent(cat)}/${encodeURIComponent(filename)}`,
          { method: 'DELETE' }
        );
      } else {
        const date = btn.dataset.date;
        r = await fetchWithAdmin(`${API}/admin/image/${encodeURIComponent(date)}/${encodeURIComponent(filename)}`, {
          method: 'DELETE',
        });
      }
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

/** 当前页面滚动偏移（pageYOffset 优先，避免仅用 scrollY 在个别环境下的偏差） */
function getPageScrollTop() {
  const se = document.scrollingElement || document.documentElement;
  const y =
    window.pageYOffset ??
    window.scrollY ??
    se.scrollTop ??
    document.body.scrollTop ??
    0;
  return typeof y === 'number' ? y : 0;
}

function canTriggerPullRefresh(section) {
  if (getPageScrollTop() > 2) return false;
  const sec = section || document.getElementById('imagesSection');
  if (sec && sec.scrollTop > 2) return false;
  return true;
}

/** 从按钮、链接、表单控件开始的指针不当作下拉手势；右侧固定栏内手势不参与（避免与栏内滚动冲突） */
function shouldIgnorePullPointerTarget(target) {
  if (!target || !target.closest) return false;
  const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  if (!el) return false;
  if (el.closest('#imagesListScroll')) return true;
  if (el.closest('.right-sidebar')) return true;
  return !!el.closest(
    'button, a, input, select, textarea, label, [role="button"], option'
  );
}

function normalizeWheelDeltaY(e) {
  const dy = Math.abs(e.deltaY);
  if (e.deltaMode === 1) return dy * 16;
  if (e.deltaMode === 2) return dy * 900;
  return dy;
}

/** 滚轮刷新：跳过侧栏与表单区域，避免与局部滚动冲突 */
function shouldIgnoreWheelPullTarget(target) {
  if (!target || !target.closest) return false;
  const el = target.nodeType === Node.TEXT_NODE ? target.parentElement : target;
  if (!el) return false;
  if (el.closest('#imagesListScroll')) return true;
  if (el.closest('.right-sidebar')) return true;
  return !!el.closest(
    'textarea, input, select, [contenteditable="true"], .build-log'
  );
}

function attachWheelPullRefresh(section) {
  let accum = 0;
  let idleTimer = null;
  const hint = document.getElementById('pullHint');

  window.addEventListener(
    'wheel',
    (e) => {
      if (isRefreshing) return;
      if (!canTriggerPullRefresh(section)) {
        accum = 0;
        return;
      }
      if (shouldIgnoreWheelPullTarget(e.target)) {
        accum = 0;
        return;
      }
      if (e.deltaY > 2) {
        accum = 0;
        return;
      }

      accum += normalizeWheelDeltaY(e);

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        accum = 0;
        idleTimer = null;
        if (hint && !isRefreshing && hint.textContent !== '刷新中') {
          hint.textContent = PULL_HINT_IDLE;
        }
      }, 520);

      if (accum >= 55) {
        accum = 0;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        doRefresh();
      }
    },
    { passive: true }
  );
}

async function doRefresh() {
  const hint = document.getElementById('pullHint');
  if (!hint || isRefreshing) return;
  if (refreshResetTimer) {
    clearTimeout(refreshResetTimer);
    refreshResetTimer = null;
  }
  isRefreshing = true;
  hint.textContent = '刷新中';
  hint.classList.add('refreshing', 'is-loading');
  const date = document.getElementById('dateSelect').value;
  try {
    await Promise.all([loadStableImages(), loadImages(date), loadAnnouncement()]);
    hint.textContent = '已更新';
    hint.classList.remove('is-loading');
    hint.classList.add('refresh-done');
    refreshResetTimer = setTimeout(() => {
      hint.textContent = PULL_HINT_IDLE;
      hint.classList.remove('refreshing', 'refresh-done');
      refreshResetTimer = null;
    }, 1200);
  } finally {
    isRefreshing = false;
    if (!refreshResetTimer) {
      hint.textContent = PULL_HINT_IDLE;
      hint.classList.remove('refreshing', 'is-loading', 'refresh-done');
    }
  }
}

function setupPullRefresh() {
  const section = document.getElementById('imagesSection');
  const hint = document.getElementById('pullHint');
  if (!section || !hint || pullRefreshBound) return;
  pullRefreshBound = true;
  let startY = 0;
  let pulling = false;
  let activePointerId = null;

  hint.addEventListener('click', (e) => {
    if (suppressPullHintClick) {
      e.preventDefault();
      return;
    }
    doRefresh();
  });

  const tryArmPull = (e) => {
    if (!e.isPrimary) return false;
    if (e.pointerType === 'mouse' && e.button !== 0) return false;
    if (!canTriggerPullRefresh(section) || isRefreshing) return false;
    if (shouldIgnorePullPointerTarget(e.target)) return false;
    activePointerId = e.pointerId;
    pulling = true;
    startY = e.clientY;
    return true;
  };

  const onPointerDown = (e) => {
    tryArmPull(e);
  };

  const onPointerMove = (e) => {
    if (activePointerId == null || e.pointerId !== activePointerId) return;
    if (!pulling || isRefreshing) return;
    if (!canTriggerPullRefresh(section)) {
      pulling = false;
      activePointerId = null;
      hint.textContent = PULL_HINT_IDLE;
      return;
    }
    if (e.clientY - startY > 28) {
      hint.textContent = '释放刷新';
    } else {
      hint.textContent = PULL_HINT_IDLE;
    }
  };

  const onPointerUp = (e) => {
    if (activePointerId == null || e.pointerId !== activePointerId) return;
    const wasPulling = pulling;
    pulling = false;
    activePointerId = null;
    if (!wasPulling || isRefreshing) return;
    const endY = e.clientY;
    if (endY - startY > 48) {
      suppressPullHintClick = true;
      setTimeout(() => {
        suppressPullHintClick = false;
      }, 480);
      doRefresh();
    } else {
      hint.textContent = PULL_HINT_IDLE;
    }
  };

  const onPointerCancel = (e) => {
    if (activePointerId == null || e.pointerId !== activePointerId) return;
    activePointerId = null;
    pulling = false;
    if (!isRefreshing && hint) hint.textContent = PULL_HINT_IDLE;
  };

  if (window.PointerEvent) {
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  } else {
    let touchStartY = 0;
    let touchPulling = false;
    window.addEventListener(
      'touchstart',
      (ev) => {
        if (!ev.touches || ev.touches.length !== 1) return;
        if (!canTriggerPullRefresh(section) || isRefreshing) {
          touchPulling = false;
          return;
        }
        if (shouldIgnorePullPointerTarget(ev.target)) {
          touchPulling = false;
          return;
        }
        touchPulling = true;
        touchStartY = ev.touches[0].clientY;
      },
      { passive: true }
    );
    window.addEventListener(
      'touchmove',
      (ev) => {
        if (!touchPulling || isRefreshing) return;
        if (!canTriggerPullRefresh(section)) {
          touchPulling = false;
          hint.textContent = PULL_HINT_IDLE;
          return;
        }
        if (!ev.touches || ev.touches.length < 1) return;
        if (ev.touches[0].clientY - touchStartY > 28) hint.textContent = '释放刷新';
        else hint.textContent = PULL_HINT_IDLE;
      },
      { passive: true }
    );
    window.addEventListener(
      'touchend',
      (ev) => {
        if (!touchPulling || isRefreshing) return;
        touchPulling = false;
        const t = ev.changedTouches && ev.changedTouches[0];
        const endY = t ? t.clientY : touchStartY;
        if (endY - touchStartY > 48) {
          suppressPullHintClick = true;
          setTimeout(() => {
            suppressPullHintClick = false;
          }, 480);
          doRefresh();
        } else {
          hint.textContent = PULL_HINT_IDLE;
        }
      },
      { passive: true }
    );
    window.addEventListener(
      'touchcancel',
      () => {
        touchPulling = false;
        if (!isRefreshing && hint) hint.textContent = PULL_HINT_IDLE;
      },
      { passive: true }
    );
  }

  attachWheelPullRefresh(section);
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
  setupImagesListInfiniteScroll();

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
    el.innerHTML = log
      .reverse()
      .map(
        (r) => `
      <div class="build-record">
        <strong>${escapeHtml(r.name)}</strong> · 
        <span class="status ${r.status.includes('fail') ? 'failed' : 'success'}">${escapeHtml(r.status)}</span> ·
        ${r.time}
        ${r.artifacts?.length ? `<br>产物: ${r.artifacts.join(', ')}` : ''}
      </div>
    `
      )
      .join('');
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
    const ok = await fetchWithAdmin(`${API}/admin/verify`).then((r) => r.ok);
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
    const r = await fetch(`${API}/admin/verify`, {
      headers: { 'X-Admin-Token': token },
    });
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
  document.querySelectorAll('.nav-link').forEach((a) => {
    a.classList.toggle(
      'active',
      (path === '/' && a.href.endsWith('/')) || (path === '/admin' && a.href.endsWith('/admin'))
    );
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

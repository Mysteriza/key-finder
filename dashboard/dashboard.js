const $ = (s, p) => (p || document).querySelector(s);
const $$ = (s, p) => [...(p || document).querySelectorAll(s)];

let findingsData = {};
let allFindingsFlat = [];
let settings = {};
let currentDetail = null;
let currentPage = 1;
let currentDomainTab = '';
const PAGE_SIZE = 15;

const VERIFIABLE_IDS = ['openai', 'anthropic', 'google-ai', 'huggingface', 'replicate', 'github-token', 'stripe-live', 'stripe-test'];

async function verifyKey(finding) {
  const result = await KeyValidator.validate(finding.value, finding.patternId);
  renderFindings();
}

async function autoVerifyKeys() {
  const keys = allFindingsFlat.filter(f =>
    VERIFIABLE_IDS.includes(f.patternId) && !KeyValidator._cache[f.patternId + ':' + f.value]
  );
  if (keys.length === 0) return;
  await Promise.allSettled(keys.map(k => KeyValidator.validate(k.value, k.patternId)));
  renderFindings();
}

async function init() {
  await loadTheme();
  await loadFindings();
  await loadSettings();
  renderOverview();
  renderDomainTabs();
  renderFindings();
  bindNav();
  bindFilters();
  bindActions();
  bindPagination();
  autoVerifyKeys();
}

function loadTheme() {
  const saved = localStorage.getItem('kf-theme');
  if (saved === 'light') {
    document.documentElement.removeAttribute('data-theme');
    updateThemeIcon(false);
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    updateThemeIcon(true);
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('kf-theme', 'light');
    updateThemeIcon(false);
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('kf-theme', 'dark');
    updateThemeIcon(true);
  }
}

function updateThemeIcon(dark) {
  const p = $('#theme-path');
  if (dark) {
    p.setAttribute('d', 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.83-1.63 5.39 5.39 0 0 1-1.5-4.28A5.4 5.4 0 0 1 12 3z');
  } else {
    p.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
  }
}

async function loadFindings() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_FINDINGS' });
  findingsData = resp?.findings || {};
  allFindingsFlat = [];
  for (const [domain, list] of Object.entries(findingsData)) {
    for (const f of list) {
      allFindingsFlat.push({ ...f, domain });
    }
  }
}

async function loadSettings() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  settings = resp?.settings || {};
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  const d = Math.floor(hr / 24);
  return d + 'd';
}

function renderOverview() {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const domainCounts = {};

  for (const f of allFindingsFlat) {
    const sev = f.severity || 'low';
    if (bySeverity[sev] !== undefined) bySeverity[sev]++;
    domainCounts[f.domain] = (domainCounts[f.domain] || 0) + 1;
  }

  const total = allFindingsFlat.length;
  $('#stat-total').textContent = total;
  $('#stat-critical').textContent = bySeverity.critical;
  $('#stat-high').textContent = bySeverity.high;
  $('#stat-medium').textContent = bySeverity.medium;
  $('#stat-low').textContent = bySeverity.low;
  $('#stat-info').textContent = bySeverity.info;
  $('#stat-domains').textContent = Object.keys(domainCounts).length;

  const sorted = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]);
  $('#domain-list').innerHTML = sorted.map(([d, c]) =>
    `<span class="domain-chip" data-domain="${esc(d)}">${esc(d)} <span class="count">${c}</span></span>`
  ).join('');

  $$('.domain-chip').forEach(el => {
    el.addEventListener('click', () => {
      currentDomainTab = el.dataset.domain;
      currentPage = 1;
      $('#filter-domain').value = '';
      $('#filter-search').value = '';
      switchView('findings');
      renderDomainTabs();
      renderFindings();
    });
  });

  const maxSev = Math.max(...Object.values(bySeverity), 1);
  for (const sev of ['critical', 'high', 'medium', 'low', 'info']) {
    const el = $(`#bar-${sev}`);
    if (el) {
      el.textContent = bySeverity[sev];
      el.closest('.bar-item').querySelector('.bar-fill').style.width = (bySeverity[sev] / maxSev) * 100 + '%';
    }
  }

  $('#nav-count').textContent = total;
}

function renderDomainTabs() {
  const domains = Object.keys(findingsData).sort();
  const container = $('#domain-tabs');
  if (domains.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = '<button class="tab' + (currentDomainTab === '' ? ' active' : '') + '" data-domain="">All</button>' +
    domains.map(d =>
      '<button class="tab' + (currentDomainTab === d ? ' active' : '') + '" data-domain="' + esc(d) + '">' + esc(d) + '</button>'
    ).join('');
  container.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => {
      currentDomainTab = el.dataset.domain;
      currentPage = 1;
      renderDomainTabs();
      $('#filter-domain').value = '';
      $('#filter-search').value = '';
      renderFindings();
    });
  });
}

function getFilteredFindings() {
  const search = ($('#filter-search').value || '').toLowerCase();
  const severity = $('#filter-severity').value;
  const domain = currentDomainTab || $('#filter-domain').value;
  const category = $('#filter-category').value;

  let filtered = allFindingsFlat;
  if (search) filtered = filtered.filter(f =>
    (f.name || '').toLowerCase().includes(search) ||
    (f.value || '').toLowerCase().includes(search) ||
    (f.domain || '').toLowerCase().includes(search)
  );
  if (severity) filtered = filtered.filter(f => f.severity === severity);
  if (domain) filtered = filtered.filter(f => f.domain === domain);
  if (category) filtered = filtered.filter(f => f.category === category);
  return filtered;
}

function renderFindings() {
  const filtered = getFilteredFindings();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  const tbody = $('#findings-tbody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    $('#findings-empty').classList.remove('hidden');
    $('.table-wrap').classList.add('hidden');
    $('#pagination').classList.add('hidden');
    return;
  }

  $('#findings-empty').classList.add('hidden');
  $('.table-wrap').classList.remove('hidden');
  $('#pagination').classList.remove('hidden');

  pageItems.forEach((f, i) => {
    const globalIdx = start + i;
    const tr = document.createElement('tr');
    const displayVal = f.value.length > 100 ? f.value.slice(0, 100) + '...' : f.value;

    let statusHtml = '<span class="status-dash">-</span>';
    if (VERIFIABLE_IDS.includes(f.patternId)) {
      const cacheKey = f.patternId + ':' + f.value;
      const cached = KeyValidator._cache[cacheKey];
      if (cached) {
        const sl = KeyValidator.STATUS_LABELS[cached.status] || ['UNKNOWN', '#a855f7'];
        statusHtml = `<span class="gemini-status ${cached.status.toLowerCase()}" style="color:${sl[1]}">${sl[0]}</span>`;
      } else {
        statusHtml = `<button class="btn btn-verify" data-key="${esc(f.value)}" data-pattern="${f.patternId}" title="Test this key against the API">Verify</button>`;
      }
    }

    tr.innerHTML = `
      <td><span class="sev-dot ${f.severity || 'low'}"></span></td>
      <td class="type-cell" title="${esc(f.name)}">${esc(f.name).slice(0, 36)}</td>
      <td>${esc(f.category || '-')}</td>
      <td><div class="value-cell clickable" data-idx="${globalIdx}" title="Click to view full value">${esc(displayVal)}</div></td>
      <td class="domain-cell">${esc(f.domain)}</td>
      <td class="time-cell">${f.detectedAt ? timeAgo(f.detectedAt) : '-'}</td>
      <td class="status-cell">${statusHtml}</td>
      <td>
        <button class="btn-icon copy-btn" title="Copy value">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </td>
    `;

    const verifyBtn = tr.querySelector('.btn-verify');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        verifyBtn.textContent = 'Testing…';
        verifyBtn.disabled = true;
        await KeyValidator.validate(verifyBtn.dataset.key, verifyBtn.dataset.pattern);
        renderFindings();
      });
    }
    tr.querySelector('.value-cell').addEventListener('click', () => showModal(f));
    const btn = tr.querySelector('.copy-btn');
    const copyVal = f.value.split(' = ').pop() || f.value;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(copyVal);
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 1200);
    });
    tbody.appendChild(tr);
  });

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = $('#page-numbers');
  container.innerHTML = '';
  if (totalPages <= 1) {
    $('#page-prev').disabled = true;
    $('#page-next').disabled = true;
    return;
  }

  $('#page-prev').disabled = currentPage <= 1;
  $('#page-next').disabled = currentPage >= totalPages;

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  pages.forEach(p => {
    if (p === '...') {
      const span = document.createElement('span');
      span.className = 'page-ellipsis';
      span.textContent = '…';
      container.appendChild(span);
    } else {
      const btn = document.createElement('button');
      btn.className = 'page-num' + (p === currentPage ? ' active' : '');
      btn.textContent = p;
      btn.addEventListener('click', () => { currentPage = p; renderFindings(); });
      container.appendChild(btn);
    }
  });
}

function bindPagination() {
  $('#page-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderFindings(); }
  });
  $('#page-next').addEventListener('click', () => {
    const filtered = getFilteredFindings();
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    if (currentPage < totalPages) { currentPage++; renderFindings(); }
  });
}

function renderSettings() {
  $('#set-scanSource').checked = settings.scanSource !== false;
  $('#set-scanStorage').checked = settings.scanStorage !== false;
  $('#set-scanExternalJS').checked = settings.scanExternalJS !== false;
  $('#set-scanSourcemap').checked = settings.scanSourcemap !== false;
  $('#set-scanEndpoints').checked = settings.scanEndpoints !== false;
  $('#set-autoScan').checked = settings.autoScan !== false;
  $('#set-maxEndpoints').value = settings.maxEndpointsPerDomain || 8;
  $('#set-blacklist').value = (settings.blacklistedDomains || []).join('\n');
}

function saveSettings() {
  const newSettings = {
    scanSource: $('#set-scanSource').checked,
    scanStorage: $('#set-scanStorage').checked,
    scanExternalJS: $('#set-scanExternalJS').checked,
    scanSourcemap: $('#set-scanSourcemap').checked,
    scanEndpoints: $('#set-scanEndpoints').checked,
    autoScan: $('#set-autoScan').checked,
    maxEndpointsPerDomain: parseInt($('#set-maxEndpoints').value) || 8,
    blacklistedDomains: $('#set-blacklist').value.split('\n').map(s => s.trim()).filter(Boolean),
  };

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: newSettings });
  const status = $('#settings-status');
  status.textContent = 'Saved';
  status.classList.add('visible');
  setTimeout(() => status.classList.remove('visible'), 2000);
}

function updateFilterOptions() {
  const domains = [...new Set(allFindingsFlat.map(f => f.domain))];
  const categories = [...new Set(allFindingsFlat.map(f => f.category).filter(Boolean))];

  $('#filter-domain').innerHTML = '<option value="">All Domains</option>' +
    domains.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

  $('#filter-category').innerHTML = '<option value="">All Categories</option>' +
    categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function switchView(view) {
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  $(`.nav-item[data-view="${view}"]`).classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');

  const titles = { overview: 'Overview', findings: 'Findings', settings: 'Settings' };
  $('#view-title').textContent = titles[view] || view;

  if (view === 'settings') renderSettings();
  if (view === 'findings') { updateFilterOptions(); renderDomainTabs(); renderFindings(); }
  if (view === 'overview') renderOverview();
}

function bindNav() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      currentPage = 1;
      switchView(item.dataset.view);
    });
  });
}

function bindFilters() {
  ['#filter-search', '#filter-severity', '#filter-domain', '#filter-category'].forEach(id => {
    $(id).addEventListener('input', () => { currentPage = 1; renderFindings(); });
    $(id).addEventListener('change', () => { currentPage = 1; renderFindings(); });
  });
}

function bindActions() {
  $('#btn-theme').addEventListener('click', toggleTheme);

  $('#btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Clear all findings from all domains?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
    await loadFindings();
    currentPage = 1;
    renderOverview();
    renderDomainTabs();
    renderFindings();
  });

  $('#btn-clear-cache').addEventListener('click', async () => {
    await chrome.storage.local.remove('scanCache');
    const status = $('#settings-status');
    status.textContent = 'Cache cleared';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });

  $('#btn-export').addEventListener('click', () => {
    const data = JSON.stringify(allFindingsFlat, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'key-finder-export.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#settings-save').addEventListener('click', saveSettings);
  $('#settings-clear-all').addEventListener('click', async () => {
    if (!confirm('Clear all findings?')) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_ALL' });
    await loadFindings();
    currentPage = 1;
    renderOverview();
    renderDomainTabs();
    renderFindings();
  });

  $('#settings-clear-cache').addEventListener('click', async () => {
    await chrome.storage.local.remove('scanCache');
    KeyValidator._cache = {};
    const status = $('#settings-status');
    status.textContent = 'Cache cleared';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });

  $('#settings-reset').addEventListener('click', async () => {
    if (!confirm('Reset all settings to defaults?')) return;
    await chrome.storage.local.remove('settings');
    await loadSettings();
    renderSettings();
    const status = $('#settings-status');
    status.textContent = 'Defaults restored';
    status.classList.add('visible');
    setTimeout(() => status.classList.remove('visible'), 2000);
  });
}

function showModal(finding) {
  currentDetail = finding;
  $('#modal-name').textContent = finding.name;
  const sevEl = $('#modal-severity');
  sevEl.textContent = finding.severity || 'low';
  sevEl.className = 'modal-sev ' + (finding.severity || 'low');
  $('#modal-value').textContent = finding.value;
  $('#modal-context').textContent = finding.context || '-';
  $('#modal-domain').textContent = 'Domain: ' + (finding.domain || '-');
  $('#modal-source').textContent = 'Source: ' + (finding.source || '-');
  $('#modal-time').textContent = finding.detectedAt ? new Date(finding.detectedAt).toLocaleString() : '';
  $('#detail-modal').classList.remove('hidden');
}

function hideModal() {
  $('#detail-modal').classList.add('hidden');
}

$('#modal-close').addEventListener('click', hideModal);
$('#detail-modal').addEventListener('click', (e) => {
  if (e.target === $('#detail-modal') || e.target.classList.contains('modal-backdrop')) hideModal();
});
$('#modal-copy').addEventListener('click', () => {
  if (currentDetail) {
    navigator.clipboard.writeText(currentDetail.value.split(' = ').pop() || currentDetail.value);
    $('#modal-copy').textContent = 'Copied!';
    setTimeout(() => {
      $('#modal-copy').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy Value`;
    }, 1200);
  }
});

document.addEventListener('DOMContentLoaded', init);

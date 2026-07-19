const el = (id) => document.getElementById(id);

let currentDetail = null;

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
  const p = el('popup-theme-path');
  if (dark) {
    p.setAttribute('d', 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.83-1.63 5.39 5.39 0 0 1-1.5-4.28A5.4 5.4 0 0 1 12 3z');
  } else {
    p.setAttribute('d', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
  }
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadFindings() {
  const tab = await getCurrentTab();
  if (!tab?.url) { showEmpty(); return; }

  let domain;
  try { domain = new URL(tab.url).hostname; } catch { showEmpty(); return; }

  el('domain-badge').textContent = domain;

  const msg = await chrome.runtime.sendMessage({ type: 'GET_FINDINGS' });
  const findings = msg?.findings || {};
  const domainFindings = findings[domain];

  if (!domainFindings || domainFindings.length === 0) {
    el('loading').classList.add('hidden');
    showEmpty();
    return;
  }

  el('loading').classList.add('hidden');
  el('empty').classList.add('hidden');
  el('findings-list').classList.remove('hidden');
  el('btn-clear').classList.remove('hidden');

  const bySeverity = { critical: [], high: [], medium: [], low: [] };
  for (const f of domainFindings) {
    const sev = f.severity || 'low';
    if (bySeverity[sev]) bySeverity[sev].push(f);
  }

  const sorted = [...bySeverity.critical, ...bySeverity.high, ...bySeverity.medium, ...bySeverity.low];

  const badge = el('domain-badge');
  badge.textContent = domain + ' (' + sorted.length + ')';
  badge.className = 'has' + (bySeverity.critical.length > 0 ? ' has-critical' : '');

  const list = el('findings-list');
  list.innerHTML = '';

  for (const f of sorted) {
    const item = document.createElement('div');
    item.className = 'finding-item';
    const displayVal = f.value.length > 120 ? f.value.slice(0, 120) + '...' : f.value;
    item.innerHTML = `
      <div class="severity-line ${f.severity || 'low'}"></div>
      <div class="finding-body">
        <div class="finding-name" title="${esc(f.name)}">${esc(f.name)}</div>
        <div class="finding-value" title="${esc(f.value)}">${esc(displayVal)}</div>
      </div>
    `;
    item.addEventListener('click', () => showDetail(f));
    list.appendChild(item);
  }
}

function showEmpty() {
  el('loading').classList.add('hidden');
  el('empty').classList.remove('hidden');
  el('findings-list').classList.add('hidden');
  el('btn-clear').classList.add('hidden');
}

function showDetail(finding) {
  currentDetail = finding;
  el('detail-name').textContent = finding.name;
  const sevEl = el('detail-severity');
  sevEl.textContent = finding.severity || 'low';
  sevEl.className = 'overlay-sev ' + (finding.severity || 'low');
  el('detail-value').textContent = finding.value;
  el('detail-context').textContent = finding.context || '-';
  el('detail-domain').textContent = 'Domain: ' + (finding.domain || '-');
  el('detail-source').textContent = 'Source: ' + (finding.source || '-');
  el('detail-time').textContent = finding.detectedAt ? new Date(finding.detectedAt).toLocaleString() : '';
  el('detail-overlay').classList.remove('hidden');
}

function hideDetail() {
  el('detail-overlay').classList.add('hidden');
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

el('btn-dashboard').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

el('btn-clear').addEventListener('click', async () => {
  const tab = await getCurrentTab();
  if (!tab?.url) return;
  let domain;
  try { domain = new URL(tab.url).hostname; } catch { return; }
  await chrome.runtime.sendMessage({ type: 'CLEAR_DOMAIN', domain });
  loadFindings();
});

el('detail-close').addEventListener('click', hideDetail);
el('detail-overlay').addEventListener('click', (e) => {
  if (e.target === el('detail-overlay') || e.target.classList.contains('overlay-backdrop')) hideDetail();
});

el('detail-copy').addEventListener('click', () => {
  if (currentDetail) {
    navigator.clipboard.writeText(currentDetail.value.split(' = ').pop() || currentDetail.value);
    el('detail-copy').textContent = 'Copied!';
    setTimeout(() => {
      el('detail-copy').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
    }, 1200);
  }
});

el('popup-theme').addEventListener('click', toggleTheme);

document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  loadFindings();
});

importScripts('lib/patterns.js', 'lib/storage.js', 'lib/scanner.js');

const SCAN_CACHE = {};

async function probeEndpoint(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const text = await resp.text();
    if (!text || text.length < 10 || text.length > 500000) return null;

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('text/html') && !url.match(/\.(php|html?)$/i)) return null;

    const trimmed = text.trim();
    if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || trimmed.startsWith('<script')) return null;

    return { url, text, status: resp.status, contentType };
  } catch {
    return null;
  }
}

async function probeDomain(domain, settings) {
  if (SCAN_CACHE[domain]) return [];
  SCAN_CACHE[domain] = true;

  const maxPaths = settings?.maxEndpointsPerDomain || 8;
  const results = [];

  for (const path of ENDPOINT_PATHS.slice(0, maxPaths)) {
    const fullUrl = domain.endsWith('/') ? domain.slice(0, -1) + path : 'https://' + domain + path;
    const result = await probeEndpoint(fullUrl);
    if (result) results.push(result);
    await new Promise(r => setTimeout(r, 300));
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SCAN_RESULTS') {
    handleScanResults(sender.tab?.id, message.domain, message.findings);
    sendResponse({ ok: true });
  }

  if (message.type === 'SCAN_ENDPOINTS') {
    (async () => {
      const s = await Storage.getSettings();
      const results = await probeDomain(message.domain, s);
      const findings = [];

      for (const result of results) {
        const scannerFindings = Scanner.scanText(result.text, result.url);
        findings.push({
          patternId: 'exposed-file-' + result.url,
          name: 'Exposed File: ' + result.url.split('/').pop(),
          category: 'Exposed File',
          severity: result.url.includes('.env') || result.url.includes('credential') || result.url.includes('secret') ? 'critical' : 'high',
          value: result.url + ' (HTTP ' + result.status + ', ' + result.text.length + ' bytes)',
          context: 'File found and publicly accessible: ' + result.url,
          source: result.url,
        });
        findings.push(...scannerFindings.map(f => ({
          ...f,
          severity: result.url.includes('.env') || result.url.includes('credential') ? 'critical' : f.severity,
        })));
      }

      if (findings.length > 0) {
        await Storage.addFindings(null, message.domain, findings);
        chrome.tabs.sendMessage(sender.tab?.id, {
          type: 'ENDPOINT_FINDINGS',
          findings,
          domain: message.domain,
        }).catch(() => {});
      }
      sendResponse({ ok: true, count: findings.length });
    })();
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    sendResponse({ ok: true });
  }

  if (message.type === 'GET_FINDINGS') {
    (async () => {
      const { findings = {} } = await Storage.get('findings');
      sendResponse({ findings });
    })();
    return true;
  }

  if (message.type === 'CLEAR_DOMAIN') {
    (async () => {
      await Storage.clearDomain(message.domain);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'CLEAR_ALL') {
    (async () => {
      await Storage.clearAll();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'GET_STATS') {
    (async () => {
      const stats = await Storage.getStats();
      sendResponse({ stats });
    })();
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    (async () => {
      await Storage.saveSettings(message.settings);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    (async () => {
      const s = await Storage.getSettings();
      sendResponse({ settings: s });
    })();
    return true;
  }
});

async function handleScanResults(tabId, domain, findings) {
  if (!findings || findings.length === 0) return;
  await Storage.addFindings(tabId, domain, findings);
  updateBadge(tabId);
}

async function updateBadge(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return;
    let domain;
    try { domain = new URL(tab.url).hostname; } catch { return; }
    const { findings = {} } = await Storage.get('findings');
    const list = findings[domain] || [];
    const criticals = list.filter(f => f.severity === 'critical').length;
    const count = list.length > 0 ? String(list.length) : '';
    chrome.action.setBadgeText({ text: count, tabId });
    if (criticals > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
    } else if (list.length > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#d97706', tabId });
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#6b7280', tabId });
    }
  } catch {}
}

chrome.tabs.onActivated.addListener(activeInfo => {
  updateBadge(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
    try {
      const domain = new URL(tab.url).hostname;
      delete SCAN_CACHE[domain];
    } catch {}
    updateBadge(tabId);
  }
});

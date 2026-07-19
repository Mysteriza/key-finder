(async () => {
  const url = window.location.href;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) return;

  let domain;
  try { domain = new URL(url).hostname; } catch { return; }

  const msg = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).catch(() => ({ settings: {} }));
  const userSettings = msg?.settings || {};

  if (userSettings.blacklistedDomains?.some(d => domain.includes(d))) return;

  const allFindings = [];

  if (userSettings.scanSource !== false) {
    const pageFindings = Scanner.scanPageSource(url);
    allFindings.push(...pageFindings);
  }

  if (userSettings.scanStorage !== false) {
    const storageFindings = Scanner.scanStorage();
    allFindings.push(...storageFindings);
  }

  function dedupe(arr) {
    const seen = new Set();
    return arr.filter(f => {
      const k = f.patternId + f.value.slice(0, 40);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if (allFindings.length > 0) {
    chrome.runtime.sendMessage({
      type: 'SCAN_RESULTS',
      domain,
      findings: dedupe(allFindings),
    }).catch(() => {});
  }

  if (userSettings.scanExternalJS !== false) {
    requestIdleCallback(async () => {
      const scriptFindings = await Scanner.scanExternalScripts();
      if (scriptFindings.length > 0) {
        chrome.runtime.sendMessage({
          type: 'SCAN_RESULTS',
          domain,
          findings: dedupe(scriptFindings),
        }).catch(() => {});
      }
    }, { timeout: 5000 });
  }

  if (userSettings.scanSourcemap !== false) {
    requestIdleCallback(async () => {
      const mapFindings = await Scanner.scanSourcemaps(url);
      if (mapFindings.length > 0) {
        chrome.runtime.sendMessage({
          type: 'SCAN_RESULTS',
          domain,
          findings: dedupe(mapFindings),
        }).catch(() => {});
      }
    }, { timeout: 10000 });
  }

  if (userSettings.scanEndpoints !== false) {
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'SCAN_ENDPOINTS',
        domain,
      }).catch(() => {});
    }, 2000);
  }
})();

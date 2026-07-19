const Scanner = {
  _blacklistValues: new Set([
    'your_api_key', 'your_api_secret', 'your_key', 'your_secret', 'your_token',
    'api_key', 'api_secret', 'api-key', 'api-secret',
    'xxxx', 'xxxxx', 'xxxxxxxx', '****', '*****', '********',
    'test', 'testing', 'example', 'dummy', 'placeholder',
    'changeme', 'change_me', 'change-me',
    'your-actual-api-key', 'your-google-api-key',
    'your-openai-api-key', 'your-anthropic-api-key',
    'sk-your-key-here', 'sk-placeholder',
    'REPLACE_ME', 'PUT_YOUR_KEY_HERE',
  ]),

  _isLikelyPlaceholder(value) {
    const v = value.toLowerCase().trim();
    if (v.length < 8) return true;
    if (this._blacklistValues.has(v)) return true;
    if (/^(x+|\*+|test|dummy|example|placeholder|changeme|your_)/i.test(v)) return true;
    if (/^[0-9]+$/.test(value)) return true;
    if (!this._hasCharVariety(value)) return true;
    return false;
  },

  _isNonLeakable(value, patternId) {
    if (/\$\{[^}]+\}/.test(value)) return true;
    if (patternId === 'env-pattern') {
      if (/\$\{?[A-Z_]+}?\s*=/.test(value)) return true;
      if (/\.\w+\s*=/.test(value)) return true;
      const eq = value.indexOf('=');
      if (eq !== -1) {
        const val = value.slice(eq + 1);
        if (/^[a-z]\w*\s*[,=!?]/.test(val)) return true;
        if (/^[,!?{}()[\];]/.test(val)) return true;
        if (/^(true|false|null|undefined)\b/.test(val)) return true;
        if (/^\d+\s*[,}\]]/.test(val)) return true;
      }
    }
    if (patternId === 'exposed-token') {
      if (/[Mm]odule__[a-zA-Z]+__/.test(value)) return true;
    }
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        const vals = Object.values(parsed).map(String);
        const keys = Object.keys(parsed);
        const hasSafeKeys = keys.every(k => /^(refs|cacheKey|id|name|ownerLogin|ownerType|label|url|count|timestamp|version|size|color|icon|status|type|keybind|description|state)$/i.test(k));
        const hasRealCred = vals.some(v => this._hasCharVariety(v) && v.length > 15 && /[A-Z0-9_-]{8,}/.test(v));
        if (hasSafeKeys && !hasRealCred) return true;
      }
    } catch {}
    if (/^https?:\/\//.test(value) && patternId !== 'git-credentials') {
      if (/github\.com|gitlab\.com|bitbucket\.org/.test(value) || value.length > 80) return true;
    }
    if (/^(.)\1{6,}$/.test(value.replace(/[\s_-]/g, ''))) return true;
    if (/^[a-f0-9]{6,40}$/i.test(value) && !/[A-Z]/.test(value) && !/[^0-9a-fA-F]/.test(value)) return true;
    if (patternId === 'jwt') {
      const parts = value.split('.');
      if (parts.length === 3) {
        try {
          let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          payload += '='.repeat((4 - payload.length % 4) % 4);
          const decoded = JSON.parse(atob(payload));
          const str = JSON.stringify(decoded);
          if (/urn:(app|service):/i.test(str)) return true;
          if (/^"github\.com"$/.test(JSON.stringify(decoded.iss)) && /githubusercontent\.com/.test(JSON.stringify(decoded.aud))) return true;
        } catch {}
      }
    }
    return false;
  },

  _hasCharVariety(value) {
    const hasUpper = /[A-Z]/.test(value);
    const hasLower = /[a-z]/.test(value);
    const hasDigit = /[0-9]/.test(value);
    const hasSpecial = /[^a-zA-Z0-9]/.test(value);
    const score = (hasUpper ? 1 : 0) + (hasLower ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0);
    return score >= 2;
  },

  _extractContext(text, matchIndex, matchLength) {
    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(text.length, matchIndex + matchLength + 60);
    let context = text.slice(start, end);
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    return context;
  },

  _isOwnGoogleKey(value, url) {
    if (!url) return false;
    try {
      const host = new URL(url).hostname;
      if (!host.endsWith('.google.com') && host !== 'google.com' && !host.endsWith('.gstatic.com')) return false;
    } catch { return false; }
    return /^AIza[0-9A-Za-z_-]{35}$/.test(value);
  },

  scanText(text, url) {
    if (!text || text.length < 10) return [];
    const findings = [];

    for (const pattern of PATTERNS) {
      try {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(text)) !== null) {
          const value = match[0] || match[1];
          if (!value || this._isLikelyPlaceholder(value)) continue;
          if (this._isNonLeakable(value, pattern.id)) continue;
          if (pattern.id === 'google-ai' && this._isOwnGoogleKey(value, url)) continue;

          findings.push({
            patternId: pattern.id,
            name: pattern.name,
            category: pattern.category,
            severity: pattern.severity,
            value: value,
            context: this._extractContext(text, match.index, value.length),
            source: url || 'inline',
          });
        }
      } catch (e) {
        console.warn('[KeyFinder] Regex error for', pattern.id, e);
      }
    }

    return findings;
  },

  scanElement(element, url) {
    const text = element.textContent || '';
    return this.scanText(text, url);
  },

  _isInsideHtmlAttribute(text, matchIndex, value) {
    const before = text.slice(Math.max(0, matchIndex - 60), matchIndex);
    if (/[=\s](?:href|src|action|data-url|formaction)\s*=\s*["'][^"']*$/i.test(before)) return true;
    if (/["']\s*\+\s*["'][^"']*$/i.test(before)) return true;
    return false;
  },

  scanPageSource(url) {
    const html = document.documentElement.outerHTML;
    let findings = this.scanText(html, url);
    findings = findings.filter(f => {
      const snippet = f.value.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(snippet);
      const m = re.exec(html);
      if (!m) return true;
      return !this._isInsideHtmlAttribute(html, m.index, f.value);
    });
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      findings.push(...this.scanElement(script, url));
    }
    const metas = document.querySelectorAll('meta[name][content]');
    for (const meta of metas) {
      const content = meta.getAttribute('content');
      if (content) findings.push(...this.scanText(content, url));
    }
    const comments = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, null, false);
    let comment;
    while ((comment = comments.nextNode()) && comment.nodeValue) {
      findings.push(...this.scanText(comment.nodeValue, url + ' (HTML comment)'));
    }
    return findings;
  },

  scanStorage() {
    const findings = [];
    const checks = [
      { store: 'localStorage', data: { ...localStorage } },
      { store: 'sessionStorage', data: { ...sessionStorage } },
    ];

    for (const { store, data } of checks) {
      for (const [key, value] of Object.entries(data)) {
        if (!value || value.length < 6) continue;
        let matched = false;
        for (const sp of STORAGE_KEY_PATTERNS) {
          if (sp.test(key)) { matched = true; break; }
        }
        if (!matched) continue;
        let excluded = false;
        for (const excl of STORAGE_KEY_EXCLUSIONS) {
          if (excl.test(key)) { excluded = true; break; }
        }
        if (excluded) continue;
        if (this._isLikelyPlaceholder(value)) continue;
        if (this._isNonLeakable(value, 'storage')) continue;
        if (!this._hasCharVariety(value)) continue;

        findings.push({
          patternId: 'storage-' + key,
          name: 'Storage: ' + key,
          category: 'Storage',
          severity: 'medium',
          value: key + ' = ' + value,
          context: store + ' → ' + key,
          source: store,
        });
      }
    }
    return findings;
  },

  async scanExternalScripts() {
    const findings = [];
    const scripts = document.querySelectorAll('script[src]');
    const fetched = new Set();

    for (const script of scripts) {
      const src = script.src;
      if (!src || fetched.has(src)) continue;
      fetched.add(src);
      if (src.startsWith('chrome-extension://')) continue;
      if (src.startsWith('data:')) continue;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(src, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) continue;

        const text = await resp.text();
        if (text.length > 500000) continue;
        const scriptFindings = this.scanText(text, src);
        findings.push(...scriptFindings);
      } catch (e) {
        // ignore fetch errors
      }
    }
    return findings;
  },

  async scanSourcemaps(url) {
    const findings = [];
    const html = document.documentElement.outerHTML;
    const sourceMapRegex = /\/\/#\s*sourceMappingURL=(.+)$/gm;
    let match;

    while ((match = sourceMapRegex.exec(html)) !== null) {
      let mapUrl = match[1].trim();
      if (mapUrl.startsWith('data:')) continue;
      try {
        mapUrl = new URL(mapUrl, url).href;
      } catch { continue; }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(mapUrl, { signal: controller.signal });
        clearTimeout(timeout);
        if (!resp.ok) continue;
        const text = await resp.text();
        if (text.length > 300000) continue;

        let sources = [];
        try { sources = JSON.parse(text).sources || []; } catch { continue; }
        const sourcesContent = JSON.parse(text).sourcesContent || [];

        for (let i = 0; i < sourcesContent.length; i++) {
          if (sourcesContent[i]) {
            const srcFindings = this.scanText(sourcesContent[i], sources[i] || mapUrl);
            findings.push(...srcFindings);
          }
        }
      } catch (e) {
        // ignore
      }
    }
    return findings;
  },
};

const Storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },

  async set(data) {
    return chrome.storage.local.set(data);
  },

  async remove(keys) {
    return chrome.storage.local.remove(keys);
  },

  async clear() {
    return chrome.storage.local.clear();
  },

  async addFindings(tabId, domain, newFindings) {
    const { findings = {} } = await this.get('findings');
    if (!findings[domain]) findings[domain] = [];
    const existingKeys = new Set(findings[domain].map(f => f.patternId + (f.value || '').slice(0, 40)));

    for (const f of newFindings) {
      const dedupKey = f.patternId + (f.value || '').slice(0, 40);
      if (!existingKeys.has(dedupKey)) {
        findings[domain].unshift({ ...f, id: f.id + '-' + Date.now() + Math.random().toString(36).slice(2, 6), detectedAt: Date.now() });
        existingKeys.add(dedupKey);
      }
    }

    findings[domain] = findings[domain].slice(0, 200);
    await this.set({ findings, lastScan: Date.now() });
    return findings;
  },

  async clearDomain(domain) {
    const { findings = {} } = await this.get('findings');
    delete findings[domain];
    await this.set({ findings });
    return findings;
  },

  async clearAll() {
    return this.remove('findings');
  },

  async getStats() {
    const { findings = {} } = await this.get('findings');
    const domains = Object.keys(findings);
    let total = 0;
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

    for (const domain of domains) {
      for (const f of findings[domain]) {
        total++;
        if (bySeverity[f.severity] !== undefined) bySeverity[f.severity]++;
      }
    }

    return {
      totalFindings: total,
      totalDomains: domains.length,
      domains,
      bySeverity,
    };
  },

  async saveSettings(settings) {
    const existing = await this.get('settings');
    await this.set({ settings: { ...existing.settings, ...settings } });
  },

  async getSettings() {
    const { settings } = await this.get('settings');
    return settings || {
      scanSource: true,
      scanStorage: true,
      scanSourcemap: true,
      scanExternalJS: true,
      scanEndpoints: true,
      maxEndpointsPerDomain: 8,
      autoScan: true,
      blacklistedDomains: ['localhost', '127.0.0.1', 'chrome.google.com', 'chrome://'],
    };
  },
};

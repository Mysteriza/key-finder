const KeyValidator = {
  STATUS_LABELS: {
    ACTIVE: ['ACTIVE', '#22c55e'],
    INVALID: ['INVALID', '#ef4444'],
    QUOTA: ['QUOTA', '#eab308'],
    DISABLED: ['DISABLED', '#eab308'],
    BLOCKED: ['BLOCKED', '#ef4444'],
    TIMEOUT: ['TIMEOUT', '#888'],
    ERROR: ['ERROR', '#ef4444'],
    UNKNOWN: ['UNKNOWN', '#a855f7'],
    NOT_FOUND: ['NOT_FOUND', '#ef4444'],
  },

  _cache: {},

  async validate(key, patternId) {
    const cacheKey = patternId + ':' + key;
    if (this._cache[cacheKey]) return this._cache[cacheKey];

    const checkers = {
      'openai': this._checkOpenAI,
      'anthropic': this._checkAnthropic,
      'google-ai': this._checkGoogle,
      'huggingface': this._checkHuggingFace,
      'replicate': this._checkReplicate,
      'github-token': this._checkGitHub,
      'stripe-live': this._checkStripe,
      'stripe-test': this._checkStripe,
    };

    const checker = checkers[patternId];
    if (!checker) {
      this._cache[cacheKey] = null;
      return null;
    }

    try {
      const result = await checker.call(this, key);
      this._cache[cacheKey] = result;
      return result;
    } catch {
      this._cache[cacheKey] = { status: 'ERROR', label: 'Error' };
      return this._cache[cacheKey];
    }
  },

  async _checkOpenAI(key) {
    const resp = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active' };
    if (resp.status === 401) {
      try {
        const body = JSON.parse(resp._body);
        if (body.error?.code === 'invalid_api_key') return { status: 'INVALID', label: 'Invalid Key' };
      } catch {}
      return { status: 'INVALID', label: 'Unauthorized' };
    }
    if (resp.status === 429) return { status: 'QUOTA', label: 'Rate Limited / No Quota' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },

  async _checkAnthropic(key) {
    const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages?limit=1', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1, messages: [{ role: 'user', content: 'OK' }] }),
    });
    if (resp.status === 200 || resp.status === 400) {
      if (resp.status === 400) {
        try {
          const body = JSON.parse(resp._body);
          if (body.error?.type === 'invalid_request_error' && body.error?.message?.includes('credit')) {
            return { status: 'QUOTA', label: 'No Credit' };
          }
        } catch {}
      }
      return { status: 'ACTIVE', label: 'Active' };
    }
    if (resp.status === 401) return { status: 'INVALID', label: 'Invalid Key' };
    if (resp.status === 429) return { status: 'QUOTA', label: 'Rate Limited' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },

  async _checkGoogle(key) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=' + encodeURIComponent(key);
    const payload = {
      contents: [{ parts: [{ text: 'OK' }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };
    const resp = await fetchWithTimeout(url, { method: 'POST', body: JSON.stringify(payload) });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active' };
    try {
      const body = JSON.parse(resp._body);
      const msg = (body?.error?.message || '').toLowerCase();
      if (msg.includes('not valid') || msg.includes('api key not found')) return { status: 'INVALID', label: 'Invalid Key' };
      if (msg.includes('disabled') || msg.includes('not been used')) return { status: 'DISABLED', label: 'Disabled' };
      if (resp.status === 429 || msg.includes('quota') || msg.includes('rate')) return { status: 'QUOTA', label: 'Quota Exceeded' };
      if (msg.includes('blocked')) return { status: 'BLOCKED', label: 'Blocked' };
      if (resp.status === 404 || msg.includes('not found')) return { status: 'NOT_FOUND', label: 'Not Found' };
    } catch {}
    return { status: 'UNKNOWN', label: 'HTTP ' + resp.status };
  },

  async _checkHuggingFace(key) {
    const resp = await fetchWithTimeout('https://huggingface.co/api/whoami-v2', {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active' };
    if (resp.status === 401) return { status: 'INVALID', label: 'Invalid Token' };
    if (resp.status === 403) return { status: 'BLOCKED', label: 'Forbidden' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },

  async _checkReplicate(key) {
    const resp = await fetchWithTimeout('https://api.replicate.com/v1/account', {
      headers: { Authorization: 'Token ' + key },
    });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active' };
    if (resp.status === 401) return { status: 'INVALID', label: 'Invalid Token' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },

  async _checkGitHub(key) {
    const resp = await fetchWithTimeout('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/vnd.github+json' },
    });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active' };
    if (resp.status === 401) {
      try {
        const body = JSON.parse(resp._body);
        if (body.message?.includes('bad credentials')) return { status: 'INVALID', label: 'Invalid Token' };
      } catch {}
      return { status: 'INVALID', label: 'Unauthorized' };
    }
    if (resp.status === 403) return { status: 'BLOCKED', label: 'Rate Limited / Blocked' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },

  async _checkStripe(key) {
    const mode = key.startsWith('sk_live') ? 'live' : key.startsWith('sk_test') ? 'test' : 'unknown';
    const resp = await fetchWithTimeout('https://api.stripe.com/v1/charges?limit=1', {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (resp.status === 200) return { status: 'ACTIVE', label: 'Active (' + mode + ')' };
    if (resp.status === 401) return { status: 'INVALID', label: 'Invalid Key' };
    return { status: 'ERROR', label: 'HTTP ' + resp.status };
  },
};

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(id);
    try { resp._body = await resp.text(); } catch {}
    return resp;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

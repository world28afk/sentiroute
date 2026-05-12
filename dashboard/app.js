// ── SentiRoute Dashboard — Alpine.js Component Definitions ──

document.addEventListener('alpine:init', () => {

  /* ═══════════════════════════════════════════════════════════
     Component 0: dashboard — Root component (tab state, restart banner)
     ═══════════════════════════════════════════════════════════ */
  Alpine.data('dashboard', () => ({
    activeTab: 'config',
    restartRecommended: false,

    init() {
      // Root init — child components handle their own fetch logic
    },
  }));

  /* ═══════════════════════════════════════════════════════════
     Component 1: configEditor — Config tab logic
     ═══════════════════════════════════════════════════════════ */
  Alpine.data('configEditor', () => ({
    configData: {
      server: { port: 3000, host: '127.0.0.1' },
      sentiment: {
        threshold: 0.6,
        decayRate: 0.1,
        cooldownMs: 300000,
        antiFlapMs: 60000,
        weights: {
          profanity: 0.8,
          degradation: 0.9,
          imperatives: 0.4,
          caps: 0.3,
          brevity: 0.2,
          repetition: 0.6,
        },
      },
      model_slots: {},
    },
    loading: true,
    error: '',
    saveMessage: '',
    saveError: '',
    restartRecommended: false,

    async init() {
      await this.fetchConfig();
    },

    async fetchConfig() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/dashboard/config');
        if (!res.ok) throw new Error('Failed to load config');
        this.configData = await res.json();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    async saveRuntimeParams() {
      this.saveMessage = '';
      this.saveError = '';
      try {
        const body = {
          sentiment: {
            threshold: Number(this.configData.sentiment.threshold),
            decayRate: Number(this.configData.sentiment.decayRate),
            cooldownMs: Number(this.configData.sentiment.cooldownMs),
            antiFlapMs: Number(this.configData.sentiment.antiFlapMs),
            weights: { ...this.configData.sentiment.weights },
          },
        };
        const res = await fetch('/api/dashboard/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (res.ok) {
          this.saveMessage = result.message;
          this.restartRecommended = result.restartRecommended;
        } else {
          this.saveError = result.error || 'Save failed';
          if (result.issues && result.issues.length) {
            this.saveError += ': ' + result.issues.map(i => i.path + ' ' + i.message).join('; ');
          }
        }
      } catch (e) {
        this.saveError = e.message;
      }
    },

    async saveFullConfig() {
      this.saveMessage = '';
      this.saveError = '';
      try {
        // Build model_slots payload from current editor state
        const payload = { model_slots: this.configData.model_slots };
        const res = await fetch('/api/dashboard/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (res.ok) {
          this.saveMessage = result.message;
          this.restartRecommended = result.restartRecommended;
          // Re-fetch to get sanitized config back from server
          await this.fetchConfig();
        } else {
          this.saveError = result.error || 'Save failed';
          if (result.issues && result.issues.length) {
            this.saveError += ': ' + result.issues.map(i => i.path + ' ' + i.message).join('; ');
          }
        }
      } catch (e) {
        this.saveError = e.message;
      }
    },

    // Add a new upstream to a slot
    addUpstream(slotId) {
      const slot = this.configData.model_slots[slotId];
      if (!slot) return;
      slot.upstreams.push({
        name: '',
        endpoint: 'https://api.example.com/v1',
        api_key: '',
        upstream_model: '',
        format: 'anthropic',
        timeoutMs: 120000,
      });
    },

    // Remove an upstream from a slot
    removeUpstream(slotId, index) {
      const slot = this.configData.model_slots[slotId];
      if (!slot || slot.upstreams.length <= 1) return;
      slot.upstreams.splice(index, 1);
    },

    // Mask API key for display: show first 2 + last 6, middle replaced with "..."
    maskKey(key) {
      if (!key) return '(empty)';
      if (key.length <= 8) return '***';
      return key.slice(0, 2) + '...' + key.slice(-6);
    },
  }));

  /* ═══════════════════════════════════════════════════════════
     Component 2: sentimentViewer — Sentiment state tab
     ═══════════════════════════════════════════════════════════ */
  Alpine.data('sentimentViewer', () => ({
    slots: {},
    threshold: 0.6,
    now: Date.now(),
    lastUpdated: '—',
    interval: null,
    error: '',
    loading: true,

    init() {
      this.fetchState();
      this.interval = setInterval(() => this.fetchState(), 3000);
    },

    destroy() {
      if (this.interval) clearInterval(this.interval);
    },

    async fetchState() {
      try {
        const res = await fetch('/api/dashboard/state');
        if (!res.ok) throw new Error('Failed to load state');
        const data = await res.json();
        this.slots = data.slots;
        this.threshold = data.threshold;
        this.now = Date.now();
        this.lastUpdated = new Date().toLocaleTimeString();
        this.error = '';
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    formatCooldown(until) {
      if (!until) return '—';
      const remaining = Math.max(0, until - Date.now());
      if (remaining <= 0) return 'none';
      const s = Math.floor(remaining / 1000);
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      if (m < 60) return m + 'm ' + (s % 60) + 's';
      const h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm';
    },

    getScoreClass(score) {
      if (score == null) return 'safe';
      return score > this.threshold ? 'danger' : 'safe';
    },

    async resetSlot(slotId) {
      try {
        const res = await fetch('/api/dashboard/reset/' + encodeURIComponent(slotId), { method: 'POST' });
        await res.json();
        await this.fetchState();
      } catch (e) {
        console.error('Reset failed', e);
      }
    },
  }));

  /* ═══════════════════════════════════════════════════════════
     Component 3: historyViewer — Switch history tab
     ═══════════════════════════════════════════════════════════ */
  Alpine.data('historyViewer', () => ({
    slots: {},
    loading: true,
    error: '',

    async init() {
      await this.fetchHistory();
    },

    async fetchHistory() {
      this.loading = true;
      this.error = '';
      try {
        const res = await fetch('/api/dashboard/history');
        if (!res.ok) throw new Error('Failed to load history');
        const data = await res.json();
        this.slots = data.slots;
      } catch (e) {
        this.error = e.message;
      } finally {
        this.loading = false;
      }
    },

    formatTime(ts) {
      if (!ts) return '—';
      return new Date(ts).toLocaleString();
    },
  }));
});

/* ═══════════════════════════════════════════════════════════
   Global: resetSlot — callable from any component
   ═══════════════════════════════════════════════════════════ */
window.resetSlot = async function(slotId) {
  try {
    const res = await fetch('/api/dashboard/reset/' + encodeURIComponent(slotId), { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      // Re-fetch state by triggering the sentimentViewer component
      const el = document.querySelector('[x-data="sentimentViewer()"]');
      if (el && el.__x) {
        el.__x.$data.fetchState();
      }
    }
  } catch (e) {
    console.error('Reset failed', e);
  }
};

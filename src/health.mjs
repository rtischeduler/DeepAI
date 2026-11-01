const BAD_KEY = "DA_BAD";
const BAD_TTL_MS = 6 * 3600000;

export function createBadList({ storage, now = () => Date.now(), ttl = BAD_TTL_MS, key = (entry) => String(entry) } = {}) {
  const box = () => {
    try { return storage || globalThis.localStorage || null; } catch { return null; }
  };
  const read = () => {
    const s = box();
    if (!s) return {};
    try {
      const v = JSON.parse(s.getItem(BAD_KEY));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch { return {}; }
  };
  const live = () => {
    const t = now(), out = {};
    for (const [k, ts] of Object.entries(read())) if (typeof ts === "number" && t - ts < ttl) out[k] = ts;
    return out;
  };
  return {
    has: (entry) => Object.hasOwn(live(), key(entry)),
    add(entry) {
      const s = box();
      if (!s) return;
      const v = live();
      v[key(entry)] = now();
      try { s.setItem(BAD_KEY, JSON.stringify(v)); } catch {}
    },
    clear() {
      const s = box();
      try { if (s) s.removeItem(BAD_KEY); } catch {}
    },
  };
}

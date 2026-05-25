const store = new Map();

/**
 * In-memory TTL cache for hot read paths (e.g. bank listings).
 */
export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs = 120_000) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheDeletePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function cacheClear() {
  store.clear();
}

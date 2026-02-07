// Cache wrapper utilities - Admin App
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h

export async function fetchWithCache(pathRel, ttl = DEFAULT_TTL) {
  // pathRel example: "dashboard/index.html"
  try {
    const payload = await window.githubCache.fetchFile(pathRel, ttl);
    // payload: { content, etag, fetchedAt }
    if (!payload || !payload.content) throw new Error('Empty payload');
    return { content: payload.content, etag: payload.etag || null, fromCache: false, fetchedAt: payload.fetchedAt || Date.now() };
  } catch (err) {
    // No offline fallback: surface a clear error
    const msg = navigator.onLine ? err.message || 'Fetch failed' : 'Sem ligação à internet';
    throw new Error(msg);
  }
}

export { DEFAULT_TTL };

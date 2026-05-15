function parseOriginList(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function originMatchesPattern(origin, pattern) {
  if (pattern === origin) return true;
  if (!pattern.includes('*')) return false;
  try {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(origin);
  } catch {
    return false;
  }
}

function getVercelOrigins() {
  const origins = [];
  if (process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.VERCEL_BRANCH_URL) {
    origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
  }
  return origins;
}

export function getCorsOptions() {
  const allowed = [...parseOriginList(process.env.API_CORS_ORIGIN), ...getVercelOrigins()];
  const allowVercelPreviews = process.env.API_CORS_ALLOW_VERCEL === 'true';

  if (!allowed.length && !allowVercelPreviews) {
    return { origin: true, credentials: true };
  }

  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowed.some((entry) => originMatchesPattern(origin, entry))) {
        callback(null, true);
        return;
      }

      if (allowVercelPreviews && /\.vercel\.app$/i.test(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
  };
}

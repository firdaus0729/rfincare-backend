/**
 * Public / frontend URL helpers.
 *
 * OAUTH_FRONTEND_CALLBACK supports multiple SPA callback URLs (comma-separated):
 *   https://rfincare.com/oauth/callback,https://www.rfincare.com/oauth/callback,https://app.vercel.app/oauth/callback
 *
 * The OAuth start route accepts ?return_origin=<origin> (must match one of the URLs above).
 */

export function getPublicSiteOrigin() {
  if (process.env.API_PUBLIC_URL) {
    return process.env.API_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://127.0.0.1:${process.env.API_PORT || 8080}`;
}

function parseCallbackList() {
  const raw = process.env.OAUTH_FRONTEND_CALLBACK || '';
  const urls = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (urls.length) return urls;

  if (process.env.VERCEL_URL) {
    return [`${getPublicSiteOrigin()}/oauth/callback`];
  }

  return ['http://127.0.0.1:4028/oauth/callback'];
}

/** All allowed SPA OAuth callback URLs. */
export function getOAuthFrontendCallbackUrls() {
  return parseCallbackList();
}

/** Default (first listed) callback URL. */
export function getOAuthFrontendCallback() {
  return getOAuthFrontendCallbackUrls()[0];
}

function originOfCallbackUrl(callbackUrl) {
  try {
    return new URL(callbackUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Pick callback URL for the frontend that started sign-in.
 * @param {string} [returnOrigin] e.g. https://rfincare.com
 */
export function resolveOAuthFrontendCallback(returnOrigin) {
  const urls = getOAuthFrontendCallbackUrls();
  if (!returnOrigin) return urls[0];

  const normalized = returnOrigin.replace(/\/$/, '');
  const match = urls.find((url) => originOfCallbackUrl(url) === normalized);
  return match || urls[0];
}

/** Ensure cookie-stored callback is in the allowlist. */
export function isAllowedOAuthFrontendCallback(callbackUrl) {
  const urls = getOAuthFrontendCallbackUrls();
  return urls.some((u) => u === callbackUrl);
}

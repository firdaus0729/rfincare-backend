/**
 * Public / frontend URL helpers.
 *
 * OAUTH_FRONTEND_CALLBACK supports multiple SPA callback URLs (comma-separated).
 * DB settings (oauth_global_settings) override env when configured via admin.
 */

let cachedCallbacks = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

async function loadCallbackUrls() {
  if (cachedCallbacks && Date.now() - cacheAt < CACHE_MS) {
    return cachedCallbacks;
  }
  try {
    const { getOAuthGlobalSettings } = await import('./oauthProviderSettings.js');
    const global = await getOAuthGlobalSettings();
    cachedCallbacks = global.frontendCallbackUrls?.length ? global.frontendCallbackUrls : null;
    cacheAt = Date.now();
    return cachedCallbacks;
  } catch {
    return null;
  }
}

export function getPublicSiteOrigin() {
  if (process.env.API_PUBLIC_URL) {
    return process.env.API_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://127.0.0.1:${process.env.API_PORT || 8080}`;
}

function parseCallbackListFromEnv() {
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

/** All allowed SPA OAuth callback URLs (sync — env only). */
export function getOAuthFrontendCallbackUrls() {
  return parseCallbackListFromEnv();
}

/** Async: DB admin settings with env fallback. */
export async function getOAuthFrontendCallbackUrlsAsync() {
  const fromDb = await loadCallbackUrls();
  if (fromDb?.length) return fromDb;
  return parseCallbackListFromEnv();
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
export function resolveOAuthFrontendCallback(returnOrigin, urls = getOAuthFrontendCallbackUrls()) {
  if (!returnOrigin) return urls[0];

  const normalized = returnOrigin.replace(/\/$/, '');
  const match = urls.find((url) => originOfCallbackUrl(url) === normalized);
  return match || urls[0];
}

export async function resolveOAuthFrontendCallbackAsync(returnOrigin) {
  const urls = await getOAuthFrontendCallbackUrlsAsync();
  return resolveOAuthFrontendCallback(returnOrigin, urls);
}

/** Ensure cookie-stored callback is in the allowlist. */
export function isAllowedOAuthFrontendCallback(callbackUrl, urls = getOAuthFrontendCallbackUrls()) {
  return urls.some((u) => u === callbackUrl);
}

export async function isAllowedOAuthFrontendCallbackAsync(callbackUrl) {
  const urls = await getOAuthFrontendCallbackUrlsAsync();
  return isAllowedOAuthFrontendCallback(callbackUrl, urls);
}

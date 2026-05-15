/** Cookie settings for cross-origin frontends (e.g. Vercel) calling this API (e.g. Render). */
export function useCrossSiteCookies() {
  return (
    process.env.API_COOKIE_CROSS_SITE === 'true'
    || process.env.API_COOKIE_SECURE === 'true'
    || Boolean(process.env.VERCEL)
  );
}

export function getSecureCookie() {
  return process.env.API_COOKIE_SECURE === 'true' || Boolean(process.env.VERCEL);
}

export function getSessionCookieOptions(path, maxAgeMs) {
  const crossSite = useCrossSiteCookies();
  return {
    httpOnly: true,
    secure: getSecureCookie(),
    sameSite: crossSite ? 'none' : 'lax',
    path,
    maxAge: maxAgeMs,
  };
}

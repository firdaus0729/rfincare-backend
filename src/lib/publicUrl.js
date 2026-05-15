export function getPublicSiteOrigin() {
  if (process.env.API_PUBLIC_URL) {
    return process.env.API_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://127.0.0.1:${process.env.API_PORT || 8080}`;
}

export function getOAuthFrontendCallback() {
  if (process.env.OAUTH_FRONTEND_CALLBACK) {
    return process.env.OAUTH_FRONTEND_CALLBACK;
  }
  if (process.env.VERCEL_URL) {
    return `${getPublicSiteOrigin()}/oauth/callback`;
  }
  return 'http://127.0.0.1:4028/oauth/callback';
}

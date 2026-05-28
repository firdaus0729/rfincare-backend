import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPool } from '../db/pool.js';
import { getPublicSiteOrigin } from './publicUrl.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOBAL_ID = 'default';
const PROVIDERS = ['google', 'microsoft', 'apple'];
let ensured = false;

function parseCallbackUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function ensureOauthProviderSchema() {
  if (ensured) return;
  const sql = readFileSync(
    join(__dirname, '../../migrations/016_oauth_provider_settings.sql'),
    'utf8',
  );
  const pool = getPool();
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      await pool.execute(statement);
    } catch (err) {
      if (err.code !== 'ER_TABLE_EXISTS_ERROR' && err.code !== 'ER_DUP_ENTRY') {
        throw err;
      }
    }
  }
  ensured = true;
}

export async function getOAuthGlobalSettings() {
  await ensureOauthProviderSchema();
  const pool = getPool();
  const [[row]] = await pool.execute(
    `SELECT * FROM oauth_global_settings WHERE id = :id LIMIT 1`,
    { id: GLOBAL_ID },
  );

  const envCallbacks = (process.env.OAUTH_FRONTEND_CALLBACK || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dbCallbacks = parseCallbackUrls(row?.frontend_callback_urls_json);

  return {
    apiPublicBaseUrl: row?.api_public_base_url || process.env.API_PUBLIC_URL?.replace(/\/$/, '') || null,
    frontendCallbackUrls: dbCallbacks.length ? dbCallbacks : envCallbacks,
    requireAppliedCustomerEmail: row?.require_applied_customer_email !== 0,
    updatedAt: row?.updated_at,
  };
}

export async function getOAuthProviderConfigs() {
  await ensureOauthProviderSchema();
  const pool = getPool();
  const [rows] = await pool.execute(`SELECT * FROM oauth_provider_config ORDER BY provider`);

  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r]));

  return PROVIDERS.map((provider) => {
    const row = byProvider[provider];
    const envPrefix = `OAUTH_${provider.toUpperCase()}`;
    return {
      provider,
      enabled: row?.enabled === 1,
      clientId: row?.client_id || process.env[`${envPrefix}_CLIENT_ID`] || '',
      clientSecret: row?.client_secret || process.env[`${envPrefix}_CLIENT_SECRET`] || '',
      redirectUri: row?.redirect_uri || null,
      hasClientSecret: Boolean(row?.client_secret || process.env[`${envPrefix}_CLIENT_SECRET`]),
      updatedAt: row?.updated_at,
    };
  });
}

export async function getOAuthProviderConfig(provider) {
  const configs = await getOAuthProviderConfigs();
  return configs.find((c) => c.provider === provider) || null;
}

export async function getOAuthCredentials(provider) {
  const cfg = await getOAuthProviderConfig(provider);
  if (!cfg?.clientId || !cfg?.clientSecret) {
    return null;
  }
  return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
}

export async function getOAuthRedirectUri(provider) {
  const cfg = await getOAuthProviderConfig(provider);
  if (cfg?.redirectUri) {
    return cfg.redirectUri.replace(/\/$/, '');
  }
  const global = await getOAuthGlobalSettings();
  const base = (global.apiPublicBaseUrl || getPublicSiteOrigin()).replace(/\/$/, '');
  return `${base}/auth/oauth/${provider}/callback`;
}

export async function updateOAuthSettings({ global: globalInput, providers: providerInputs }, updatedBy) {
  await ensureOauthProviderSchema();
  const pool = getPool();

  if (globalInput) {
    await pool.execute(
      `INSERT INTO oauth_global_settings (
         id, api_public_base_url, frontend_callback_urls_json, require_applied_customer_email, updated_by
       ) VALUES (:id, :api_url, :callbacks, :require_email, :updated_by)
       ON DUPLICATE KEY UPDATE
         api_public_base_url = VALUES(api_public_base_url),
         frontend_callback_urls_json = VALUES(frontend_callback_urls_json),
         require_applied_customer_email = VALUES(require_applied_customer_email),
         updated_by = VALUES(updated_by)`,
      {
        id: GLOBAL_ID,
        api_url: globalInput.apiPublicBaseUrl?.replace(/\/$/, '') || null,
        callbacks: JSON.stringify(globalInput.frontendCallbackUrls || []),
        require_email: globalInput.requireAppliedCustomerEmail !== false ? 1 : 0,
        updated_by: updatedBy ?? null,
      },
    );
  }

  if (Array.isArray(providerInputs)) {
    for (const p of providerInputs) {
      if (!PROVIDERS.includes(p.provider)) continue;
      await pool.execute(
        `INSERT INTO oauth_provider_config (
           provider, enabled, client_id, client_secret, redirect_uri, updated_by
         ) VALUES (:provider, :enabled, :client_id, :client_secret, :redirect_uri, :updated_by)
         ON DUPLICATE KEY UPDATE
           enabled = VALUES(enabled),
           client_id = VALUES(client_id),
           client_secret = COALESCE(NULLIF(VALUES(client_secret), ''), client_secret),
           redirect_uri = VALUES(redirect_uri),
           updated_by = VALUES(updated_by)`,
        {
          provider: p.provider,
          enabled: p.enabled ? 1 : 0,
          client_id: p.clientId || null,
          client_secret: p.clientSecret || null,
          redirect_uri: p.redirectUri || null,
          updated_by: updatedBy ?? null,
        },
      );
    }
  }

  return getOAuthAdminPayload();
}

export async function getOAuthAdminPayload() {
  const global = await getOAuthGlobalSettings();
  const providers = await getOAuthProviderConfigs();

  const providersWithUris = await Promise.all(
    providers.map(async (p) => ({
      ...p,
      computedRedirectUri: await getOAuthRedirectUri(p.provider),
      clientSecret: p.hasClientSecret ? '********' : '',
    })),
  );

  return { global, providers: providersWithUris };
}

export async function getPublicOAuthConfig() {
  const global = await getOAuthGlobalSettings();
  const providers = await getOAuthProviderConfigs();
  const enabled = [];

  for (const p of providers) {
    if (!p.enabled || !p.clientId) continue;
    enabled.push({
      provider: p.provider,
      redirectUri: await getOAuthRedirectUri(p.provider),
    });
  }

  return {
    providers: enabled.map((p) => p.provider),
    frontendCallbackUrls: global.frontendCallbackUrls,
    requireAppliedCustomerEmail: global.requireAppliedCustomerEmail,
  };
}

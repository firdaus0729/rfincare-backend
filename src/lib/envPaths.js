import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(__dirname, '../..');

export const BACKEND_ENV_PATH = join(BACKEND_ROOT, '.env');
export const MONOREPO_FRONTEND_ENV_PATH = join(BACKEND_ROOT, '../frontend/.env');
export const STORED_FRONTEND_ENV_PATH = join(BACKEND_ROOT, 'data/frontend.env');

/** @deprecated Use resolveFrontendEnvPath() */
export const FRONTEND_ENV_PATH = MONOREPO_FRONTEND_ENV_PATH;

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where frontend .env is read/written.
 * - Local monorepo: ../frontend/.env
 * - Render / API-only deploy: backend/data/frontend.env (frontend lives on Vercel)
 */
export async function resolveFrontendEnvPath() {
  if (process.env.FRONTEND_ENV_PATH) {
    return {
      path: process.env.FRONTEND_ENV_PATH,
      storageMode: 'custom',
      hint: null,
    };
  }

  const monorepoDir = dirname(MONOREPO_FRONTEND_ENV_PATH);
  if (await pathExists(monorepoDir)) {
    return {
      path: MONOREPO_FRONTEND_ENV_PATH,
      storageMode: 'monorepo',
      hint: null,
    };
  }

  return {
    path: STORED_FRONTEND_ENV_PATH,
    storageMode: 'server-store',
    hint:
      'Saved on the API server (frontend is hosted separately). Copy these values into Vercel → Project → Settings → Environment Variables, then redeploy the frontend.',
  };
}

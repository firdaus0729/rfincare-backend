import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BACKEND_ENV_PATH = join(__dirname, '../../.env');
export const FRONTEND_ENV_PATH = join(__dirname, '../../../frontend/.env');

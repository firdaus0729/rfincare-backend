import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { createApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const port = Number(process.env.API_PORT || 8080);

if (process.env.UPLOAD_DIR) {
  mkdirSync(resolve(process.env.UPLOAD_DIR), { recursive: true });
}

const app = createApp();

app.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${port}`);
});

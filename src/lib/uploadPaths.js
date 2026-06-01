import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Same default upload directory as `app.js` static `/uploads`. */
export function getUploadDir() {
  if (process.env.UPLOAD_DIR) {
    return resolve(process.env.UPLOAD_DIR);
  }
  return resolve(backendRoot, 'uploads');
}

/** Resolve a stored path from DB to an existing file on disk. */
export function resolveUploadFilePath(storedPath) {
  if (!storedPath) return null;

  const uploadDir = getUploadDir();
  const fileName = basename(storedPath);
  const candidates = [
    storedPath,
    resolve(storedPath),
    join(uploadDir, fileName),
    join(backendRoot, 'uploads', fileName),
    join(process.cwd(), 'uploads', fileName),
    join(process.cwd(), 'backend', 'uploads', fileName),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

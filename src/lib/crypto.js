import { createHash, randomBytes } from 'node:crypto';

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function randomToken(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}


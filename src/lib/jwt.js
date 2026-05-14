import jwt from 'jsonwebtoken';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function signAccessToken({ userId, role, email }) {
  const secret = requireEnv('JWT_ACCESS_SECRET');
  const ttl = Number(process.env.JWT_ACCESS_TTL_SECONDS || 900);
  return jwt.sign(
    { sub: userId, role, email, typ: 'access' },
    secret,
    { expiresIn: ttl },
  );
}

export function signRefreshToken({ tokenId, userId }) {
  const secret = requireEnv('JWT_REFRESH_SECRET');
  const ttl = Number(process.env.JWT_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30);
  return jwt.sign(
    { sub: userId, jti: tokenId, typ: 'refresh' },
    secret,
    { expiresIn: ttl },
  );
}

export function verifyAccessToken(token) {
  const secret = requireEnv('JWT_ACCESS_SECRET');
  const payload = jwt.verify(token, secret);
  if (payload?.typ !== 'access') throw new Error('Invalid token type');
  return payload;
}

export function verifyRefreshToken(token) {
  const secret = requireEnv('JWT_REFRESH_SECRET');
  const payload = jwt.verify(token, secret);
  if (payload?.typ !== 'refresh') throw new Error('Invalid token type');
  return payload;
}


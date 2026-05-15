import { ZodError } from 'zod';

export function errorMiddleware(err, _req, res, _next) {
  let status = Number(err?.status || 500);
  let message = err?.message || 'Internal server error';

  if (err instanceof ZodError) {
    status = 400;
    message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  res.status(status).json({ error: message });
}


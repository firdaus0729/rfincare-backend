# Rfincare backend (Express + MySQL)

API server, MySQL migrations, optional Supabase SQL/functions, and tooling scripts.

## Environment

1. Copy `backend/.env.example` to `backend/.env`.
2. Set MySQL, JWT secrets, `API_PORT`, and `API_CORS_ORIGIN` (must include your Vite origin, e.g. `http://127.0.0.1:4028`).

## Install and run

From this directory:

```bash
npm install
npm start
```

The server loads `backend/.env` automatically. For uploads, `UPLOAD_DIR=./uploads` is resolved relative to the current working directory (use `cd backend` before `npm start`).

## Serve the built SPA

After building the UI (`cd ../frontend && npm run build`), the API serves static files from `../frontend/dist` by default, or from `FRONTEND_DIST` if set.

## Other scripts

| Command | Description |
|---------|-------------|
| `npm run db:migrate` | Apply SQL files in `migrations/` |
| `npm run seed:admin` | Seed default admin user |

## Docs

- `docs/SETUP_GUIDE.md` — India loan system / Supabase migration notes  
- `docs/DEMO_USERS_SETUP.md` — demo user setup  
- `docs/QUICK_FIX.md` — quick fixes  

Supabase CLI: run from `backend/` (this folder) so `supabase/` is found.

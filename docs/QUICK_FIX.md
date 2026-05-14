# 🔑 Demo User Authentication Fix

## Quick Fix Required

The demo credentials displayed on the login pages need to be set up using Supabase's Admin API.

### 🚀 Quick Setup (2 minutes)

**Option 1: Browser Setup (Easiest)**

1. Navigate to: `http://localhost:4028/setup-demo-users.html`
2. Get your **Service Role Key** from [Supabase Dashboard](https://supabase.com/dashboard) → Settings → API
3. Paste the key and click "Create Demo Users"
4. Done! Test login at `/admin-login`

**Option 2: Command Line**

```bash
cd backend
SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/setup-demo-users.js
```

### 📝 What Happened?

Demo users were created via SQL migration, but Supabase Auth requires users to be created through its Admin API. The migration has been updated, but existing users need to be recreated properly.

### 🔒 After Setup

- Delete `../frontend/public/setup-demo-users.html` for security
- Demo credentials will work:
  - Admin: `admin@rfincare.com` / `Admin@2026`
  - Employee: `employee@rfincare.com` / `Employee@2026`
  - Agent: `agent@rfincare.com` / `Agent@2026`
  - Customer: `customer@rfincare.com` / `Customer@2026`

### 📖 Full Documentation

See `docs/DEMO_USERS_SETUP.md` in this backend package for complete details, troubleshooting, and technical explanation.
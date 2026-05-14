# Demo Users Setup Guide

## 🐛 Issue Identified

The admin demo credentials (`admin@rfincare.com` / `Admin@2026`) were failing with "Invalid login credentials" error because:

**Root Cause**: Demo users were created by directly inserting into `auth.users` table via SQL migration. However, Supabase's authentication system requires users to be created through the **Supabase Auth Admin API**, not direct SQL inserts.

**Why Direct SQL Doesn't Work**:
- Supabase Auth maintains internal state and indexes that aren't updated by direct SQL inserts
- Password hashing alone isn't sufficient - Supabase needs to register users through its auth service
- Direct inserts bypass Supabase's user creation workflow

## ✅ Solution

We've created **two methods** to properly create demo users:

---

## Method 1: Browser-Based Setup (Recommended - Easiest)

### Steps:

1. **Get Your Service Role Key**
   - Go to [Supabase Dashboard](https://supabase.com/dashboard)
   - Navigate to: **Settings → API**
   - Copy the `service_role` key (marked as "secret")
   - ⚠️ **NEVER commit this key to git or expose it publicly**

2. **Access the Setup Page**
   - Navigate to: `http://localhost:5173/setup-demo-users.html` (development)
   - Or: `https://your-domain.com/setup-demo-users.html` (production)

3. **Run Setup**
   - Paste your Service Role Key
   - Click "Create Demo Users"
   - Wait for completion

4. **Verify**
   - Go to `/admin-login`
   - Try logging in with: `admin@rfincare.com` / `Admin@2026`
   - Should work successfully! ✅

5. **Security: Delete the Setup Page**
   ```bash
   rm ../frontend/public/setup-demo-users.html
   ```

---

## Method 2: Node.js Script (Alternative)

### Prerequisites:
```bash
cd backend
npm install
```

### Steps:

1. **Get Service Role Key** (same as Method 1)

2. **Run the Script** (from the `backend/` directory):
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key node scripts/setup-demo-users.js
   ```

3. **Verify** (same as Method 1)

---

## 📋 Demo Credentials

Once setup is complete, use these credentials:

| Role | Email | Password |
|------|-------|----------|
| **Admin** | admin@rfincare.com | Admin@2026 |
| **Employee** | employee@rfincare.com | Employee@2026 |
| **Agent** | agent@rfincare.com | Agent@2026 |
| **Customer** | customer@rfincare.com | Customer@2026 |

---

## 🔒 Security Notes

1. **Service Role Key**:
   - Has full admin access to your Supabase project
   - NEVER expose it in client-side code
   - NEVER commit it to version control
   - Only use it for one-time setup scripts

2. **After Setup**:
   - Delete `../frontend/public/setup-demo-users.html` from your project
   - Remove `scripts/setup-demo-users.js` if not needed
   - Change demo user passwords in production

3. **Production**:
   - Use strong, unique passwords
   - Enable MFA for admin accounts
   - Regularly rotate credentials

---

## 🔧 Troubleshooting

### "Invalid API key" error
- You're using the `anon` key instead of `service_role` key
- Get the correct key from Supabase Dashboard → Settings → API

### "User already exists" warning
- Demo users were already created
- Try logging in with existing credentials
- If login still fails, delete users from Supabase Dashboard and re-run setup

### "Network error" or "CORS error"
- Check your `VITE_SUPABASE_URL` in `../frontend/.env` (if used by tooling)
- Ensure Supabase project is active
- Check internet connection

### Login still fails after setup
1. Go to Supabase Dashboard → Authentication → Users
2. Verify users exist with correct emails
3. Check `user_profiles` table has matching records
4. Verify `is_active = true` and `account_status = 'active'`

---

## 📚 Technical Details

### Why This Approach Works

**Supabase Auth Admin API** (`auth.admin.createUser`):
- ✅ Properly registers users in Supabase's auth system
- ✅ Creates all necessary internal records and indexes
- ✅ Handles password hashing correctly
- ✅ Sets up email confirmation state
- ✅ Initializes user metadata

**Direct SQL INSERT**:
- ❌ Bypasses Supabase's auth service
- ❌ Missing internal state/indexes
- ❌ Authentication fails even with correct password

### What the Setup Does

1. **Creates Auth User** via `auth.admin.createUser()`
   - Email: user email
   - Password: hashed by Supabase
   - Email confirmed: true (skip verification)
   - Metadata: role and full name

2. **Creates User Profile** in `user_profiles` table
   - Links to auth user via UUID
   - Sets role (super_admin, employee, agent, customer)
   - Activates account
   - Initializes security fields

---

## ❓ Questions?

If you encounter issues:
1. Check the troubleshooting section above
2. Verify your Supabase project is active
3. Ensure you're using the correct Service Role Key
4. Check browser console for detailed error messages

---

**Last Updated**: 2026-02-18  
**Migration**: `20260218120000_fix_demo_users_auth.sql`
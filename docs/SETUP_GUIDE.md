# India-Specific Loan Application System - Setup Guide

## Database Migration

Your Supabase database migration has been created at:
`supabase/migrations/20260115055200_india_loan_system.sql`

### What This Migration Includes:

1. **User Management System**
   - User profiles with role-based access (Super Admin, Admin, Employee, Agent, Customer)
   - Indian phone number format (10 digits)
   - Aadhaar and PAN number fields

2. **Indian Address System**
   - Address Line 1 & 2
   - City, District, State, PIN Code (6 digits)
   - 36 Indian states pre-loaded
   - Country defaults to "India"

3. **Bank Marketplace**
   - Bank master data with status management
   - Bank products (loan types, interest rates, tenure, fees)
   - Display priority control
   - 6 sample banks pre-loaded

4. **Dynamic Approval Matrix**
   - Configurable eligibility rules
   - Income range, credit score, employment type filters
   - State/city eligibility
   - Age and loan amount criteria
   - Approval probability calculation

5. **Loan Applications**
   - Complete customer application workflow
   - India-specific fields (Aadhaar, PAN)
   - INR currency throughout
   - Application status tracking

6. **Audit Logging**
   - Track all admin changes
   - Complete change history
   - User activity monitoring

7. **Localization Settings**
   - Currency: Indian Rupee (₹ INR)
   - Phone format: 10-digit mobile
   - PIN code: 6 digits

### Demo Credentials (Pre-loaded in Database):

The migration includes test users for immediate testing:

- **Admin**: admin@financeflow.com / admin123
- **Customer**: customer@example.com / customer123
- **Agent**: agent@financeflow.com / agent123
- **Employee**: employee@financeflow.com / employee123

### How to Apply the Migration:

1. **Via Supabase Dashboard:**
   - Go to your Supabase project dashboard
   - Navigate to "SQL Editor"
   - Click "New Query"
   - Copy the entire contents of `supabase/migrations/20260115055200_india_loan_system.sql`
   - Paste into the SQL editor
   - Click "Run" to execute

2. **Via Supabase CLI (if installed):** from this `backend/` package directory:
   ```bash
   supabase db push
   ```

### What Changed in Your Application:

1. **Forms Updated for India:**
   - Phone number: Now 10-digit Indian format (no country code)
   - Address: Indian structure (Address Line, City, District, State, PIN Code)
   - Currency: All amounts now in INR (₹)
   - Identity: Aadhaar and PAN instead of SSN

2. **New Admin Features:**
   - **Bank Marketplace Management** (`/bank-marketplace-management`)
     - Add/Edit/Delete banks
     - Manage bank status (Active/Inactive)
     - Configure bank products
     - Set display priority
   
   - **Approval Matrix Management** (`/approval-matrix-management`)
     - Create dynamic eligibility rules
     - Configure income/credit score ranges
     - Set employment type filters
     - Define approval probabilities
     - Enable/disable rules in real-time

3. **Bank Marketplace:**
   - Now loads banks from database
   - Displays approval probability based on matrix rules
   - Shows INR amounts
   - Real-time updates when admin changes banks

### Admin Dashboard Navigation:

The admin dashboard now includes two new tabs:
- **Bank Marketplace** - Manage banks and products
- **Approval Matrix** - Configure eligibility rules

Click these tabs to access the dedicated management pages.

### Important Notes:

1. **Hostinger Deployment:**
   - This system uses Supabase (PostgreSQL) as the database
   - Supabase handles hosting, so no MySQL setup needed on Hostinger
   - Your Hostinger hosting will serve the React frontend
   - Database is managed by Supabase cloud

2. **Currency Conversion:**
   - All amounts are now in Indian Rupees (INR)
   - Currency symbol: ₹
   - Format: ₹1,00,000 (Indian numbering system)

3. **Data Flow:**
   - Forms collect data in Indian format
   - Service layer converts between camelCase (React) and snake_case (Database)
   - Approval matrix automatically calculates bank suggestions
   - Admin changes reflect immediately in customer-facing marketplace

4. **Security:**
   - Row Level Security (RLS) enabled on all tables
   - Admins have full access
   - Customers can only see their own data
   - Audit logs track all admin actions

### Testing the System:

1. **Login as Admin:**
   - Email: admin@financeflow.com
   - Password: admin123
   - Navigate to Admin Dashboard
   - Test Bank Marketplace Management
   - Test Approval Matrix Management

2. **Login as Customer:**
   - Email: customer@example.com
   - Password: customer123
   - Fill out Customer Assessment Portal
   - View Bank Marketplace with approval probabilities
   - Submit loan application

3. **Verify Localization:**
   - Check phone number accepts 10 digits only
   - Verify PIN code accepts 6 digits
   - Confirm all amounts show ₹ symbol
   - Test Indian state dropdown

### Next Steps:

1. Apply the database migration
2. Test with demo credentials
3. Customize bank data for your needs
4. Configure approval matrix rules
5. Deploy to Hostinger

### Support:

If you encounter any issues:
- Check Supabase logs in dashboard
- Verify migration ran successfully
- Ensure environment variables are set correctly
- Test with demo credentials first
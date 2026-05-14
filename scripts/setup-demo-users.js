/**
 * ONE-TIME DEMO USER SETUP UTILITY
 * 
 * This script creates demo users using Supabase Admin API
 * Run this ONCE after deploying your Supabase project
 * 
 * IMPORTANT: This requires SUPABASE_SERVICE_ROLE_KEY (not anon key)
 * 
 * Usage:
 * 1. Get your service_role key from Supabase Dashboard > Settings > API
 * 2. Run: SUPABASE_SERVICE_ROLE_KEY=your_key node setup-demo-users.js
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  console.error('Get it from: Supabase Dashboard > Settings > API > service_role key');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const demoUsers = [
  {
    email: 'admin@rfincare.com',
    password: 'Admin@2026',
    role: 'super_admin',
    fullName: 'Admin User'
  },
  {
    email: 'employee@rfincare.com',
    password: 'Employee@2026',
    role: 'employee',
    fullName: 'Employee User'
  },
  {
    email: 'agent@rfincare.com',
    password: 'Agent@2026',
    role: 'agent',
    fullName: 'Agent User'
  },
  {
    email: 'customer@rfincare.com',
    password: 'Customer@2026',
    role: 'customer',
    fullName: 'Customer User'
  }
];

async function createDemoUsers() {
  console.log('🚀 Starting demo user creation...');
  
  for (const user of demoUsers) {
    try {
      console.log(`\n📝 Creating ${user?.role}: ${user?.email}`);
      
      // Create user with Supabase Admin API
      const { data: authData, error: authError } = await supabaseAdmin?.auth?.admin?.createUser({
        email: user?.email,
        password: user?.password,
        email_confirm: true,
        user_metadata: {
          full_name: user?.fullName,
          role: user?.role
        }
      });
      
      if (authError) {
        if (authError?.message?.includes('already registered')) {
          console.log(`⚠️  User already exists: ${user?.email}`);
          continue;
        }
        throw authError;
      }
      
      console.log(`✅ Auth user created: ${authData?.user?.id}`);
      
      // Create user profile
      const { error: profileError } = await supabaseAdmin?.from('user_profiles')?.upsert({
          id: authData?.user?.id,
          email: user?.email,
          full_name: user?.fullName,
          role: user?.role,
          is_active: true,
          account_status: 'active',
          failed_login_attempts: 0
        }, {
          onConflict: 'id'
        });
      
      if (profileError) {
        console.error(`❌ Profile creation failed for ${user?.email}:`, profileError?.message);
      } else {
        console.log(`✅ User profile created for ${user?.role}`);
      }
      
    } catch (error) {
      console.error(`❌ Failed to create ${user?.email}:`, error?.message);
    }
  }
  
  console.log('\n✨ Demo user setup complete!');
  console.log('\n📋 Demo Credentials:');
  console.log('Admin: admin@rfincare.com / Admin@2026');
  console.log('Employee: employee@rfincare.com / Employee@2026');
  console.log('Agent: agent@rfincare.com / Agent@2026');
  console.log('Customer: customer@rfincare.com / Customer@2026');
}

createDemoUsers()?.catch(console.error);
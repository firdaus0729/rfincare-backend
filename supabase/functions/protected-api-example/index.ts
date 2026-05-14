declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Validates JWT token and returns user information
 */
async function validateToken(token: string, supabase: any) {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  
  if (error || !user) {
    throw new Error('Invalid or expired token')
  }
  
  // Fetch user profile
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, email, role, account_status, is_active')
    .eq('id', user.id)
    .single()
  
  if (profileError || !profile) {
    throw new Error('User profile not found')
  }
  
  // Check account status
  if (profile.account_status !== 'active' || !profile.is_active) {
    throw new Error('Account is not active')
  }
  
  return { user, profile }
}

/**
 * Checks if user has required permission
 */
function checkPermission(userRole: string, requiredRole: string): boolean {
  const roleHierarchy = {
    customer: 1,
    agent: 2,
    employee: 3,
    admin: 4,
    super_admin: 5
  }
  
  const userLevel = roleHierarchy[userRole] || 0
  const requiredLevel = roleHierarchy[requiredRole] || 0
  
  return userLevel >= requiredLevel
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // STEP 1: Extract and validate JWT token
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized: Missing or invalid authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` }
      }
    })

    // STEP 2: Validate token and get user profile
    let validatedUser
    try {
      validatedUser = await validateToken(token, supabase)
    } catch (error) {
      return new Response(
        JSON.stringify({ error: `Authentication failed: ${error.message}` }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const { user, profile } = validatedUser

    // STEP 3: Check role-based permissions
    // Example: This endpoint requires at least 'employee' role
    const requiredRole = 'employee'
    const hasPermission = checkPermission(profile.role, requiredRole)

    if (!hasPermission) {
      return new Response(
        JSON.stringify({ 
          error: 'Forbidden: Insufficient permissions',
          requiredRole,
          userRole: profile.role
        }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // STEP 4: Process the actual API request
    // Example: Fetch loan applications based on user role
    let query = supabase.from('loan_applications').select('*')

    // Apply role-based data filtering
    if (profile.role === 'customer') {
      query = query.eq('customer_id', user.id)
    } else if (profile.role === 'agent') {
      query = query.eq('agent_id', user.id)
    } else if (profile.role === 'employee') {
      query = query.eq('assigned_employee_id', user.id)
    }
    // admin and super_admin can see all applications (no filter)

    const { data: applications, error: queryError } = await query

    if (queryError) {
      throw new Error(`Database query failed: ${queryError.message}`)
    }

    // STEP 5: Return successful response
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          role: profile.role
        },
        data: applications,
        message: 'Request processed successfully'
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
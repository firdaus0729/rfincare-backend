import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Role hierarchy: higher number = more permissions
const ROLE_HIERARCHY = {
  customer: 1,
  agent: 2,
  employee: 3,
  admin: 4,
  super_admin: 5
}

// Permission matrix: defines what each role can do
const PERMISSIONS = {
  // Customer permissions
  customer: [
    'read:own_profile',
    'update:own_profile',
    'create:loan_application',
    'read:own_loan_applications',
    'update:own_loan_applications',
    'read:banks',
    'read:bank_products'
  ],
  
  // Agent permissions (includes customer permissions)
  agent: [
    'read:own_profile',
    'update:own_profile',
    'read:assigned_customers',
    'read:assigned_loan_applications',
    'update:assigned_loan_applications',
    'read:banks',
    'read:bank_products',
    'read:commission_tracker',
    'read:performance_metrics'
  ],
  
  // Employee permissions (includes agent permissions)
  employee: [
    'read:own_profile',
    'update:own_profile',
    'read:all_loan_applications',
    'update:all_loan_applications',
    'read:all_customers',
    'read:banks',
    'read:bank_products',
    'read:approval_matrix',
    'read:documents',
    'update:documents'
  ],
  
  // Admin permissions (includes employee permissions)
  admin: [
    'read:*',
    'create:*',
    'update:*',
    'delete:loan_applications',
    'manage:agents',
    'manage:employees',
    'manage:customers',
    'manage:banks',
    'manage:bank_products',
    'manage:approval_matrix',
    'manage:interest_matrix',
    'read:audit_logs',
    'read:reports'
  ],
  
  // Super Admin permissions (full access)
  super_admin: [
    'read:*',
    'create:*',
    'update:*',
    'delete:*',
    'manage:*',
    'system:*'
  ]
}

interface RBACRequest {
  resource: string
  action: string
  resourceOwnerId?: string
}

function hasPermission(userRole: string, requiredPermission: string): boolean {
  const rolePermissions = PERMISSIONS[userRole] || []
  
  // Check for exact permission match
  if (rolePermissions.includes(requiredPermission)) {
    return true
  }
  
  // Check for wildcard permissions
  const [action, resource] = requiredPermission.split(':')
  if (rolePermissions.includes(`${action}:*`) || rolePermissions.includes('*:*')) {
    return true
  }
  
  return false
}

function canAccessResource(
  userRole: string,
  userId: string,
  resource: string,
  action: string,
  resourceOwnerId?: string
): boolean {
  const permission = `${action}:${resource}`
  
  // Check if user has the required permission
  if (!hasPermission(userRole, permission)) {
    // Check if user can access their own resource
    const ownPermission = `${action}:own_${resource}`
    if (hasPermission(userRole, ownPermission) && resourceOwnerId === userId) {
      return true
    }
    return false
  }
  
  return true
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Extract JWT token from Authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid authorization header' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const token = authHeader.replace('Bearer ', '')

    // Parse request body
    const body: RBACRequest = await req.json()
    const { resource, action, resourceOwnerId } = body

    if (!resource || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: resource and action' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Verify JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, role, account_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { 
          status: 404, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check account status
    if (profile.account_status !== 'active' || !profile.is_active) {
      return new Response(
        JSON.stringify({ error: 'Account is not active', authorized: false }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Check RBAC permissions
    const authorized = canAccessResource(
      profile.role,
      user.id,
      resource,
      action,
      resourceOwnerId
    )

    if (!authorized) {
      return new Response(
        JSON.stringify({ 
          error: 'Insufficient permissions',
          authorized: false,
          requiredPermission: `${action}:${resource}`,
          userRole: profile.role
        }),
        { 
          status: 403, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    // Return authorization success
    return new Response(
      JSON.stringify({
        authorized: true,
        user: {
          id: user.id,
          role: profile.role
        },
        permission: `${action}:${resource}`
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
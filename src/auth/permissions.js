// Ported from supabase/functions/rbac-check/index.ts
export const ROLE_HIERARCHY = {
  customer: 1,
  agent: 2,
  employee: 3,
  admin: 4,
  super_admin: 5,
};

export const PERMISSIONS = {
  customer: [
    'read:own_profile',
    'update:own_profile',
    'create:loan_application',
    'read:own_loan_applications',
    'update:own_loan_applications',
    'read:own_documents',
    'update:own_documents',
    'read:banks',
    'read:bank_products',
  ],
  agent: [
    'read:own_profile',
    'update:own_profile',
    'read:assigned_customers',
    'read:assigned_loan_applications',
    'update:assigned_loan_applications',
    'read:documents',
    'update:documents',
    'read:banks',
    'read:bank_products',
    'read:commission_tracker',
    'read:performance_metrics',
  ],
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
    'update:documents',
  ],
  admin: [
    'read:*',
    'create:*',
    'update:*',
    'delete:loan_applications',
    'read:all_loan_applications',
    'update:all_loan_applications',
    'read:registration',
    'update:registration',
    'read:agents',
    'update:agents',
    'read:employees',
    'manage:agents',
    'manage:employees',
    'manage:customers',
    'manage:banks',
    'manage:bank_products',
    'manage:approval_matrix',
    'manage:interest_matrix',
    'read:audit_logs',
    'read:reports',
  ],
  super_admin: ['read:*', 'create:*', 'update:*', 'delete:*', 'manage:*', 'system:*'],
};

export function hasPermission(userRole, requiredPermission) {
  const rolePermissions = PERMISSIONS[userRole] || [];
  if (rolePermissions.includes(requiredPermission)) return true;

  const [action] = requiredPermission.split(':');
  if (rolePermissions.includes(`${action}:*`) || rolePermissions.includes('*:*')) return true;

  return false;
}

export function canAccessResource({ userRole, userId, resource, action, resourceOwnerId }) {
  const permission = `${action}:${resource}`;
  if (!hasPermission(userRole, permission)) {
    const ownPermission = `${action}:own_${resource}`;
    if (hasPermission(userRole, ownPermission) && resourceOwnerId && resourceOwnerId === userId) {
      return true;
    }
    return false;
  }
  return true;
}


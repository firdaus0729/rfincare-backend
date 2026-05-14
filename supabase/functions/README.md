# Supabase Edge Functions - JWT Validation & RBAC

This project includes Supabase Edge Functions that validate JWT tokens and enforce role-based access control (RBAC) on all API calls.

## Edge Functions Overview

### 1. **auth-middleware** - JWT Token Validation
**Purpose**: Validates Supabase JWT tokens and extracts user information

**Endpoint**: `POST /functions/v1/auth-middleware`

**Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Response**:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "admin",
    "accountStatus": "active",
    "isActive": true
  }
}
```

**Error Responses**:
- `401`: Missing/invalid token
- `403`: Account suspended/locked/inactive
- `404`: User profile not found

---

### 2. **rbac-check** - Role-Based Permission Validation
**Purpose**: Checks if user has permission to perform specific actions on resources

**Endpoint**: `POST /functions/v1/rbac-check`

**Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body**:
```json
{
  "resource": "loan_applications",
  "action": "read",
  "resourceOwnerId": "optional-owner-uuid"
}
```

**Response**:
```json
{
  "authorized": true,
  "user": {
    "id": "uuid",
    "role": "admin"
  },
  "permission": "read:loan_applications"
}
```

**Error Responses**:
- `401`: Invalid token
- `403`: Insufficient permissions
- `400`: Missing required fields

---

### 3. **protected-api-example** - Protected API Endpoint
**Purpose**: Example endpoint demonstrating JWT validation + RBAC enforcement

**Endpoint**: `POST /functions/v1/protected-api-example`

**Headers**:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Response**:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "employee"
  },
  "data": [...],
  "message": "Request processed successfully"
}
```

---

## Role Hierarchy

```
super_admin (5) - Full system access
    ↓
  admin (4) - Manage all resources
    ↓
employee (3) - Process applications
    ↓
  agent (2) - Manage assigned customers
    ↓
customer (1) - Own data only
```

---

## Permission Matrix

### Customer Permissions
- `read:own_profile`
- `update:own_profile`
- `create:loan_application`
- `read:own_loan_applications`
- `update:own_loan_applications`
- `read:banks`
- `read:bank_products`

### Agent Permissions (+ Customer)
- `read:assigned_customers`
- `read:assigned_loan_applications`
- `update:assigned_loan_applications`
- `read:commission_tracker`
- `read:performance_metrics`

### Employee Permissions (+ Agent)
- `read:all_loan_applications`
- `update:all_loan_applications`
- `read:all_customers`
- `read:approval_matrix`
- `read:documents`
- `update:documents`

### Admin Permissions (+ Employee)
- `read:*`
- `create:*`
- `update:*`
- `delete:loan_applications`
- `manage:agents`
- `manage:employees`
- `manage:customers`
- `manage:banks`
- `manage:approval_matrix`
- `read:audit_logs`

### Super Admin Permissions
- `*:*` (Full access)

---

## Deployment Instructions

### Prerequisites
1. Install Supabase CLI:
```bash
npm install -g supabase
```

2. Login to Supabase:
```bash
supabase login
```

3. Link your project:
```bash
supabase link --project-ref <YOUR_PROJECT_REF>
```

### Deploy Edge Functions

**Deploy all functions:**
```bash
supabase functions deploy
```

**Deploy individual function:**
```bash
supabase functions deploy auth-middleware
supabase functions deploy rbac-check
supabase functions deploy protected-api-example
```

### Set Environment Variables

Edge Functions automatically have access to:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

No additional environment variables needed.

---

## Usage in React Application

### 1. Import the service
```javascript
import { edgeFunctionsService } from '../services/edgeFunctionsService';
import { supabase } from '../lib/supabase';
```

### 2. Get JWT token
```javascript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

### 3. Validate token
```javascript
const { data, error } = await edgeFunctionsService.validateToken(token);
if (error) {
  console.error('Token validation failed:', error);
} else {
  console.log('User:', data.user);
}
```

### 4. Check permissions
```javascript
const { data, error } = await edgeFunctionsService.checkPermission(
  token,
  'loan_applications',
  'create'
);

if (data?.authorized) {
  // User has permission
  console.log('Permission granted');
} else {
  // User lacks permission
  console.error('Permission denied:', error);
}
```

### 5. Call protected API
```javascript
const { data, error } = await edgeFunctionsService.getLoanApplications(token);
if (error) {
  console.error('API call failed:', error);
} else {
  console.log('Applications:', data.data);
}
```

---

## Example: Protected Component

```javascript
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { edgeFunctionsService } from '../services/edgeFunctionsService';
import { supabase } from '../lib/supabase';

function ProtectedComponent() {
  const { user } = useAuth();
  const [hasPermission, setHasPermission] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAccess() {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        setLoading(false);
        return;
      }

      const { data, error } = await edgeFunctionsService.checkPermission(
        token,
        'loan_applications',
        'read'
      );

      setHasPermission(data?.authorized || false);
      setLoading(false);
    }

    checkAccess();
  }, [user]);

  if (loading) return <div>Loading...</div>;
  if (!hasPermission) return <div>Access Denied</div>;

  return <div>Protected Content</div>;
}

export default ProtectedComponent;
```

---

## Testing Edge Functions

### Using curl

**Test auth-middleware:**
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/auth-middleware \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

**Test rbac-check:**
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/rbac-check \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"resource": "loan_applications", "action": "read"}'
```

**Test protected-api-example:**
```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/protected-api-example \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

---

## Security Best Practices

1. **Always validate tokens** before processing requests
2. **Check account status** (active, suspended, locked)
3. **Implement rate limiting** to prevent abuse
4. **Log all authorization failures** for audit trails
5. **Use HTTPS only** in production
6. **Rotate JWT secrets** regularly
7. **Implement token expiration** (Supabase default: 1 hour)
8. **Never expose sensitive data** in error messages

---

## Troubleshooting

### Common Issues

**1. "Invalid or expired token"**
- Token has expired (refresh using `supabase.auth.refreshSession()`)
- Token is malformed
- User has been deleted

**2. "Insufficient permissions"**
- User role doesn't have required permission
- Check permission matrix above
- Verify user role in `user_profiles` table

**3. "Account is suspended/locked"**
- Check `account_status` in `user_profiles`
- Admin must reactivate account

**4. "CORS error"**
- Edge Functions include CORS headers
- Ensure OPTIONS requests are handled

---

## Monitoring & Logs

View Edge Function logs in Supabase Dashboard:
1. Go to **Edge Functions** section
2. Select function name
3. Click **Logs** tab
4. Filter by status code or search errors

---

## Next Steps

1. **Deploy functions** using Supabase CLI
2. **Test endpoints** with your JWT tokens
3. **Integrate** into React components
4. **Monitor logs** for errors
5. **Customize permissions** based on your needs

---

## Support

For issues or questions:
- Check Supabase Edge Functions documentation
- Review error logs in Supabase Dashboard
- Verify JWT token validity
- Confirm user roles in database
import { canAccessResource } from '../auth/permissions.js';

export function authorize({ resource, action, getOwnerId }) {
  return async (req, _res, next) => {
    try {
      if (!req.auth) {
        const e = new Error('Not authenticated');
        e.status = 401;
        throw e;
      }

      const resourceOwnerId = getOwnerId ? await getOwnerId(req) : undefined;

      const ok = canAccessResource({
        userRole: req.auth.role,
        userId: req.auth.userId,
        resource,
        action,
        resourceOwnerId,
      });

      if (!ok) {
        const e = new Error('Insufficient permissions');
        e.status = 403;
        throw e;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}


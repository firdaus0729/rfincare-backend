export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.auth) {
      const e = new Error('Not authenticated');
      e.status = 401;
      return next(e);
    }
    if (!roles.includes(req.auth.role)) {
      const e = new Error('Insufficient permissions');
      e.status = 403;
      return next(e);
    }
    next();
  };
}

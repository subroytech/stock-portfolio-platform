import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

// Functional Authorization (RBAC), Architecture.md Section 3 item 6. Must run
// after requireAuth (which populates req.user) - checks the DB fresh on every
// request rather than caching roles on the JWT, so a promotion/demotion takes
// effect on the user's very next request, not after they re-log-in.
export default function requirePermission(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const { rows } = await pool.query(
      `SELECT 1 FROM users_roles ur
       JOIN m_role_permissions rp ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1 AND rp.permission_key = $2
       LIMIT 1`,
      [req.user.id, permissionKey],
    );

    if (!rows[0]) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }

    next();
  };
}

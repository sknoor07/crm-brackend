import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/jwt.js';
import { db } from '../../config/database.js';
import { userRoles, roles } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

// Extend Express Request type to include user data
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload & { roles?: string[] };
  }
}
}

// 1. Verifies if the user has a valid access token
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication token missing or malformed' });
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    // Fetch the user's specific system roles from the database junction table
    const userRoleRows = await db
.select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, payload.userId));

    const roleNames = userRoleRows.map((r) => r.roleName);

    // Attach user payload and roles to the request object
    req.user = {
      ...payload,
      roles: roleNames,
    }

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired access token' });
  }
};

// 2. Middleware to restrict routes to specific allowed roles
export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.roles) {
      return res.status(403).json({ error: 'Forbidden: No roles assigned' });
    }

    // Check if the user has at least one of the allowed roles
    const hasPermission = req.user.roles.some((role) => {return allowedRoles.includes(role)});

    if (!hasPermission) {
      return res.status(403).json({ 
        error: 'Forbidden: Your role does not have permission to perform this action' 
      });
    }

    next();
  };
};
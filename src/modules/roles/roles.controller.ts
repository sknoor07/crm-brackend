import { Request, Response } from 'express';
import { db } from '../../config/database.js';
import { roles } from '../../db/schema/index.js';

export const getRoles = async (req: Request, res: Response) => {
  try {
    const roleRows = await db
      .select({
        id: roles.id,
        name: roles.name,
        description: roles.description,
      })
      .from(roles);

    return res.status(200).json({
      roles: roleRows,
    });
  } catch (error) {
    console.error('Failed to fetch roles:', error);

    return res.status(500).json({
      error: 'Failed to fetch roles',
    });
  }
};
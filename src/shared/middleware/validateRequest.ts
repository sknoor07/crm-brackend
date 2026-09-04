import { Request, Response, NextFunction } from 'express';
import { ZodSchema , ZodError } from 'zod';

export const validateRequest = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Parses the incoming request body against the provided Zod schema
      await schema.parseAsync(req.body);
      next(); // Data is valid, proceed to the actual controller
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          status: 'error',
          message: 'Validation failed',
          errors: error.issues.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
};
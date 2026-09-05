import { Request, Response, NextFunction } from 'express';
import { ZodSchema , ZodError } from 'zod';

type ValidationSource = 'body' | 'params' | 'query';

export const validateRequest = (
  schema: ZodSchema,
  source: ValidationSource = 'body',
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req[source]);
      Object.assign(req[source], parsed);
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
import { Request, Response, NextFunction } from 'express';
import config from '../config';

/**
 * Middleware: require a valid admin API key.
 * Expects: Authorization: Bearer <key>
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'] ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!config.adminApiKey || token !== config.adminApiKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
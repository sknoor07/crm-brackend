import jwt from 'jsonwebtoken';

// Fallback secrets for development (use .env in production)
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access_secret_key_123';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret_key_456';

export interface TokenPayload {
  userId: string;
  userType: string;
}

// Short-lived Access Token (15 mins)
export const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '30m' });
};

// Long-lived Refresh Token (14 days, as requested)
export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: '1hr' });
};

export const verifyAccessToken = (token: string): TokenPayload => {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, REFRESH_SECRET) as { userId: string };
};
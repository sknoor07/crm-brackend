import jwt from 'jsonwebtoken';
// Fallback secrets for development (use environment variables in production)
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access_secret_key_123';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret_key_456';
// Short-lived Access Token (15 mins)
export const generateAccessToken = (payload) => {
    return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '1d' });
};
// Long-lived Refresh Token (14 days, as requested)
export const generateRefreshToken = (userId) => {
    return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: '14d' });
};
export const verifyAccessToken = (token) => {
    return jwt.verify(token, ACCESS_SECRET);
};
export const verifyRefreshToken = (token) => {
    return jwt.verify(token, REFRESH_SECRET);
};
export const generatePasswordResetToken = (userId) => {
    return jwt.sign({
        userId,
        purpose: 'password_reset',
    }, process.env.JWT_SECRET, {
        expiresIn: '10m',
    });
};

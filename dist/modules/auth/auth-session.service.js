import { db } from '../../config/database.js';
import { refreshTokens } from '../../db/schema/index.js';
import { generateAccessToken, generateRefreshToken, } from '../../shared/utils/jwt.js';
import { hashToken } from '../../shared/utils/token.js';
export const createLoginSession = async ({ userId, userType, }) => {
    const accessToken = generateAccessToken({
        userId,
        userType,
    });
    const refreshToken = generateRefreshToken(userId);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);
    await db.insert(refreshTokens).values({
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt,
    });
    return {
        accessToken,
        refreshToken,
    };
};

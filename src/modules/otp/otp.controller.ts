
import { eq } from 'drizzle-orm';
import { Request, Response } from 'express';
import { users } from '../../db/schema/index.js';
import { createOtp, verifyOtp } from './otp.service.js';
import { OTP_CHANNEL, OTP_PURPOSE } from './otp.constants.js';
import { db } from '../../config/database.js';
import { ForgotPasswordInput, RequestOtpLoginInput, ResetPasswordInput } from './otp.validation.js';
import { generatePasswordResetToken } from '../../shared/utils/jwt.js';
import { hashPassword } from '../../shared/utils/password.js';
import jwt from 'jsonwebtoken';
import { createLoginSession } from '../auth/auth-session.service.js';

export const forgotPassword = async (
    req: Request<{}, {}, ForgotPasswordInput>,
    res: Response,
) => {
    try {
        const { email } = req.body;

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                phone: users.phone,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        // Do not reveal whether the account exists
        if (!user || !user.isActive) {
            return res.status(200).json({
                message:
                    'If an account exists, a password reset OTP has been sent.',
            });
        }

        await createOtp({
            userId: user.id,
            purpose: OTP_PURPOSE.PASSWORD_RESET,
            channel: OTP_CHANNEL.EMAIL,
            destination: user.email,
        });

        return res.status(200).json({
            message:
                'If an account exists, a password reset OTP has been sent.',
        });
    } catch (error) {
        console.error('Forgot password error:', error);

        return res.status(500).json({
            error: 'Something went wrong',
        });
    }
};


export const verifyPasswordResetOtp = async (
    req: Request,
    res: Response,
) => {
    try {
        const { email, otp } = req.body;

        const [user] = await db
            .select({
                id: users.id,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (!user || !user.isActive) {
            return res.status(400).json({
                error: 'Invalid OTP',
            });
        }

        await verifyOtp({
            userId: user.id,
            purpose: OTP_PURPOSE.PASSWORD_RESET,
            otp,
        });

        const resetToken = generatePasswordResetToken(
            user.id,
        );

        return res.status(200).json({
            message: 'OTP verified successfully',
            resetToken,
        });
    } catch (error) {
        console.error(
            'Verify password reset OTP error:',
            error,
        );

        return res.status(400).json({
            error: 'Invalid or expired OTP',
        });
    }
};


export const resetPassword = async (
    req: Request<{}, {}, ResetPasswordInput>,
    res: Response,
) => {
    try {
        const { resetToken, password } = req.body;

        const decoded = jwt.verify(
            resetToken,
            process.env.JWT_SECRET!,
        ) as {
            userId: string;
            purpose: string;
        };

        if (decoded.purpose !== 'password_reset') {
            return res.status(400).json({
                error: 'Invalid reset token',
            });
        }

        const [user] = await db
            .select({
                id: users.id,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.id, decoded.userId))
            .limit(1);

        if (!user || !user.isActive) {
            return res.status(400).json({
                error: 'Invalid reset token',
            });
        }

        const passwordHash = await hashPassword(password);

        await db
            .update(users)
            .set({
                passwordHash,
                mustChangePassword: false,
                updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

        return res.status(200).json({
            message: 'Password reset successfully',
        });
    } catch (error) {
        console.error('Reset password error:', error);

        return res.status(400).json({
            error: 'Invalid or expired reset token',
        });
    }
};

export const requestOtpLogin = async (
    req: Request<{}, {}, RequestOtpLoginInput>,
    res: Response,
) => {
    try {
        const { email } = req.body;

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (!user || !user.isActive) {
            return res.status(401).json({
                error: 'Invalid email or OTP',
            });
        }

        await createOtp({
            userId: user.id,
            purpose: OTP_PURPOSE.LOGIN,
            channel: OTP_CHANNEL.EMAIL,
            destination: user.email,
        });

        return res.status(200).json({
            message: 'OTP sent successfully',
        });
    } catch (error) {
        console.error('Request OTP login error:', error);

        return res.status(500).json({
            error: 'Something went wrong',
        });
    }
};


export const verifyOtpLogin = async (
    req: Request,
    res: Response,
) => {
    try {
        const { email, otp } = req.body;

        const [user] = await db
            .select({
                id: users.id,
                email: users.email,
                userType: users.userType,
                isActive: users.isActive,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

        if (!user || !user.isActive) {
            return res.status(401).json({
                error: 'Invalid email or OTP',
            });
        }

        await verifyOtp({
            userId: user.id,
            purpose: OTP_PURPOSE.LOGIN,
            otp,
        });
        const { accessToken, refreshToken } =
            await createLoginSession({
                userId: user.id,
                userType: user.userType,
            });
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 14 * 24 * 60 * 60 * 1000,
        });

        // Stop here for this step.
        // We will add JWT + refresh-token logic next.
        return res.status(200).json({
            message: 'Login successful',
            accessToken,
        });
    } catch (error) {
        console.error('Verify OTP login error:', error);

        return res.status(401).json({
            error: 'Invalid or expired OTP',
        });
    }
};
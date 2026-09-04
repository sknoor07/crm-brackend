import { Request, Response } from 'express';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { users, employeeProfiles, accountInvitations } from '../../db/schema/index.js';
import { hashPassword } from '../../shared/utils/password.js';
import { RegisterEmployeeInput } from './auth.validation.js';
import { comparePasswords } from '../../shared/utils/password.js';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../shared/utils/jwt.js';
import { refreshTokens } from '../../db/schema/index.js';
import { AcceptInvitationInput, LoginInput } from './auth.validation.js';
import crypto from 'crypto';

// Helper to hash tokens before saving to DB for security
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

const getCookieValue = (req: Request, name: string) => {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) {
    return undefined;
  }

  const cookie = cookieHeader.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined;
};

const deleteExpiredRefreshTokens = async (now: Date) => {
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
};

export const registerEmployee = async (req: Request<{}, {}, RegisterEmployeeInput>, res: Response) => {
  try {
    // 1. Extract the validated data
    const { email, password, firstName, lastName, ...profileData } = req.body;

    // 2. Check if the email is already in use
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    // 3. Hash the password for security
    const hashedPassword = await hashPassword(password);

    // 4. Insert into the base auth table first
    const [insertedUser] = await db.insert(users).values({
      email,
      passwordHash: hashedPassword,
      userType: 'employee', 
      mustChangePassword: true,
    }).returning({ id: users.id, email: users.email });

    // 5. Insert into the HR compliance table using the new user's ID
    await db.insert(employeeProfiles).values({
      userId: insertedUser.id,
      firstName,
      lastName,
      ...profileData
    });

    // 6. Send success response
    return res.status(201).json({
      message: 'Employee created successfully',
      user: insertedUser
    });

  } catch (error) {
    console.error('Registration Error:', error);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
};




export const loginUser = async (req: Request<{}, {}, LoginInput>, res: Response) => {
  try {
    await deleteExpiredRefreshTokens(new Date());

    const { email, password } = req.body;

    // 1. Find user by email
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 2. Verify password
    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 3. Generate Tokens
    const accessToken = generateAccessToken({ userId: user.id, userType: user.userType });
    const refreshToken = generateRefreshToken(user.id);

    // 4. Calculate 14-day expiry date for session storage
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    // 5. Save session (refresh token hash) in database
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    });

    // 6. Send Refresh Token securely via HTTP-only cookie (14 days)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days in milliseconds
    });

    // 7. Return Access Token & basic user info
    return res.status(200).json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        userType: user.userType,
        mustChangePassword: user.mustChangePassword,
      },
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
};

export const refreshAccessToken = async (req: Request, res: Response) => {
  try {
    await deleteExpiredRefreshTokens(new Date());

    const refreshToken = getCookieValue(req, 'refreshToken');
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token missing' });
    }

    const { userId } = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);
    const now = new Date();

    const [session] = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.tokenHash, tokenHash),
        eq(refreshTokens.isRevoked, false),
        gt(refreshTokens.expiresAt, now),
      ))
      .limit(1);

    if (!session) {
      return res.status(401).json({ error: 'Refresh token is invalid, expired, or revoked' });
    }

    const [user] = await db
      .select({ id: users.id, userType: users.userType, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'User account is inactive or unavailable' });
    }

    const accessToken = generateAccessToken({
      userId: user.id,
      userType: user.userType,
    });

    return res.status(200).json({ accessToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
};

export const acceptInvitation = async (
  req: Request<{}, {}, AcceptInvitationInput>,
  res: Response,
) => {
  try {
    const { token, password } = req.body;
    const tokenHash = hashToken(token);
    const now = new Date();

    const user = await db.transaction(async (tx) => {
      const [invitation] = await tx.select()
        .from(accountInvitations)
        .where(and(
          eq(accountInvitations.tokenHash, tokenHash),
          isNull(accountInvitations.usedAt),
          gt(accountInvitations.expiresAt, now),
        ))
        .limit(1);

      if (!invitation) {
        return null;
      }

      const hashedPassword = await hashPassword(password);
      const [updatedUser] = await tx.update(users)
        .set({
          passwordHash: hashedPassword,
          mustChangePassword: false,
          updatedAt: now,
        })
        .where(eq(users.id, invitation.userId))
        .returning({ id: users.id, email: users.email });

      await tx.update(accountInvitations)
        .set({ usedAt: now })
        .where(eq(accountInvitations.id, invitation.id));

      return updatedUser;
    });

    if (!user) {
      return res.status(400).json({ error: 'Invitation is invalid, expired, or already used' });
    }

    return res.status(200).json({
      message: 'Account password set successfully. You can now log in.',
      user,
    });
  } catch (error) {
    console.error('Accept invitation error:', error);
    return res.status(500).json({ error: 'Internal server error while accepting invitation' });
  }
};
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { otpVerifications } from '../../db/schema/index.js';
import {
  compareOtp,
  generateOtp,
  hashOtp,
} from '../../shared/utils/otp.js';
import { sendOtp } from './otp-delivery.service.js';


export const createOtp = async ({
  userId,
  purpose,
  channel,
  destination,
}: {
  userId: string;
  purpose: string;
  channel: string;
  destination: string;
}) => {
  // 1. Invalidate previous active OTPs
  await db
    .update(otpVerifications)
    .set({
      verifiedAt: new Date(),
    })
    .where(
      and(
        eq(otpVerifications.userId, userId),
        eq(otpVerifications.purpose, purpose),
        isNull(otpVerifications.verifiedAt),
      ),
    );

  // 2. Generate OTP
  const otp = generateOtp();

  // 3. Hash OTP
  const otpHash = await hashOtp(otp);

  // 4. OTP expires in 5 minutes
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // 5. Save OTP
  await db.insert(otpVerifications).values({
    userId,
    otpHash,
    purpose,
    channel,
    destination,
    expiresAt,
  });

  //deliver Otp
  await sendOtp({
  channel,
  destination,
  otp,
});

  
};


export const verifyOtp = async ({
  userId,
  purpose,
  otp,
}: {
  userId: string;
  purpose: string;
  otp: string;
}) => {
  const now = new Date();

  const [record] = await db
    .select()
    .from(otpVerifications)
    .where(
      and(
        eq(otpVerifications.userId, userId),
        eq(otpVerifications.purpose, purpose),
        isNull(otpVerifications.verifiedAt),
        gt(otpVerifications.expiresAt, now),
      ),
    )
    .orderBy(desc(otpVerifications.createdAt))
    .limit(1);

  if (!record) {
    throw new Error('Invalid or expired OTP');
  }

  // Maximum 5 attempts
  if (record.attempts >= 5) {
    throw new Error('Maximum OTP attempts exceeded');
  }

  const isValid = await compareOtp(otp, record.otpHash);

  if (!isValid) {
    await db
      .update(otpVerifications)
      .set({
        attempts: record.attempts + 1,
      })
      .where(eq(otpVerifications.id, record.id));

    throw new Error('Invalid or expired OTP');
  }

  // OTP successfully verified
  await db
    .update(otpVerifications)
    .set({
      verifiedAt: now,
    })
    .where(eq(otpVerifications.id, record.id));

  return {
    verified: true,
    otpId: record.id,
  };
};
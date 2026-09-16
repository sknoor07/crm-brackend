import crypto from 'crypto';
import bcrypt from 'bcrypt';

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const hashOtp = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, 10);
};

export const compareOtp = async (
  otp: string,
  otpHash: string,
): Promise<boolean> => {
  return bcrypt.compare(otp, otpHash);
};
import crypto from 'crypto';
import bcrypt from 'bcrypt';
export const generateOtp = () => {
    return crypto.randomInt(100000, 1000000).toString();
};
export const hashOtp = async (otp) => {
    return bcrypt.hash(otp, 10);
};
export const compareOtp = async (otp, otpHash) => {
    return bcrypt.compare(otp, otpHash);
};

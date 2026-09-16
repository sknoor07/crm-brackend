export const sendOtp = async ({
  channel,
  destination,
  otp,
}: {
  channel: string;
  destination: string;
  otp: string;
}) => {
  console.log('=================================');
  console.log('OTP DELIVERY');
  console.log('Channel:', channel);
  console.log('Destination:', destination);
  console.log('OTP:', otp);
  console.log('=================================');
};
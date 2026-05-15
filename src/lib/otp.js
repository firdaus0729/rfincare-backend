import crypto from 'node:crypto';

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

export async function sendOtpNotification({ email, phone, otp, channel }) {
  // Integrate Twilio/SMTP in production; log in development
  const payload = { email, phone: phone ? `***${phone.slice(-4)}` : null, channel };
  console.log('[otp]', payload, 'code:', process.env.LOG_OTP === 'true' ? otp : '(hidden)');
  return { sent: true };
}

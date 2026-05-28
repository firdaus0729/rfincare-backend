import crypto from 'node:crypto';

import { sendEmail } from './email.js';
import { getOtpProviderSettings } from './otpProviderSettings.js';

export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

function maskPhone(phone) {
  if (!phone) return null;
  const p = String(phone);
  return `***${p.slice(-4)}`;
}

function formatOtpMessage(template, otp) {
  const tpl =
    template || 'Your Rfincare verification code is {{otp}}. Valid for 10 minutes.';
  return tpl.replace(/\{\{otp\}\}/g, otp);
}

async function sendViaTwilio({ phone, message }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    throw new Error('Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.');
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const body = new URLSearchParams({
    To: phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '').slice(-10)}`,
    From: from,
    Body: message,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio SMS failed: ${errText.slice(0, 200)}`);
  }
  return { sent: true, provider: 'twilio' };
}

async function sendViaTwilioWhatsapp({ phone, message }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    throw new Error(
      'Twilio WhatsApp is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER.',
    );
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const clean = phone.replace(/\D/g, '').slice(-10);
  const to = `whatsapp:+91${clean}`;
  const fromValue = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  const body = new URLSearchParams({
    To: to,
    From: fromValue,
    Body: message,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio WhatsApp failed: ${errText.slice(0, 200)}`);
  }
  return { sent: true, provider: 'twilio' };
}

async function sendViaMsg91({ phone, otp, config }) {
  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey) {
    throw new Error('MSG91 is not configured. Set MSG91_AUTH_KEY in server environment.');
  }

  const mobile = phone.replace(/\D/g, '').slice(-10);
  const senderId = config?.msg91SenderId || process.env.MSG91_SENDER_ID || 'RFINCR';
  const templateId = config?.msg91TemplateId || process.env.MSG91_TEMPLATE_ID;

  if (templateId) {
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: [{ mobiles: `91${mobile}`, otp }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`MSG91 flow failed: ${errText.slice(0, 200)}`);
    }
    return { sent: true, provider: 'msg91', mode: 'template' };
  }

  const message = formatOtpMessage(config?.otpMessageTemplate, otp);
  const res = await fetch(
    `https://control.msg91.com/api/sendhttp.php?authkey=${encodeURIComponent(authKey)}&mobiles=91${mobile}&message=${encodeURIComponent(message)}&sender=${encodeURIComponent(senderId)}&route=4&country=91`,
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`MSG91 SMS failed: ${errText.slice(0, 200)}`);
  }
  return { sent: true, provider: 'msg91', mode: 'text' };
}

async function sendSmsOtp({ phone, otp, settings }) {
  const provider = settings?.smsProvider || 'console';
  const message = formatOtpMessage(settings?.providerConfig?.otpMessageTemplate, otp);

  if (provider === 'console') {
    console.log('[otp:sms]', { phone: maskPhone(phone), provider }, process.env.LOG_OTP === 'true' ? otp : '(hidden)');
    return { sent: true, provider: 'console' };
  }

  if (provider === 'twilio') {
    return sendViaTwilio({ phone, message });
  }

  if (provider === 'msg91') {
    return sendViaMsg91({ phone, otp, config: settings?.providerConfig });
  }

  throw new Error(`Unknown SMS provider: ${provider}`);
}

async function sendEmailOtp({ email, otp, settings }) {
  const provider = settings?.emailProvider || 'console';
  const subject = 'Your Rfincare verification code';
  const text = formatOtpMessage(settings?.providerConfig?.otpMessageTemplate, otp);
  const html = `<p>${text}</p><p>If you did not request this, please ignore this email.</p>`;

  if (provider === 'console') {
    console.log('[otp:email]', { email, provider }, process.env.LOG_OTP === 'true' ? otp : '(hidden)');
    return { sent: true, provider: 'console' };
  }

  if (provider === 'smtp') {
    return sendEmail({ to: email, subject, text, html });
  }

  throw new Error(`Unknown email provider: ${provider}`);
}

async function sendWhatsappOtp({ phone, otp, settings }) {
  const provider = settings?.whatsappProvider || 'console';
  const message = formatOtpMessage(settings?.providerConfig?.otpMessageTemplate, otp);

  if (provider === 'console') {
    console.log('[otp:whatsapp]', { phone: maskPhone(phone), provider }, process.env.LOG_OTP === 'true' ? otp : '(hidden)');
    return { sent: true, provider: 'console' };
  }
  if (provider === 'twilio') {
    return sendViaTwilioWhatsapp({ phone, message });
  }
  if (provider === 'msg91') {
    // Fallback through MSG91 message API; provider route decides WhatsApp template routing if configured.
    return sendViaMsg91({ phone, otp, config: settings?.providerConfig });
  }
  throw new Error(`Unknown WhatsApp provider: ${provider}`);
}

/**
 * Send OTP via configured operators. `channel` may be sms | email | both (default both when settings require it).
 */
export async function sendOtpNotification({ email, phone, otp, channel, settings: settingsOverride }) {
  const settings = settingsOverride || (await getOtpProviderSettings());
  const channels = [];

  const wantSms =
    channel === 'sms' ||
    channel === 'both' ||
    (!channel && settings.requireMobileOtp);
  const wantEmail =
    channel === 'email' ||
    channel === 'both' ||
    (!channel && settings.requireEmailOtp);
  const wantWhatsapp =
    channel === 'whatsapp' ||
    channel === 'both' ||
    (!channel && settings.requireWhatsappOtp);

  const results = {};

  if (wantSms && phone) {
    results.sms = await sendSmsOtp({ phone, otp, settings });
    channels.push('sms');
  }

  if (wantEmail && email) {
    results.email = await sendEmailOtp({ email, otp, settings });
    channels.push('email');
  }

  if (wantWhatsapp && phone) {
    results.whatsapp = await sendWhatsappOtp({ phone, otp, settings });
    channels.push('whatsapp');
  }

  if (!channels.length) {
    console.log('[otp]', { email, phone: maskPhone(phone), channel }, process.env.LOG_OTP === 'true' ? otp : '(hidden)');
  }

  return { sent: true, channels, ...results };
}

/**
 * Send separate OTP codes for mobile and email (eligibility / lead verification).
 */
export async function sendDualChannelOtp({ email, phone, settings: settingsOverride }) {
  const settings = settingsOverride || (await getOtpProviderSettings());
  const mobileOtp = generateOtp();
  const emailOtp = generateOtp();

  const tasks = [];

  if (settings.requireMobileOtp !== false && phone) {
    tasks.push(sendSmsOtp({ phone, otp: mobileOtp, settings }));
  }
  if (settings.requireEmailOtp !== false && email) {
    tasks.push(sendEmailOtp({ email, otp: emailOtp, settings }));
  }

  await Promise.all(tasks);

  return {
    mobileOtp: settings.requireMobileOtp !== false ? mobileOtp : null,
    emailOtp: settings.requireEmailOtp !== false ? emailOtp : null,
    smsProvider: settings.smsProvider,
    emailProvider: settings.emailProvider,
  };
}

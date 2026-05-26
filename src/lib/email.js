/**
 * Outbound email — configure SMTP_* in .env for production.
 * Falls back to console when SMTP is not configured (same pattern as OTP).
 */

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendViaSmtp({ to, subject, text, html }) {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
    html: html || text,
  });
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to) return { sent: false, reason: 'no_recipient' };

  if (smtpConfigured()) {
    await sendViaSmtp({ to, subject, text, html });
    return { sent: true, channel: 'smtp' };
  }

  console.log('[email]', { to, subject }, process.env.LOG_OTP === 'true' ? text : '(body hidden)');
  return { sent: true, channel: 'log' };
}

export async function sendStaffWelcomeEmail({ email, fullName, role, password, loginPath }) {
  const roleLabel = role === 'agent' ? 'Agent' : 'Employee';
  const appUrl = process.env.APP_PUBLIC_URL || process.env.API_PUBLIC_URL || 'http://127.0.0.1:4028';
  const loginUrl = `${appUrl.replace(/\/$/, '')}${loginPath || (role === 'agent' ? '/agent-login' : '/employee-login')}`;

  const subject = `Your Rfincare ${roleLabel} account`;
  const text = [
    `Hello ${fullName || email},`,
    '',
    `An administrator created your ${roleLabel} account on Rfincare.`,
    '',
    `Login URL: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'Please sign in and change your password after first login.',
    '',
    '— Rfincare Team',
  ].join('\n');

  const html = `
    <p>Hello ${fullName || email},</p>
    <p>Your <strong>Rfincare ${roleLabel}</strong> account is ready.</p>
    <ul>
      <li><strong>Login:</strong> <a href="${loginUrl}">${loginUrl}</a></li>
      <li><strong>Email:</strong> ${email}</li>
      <li><strong>Password:</strong> ${password}</li>
    </ul>
    <p>Please change your password after your first sign-in.</p>
  `;

  return sendEmail({ to: email, subject, text, html });
}

import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from './env.js';

let cachedTransporter: Transporter | null = null;
let cachedDisabled = false;

function getTransporter(): Transporter | null {
  if (cachedDisabled) return null;
  if (cachedTransporter) return cachedTransporter;
  const env = getEnv();
  if (!env.SMTP_HOST) {
    cachedDisabled = true;
    return null;
  }
  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return cachedTransporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends a transactional email. Returns true if delivered to the SMTP server,
 * false if the mailer is disabled (missing SMTP_HOST) or delivery fails.
 *
 * Callers should NEVER block user flows on the boolean — use it only for
 * logging/metrics. Password reset and verification still return 202 either way
 * to avoid leaking email enumeration.
 */
export async function sendMail(
  msg: MailMessage,
  logger?: { info?: (o: object, m: string) => void; warn?: (o: object, m: string) => void; error?: (o: object, m: string) => void },
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    logger?.warn?.({ to: msg.to, subject: msg.subject }, 'mailer disabled (SMTP_HOST empty); skipping send');
    return false;
  }
  const env = getEnv();
  try {
    const info = await transporter.sendMail({
      from: env.SMTP_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? msg.text.replace(/\n/g, '<br>'),
    });
    logger?.info?.({ to: msg.to, subject: msg.subject, messageId: info.messageId }, 'mail sent');
    return true;
  } catch (err) {
    logger?.error?.({ to: msg.to, subject: msg.subject, err: (err as Error).message }, 'mail send failed');
    return false;
  }
}

// --- Template helpers ----------------------------------------------------

const BRAND = 'Zentra';

function baseTemplate(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f6f9;margin:0;padding:24px;color:#191f4a;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 28px 24px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
      <h2 style="margin:0 0 16px;color:#191f4a;font-size:20px;">${heading}</h2>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #eceef4;margin:28px 0 16px;">
      <p style="font-size:12px;color:#8a90a8;margin:0;">${BRAND} &middot; <a href="https://usezentra.app" style="color:#8a90a8;">usezentra.app</a></p>
    </div>
  </body></html>`;
}

export function verificationCodeEmail(code: string): { subject: string; text: string; html: string } {
  const subject = `Your ${BRAND} verification code: ${code}`;
  const text = `Your ${BRAND} verification code is: ${code}\n\nThis code expires in 15 minutes. If you didn't request it, you can ignore this email.`;
  const html = baseTemplate('Verify your email', `
    <p style="margin:0 0 16px;">Use this code to verify your email address:</p>
    <div style="font-size:28px;letter-spacing:6px;font-weight:700;background:#f0f2f7;border-radius:8px;padding:14px;text-align:center;margin:0 0 16px;">${code}</div>
    <p style="margin:0;color:#56607a;font-size:14px;">This code expires in 15 minutes. If you didn't request it, you can ignore this email.</p>
  `);
  return { subject, text, html };
}

export function passwordResetEmail(resetUrl: string): { subject: string; text: string; html: string } {
  const subject = `Reset your ${BRAND} password`;
  const text = `Someone (hopefully you) requested a password reset for your ${BRAND} account.\n\nOpen this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
  const html = baseTemplate('Reset your password', `
    <p style="margin:0 0 16px;">Someone (hopefully you) requested a password reset.</p>
    <p style="margin:0 0 20px;">
      <a href="${resetUrl}" style="display:inline-block;background:#191f4a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">Set a new password</a>
    </p>
    <p style="margin:0 0 12px;color:#56607a;font-size:13px;">Or paste this link into your browser:</p>
    <p style="margin:0 0 16px;color:#56607a;font-size:12px;word-break:break-all;">${resetUrl}</p>
    <p style="margin:0;color:#8a90a8;font-size:12px;">This link is valid for 1 hour. If you didn't request it, you can ignore this email.</p>
  `);
  return { subject, text, html };
}

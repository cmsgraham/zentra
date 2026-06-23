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

// --- Huddle summary email --------------------------------------------------

export interface HuddleSummaryEmailPayload {
  huddleTitle: string;
  hostName: string | null;
  intention: string | null;
  endedAt: string | null;
  shareUrl: string | null;
  decisions: Array<{ topicTitle: string; decisionText: string; ownerName: string | null }>;
  intentions: Array<{ text: string; ownerName: string | null; softDueText: string | null; status: string }>;
  followups: Array<{ text: string; ownerName: string | null; reviewDate: string | null }>;
  notes: Array<{ text: string; authorName: string | null }>;
  hostSummary: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function huddleSummaryEmail(p: HuddleSummaryEmailPayload): { subject: string; text: string; html: string } {
  const subject = `Huddle summary: ${p.huddleTitle}`;

  // ── Plain text ──────────────────────────────────────────────────────────
  const txt: string[] = [];
  txt.push(`Huddle summary: ${p.huddleTitle}`);
  if (p.hostName) txt.push(`Host: ${p.hostName}`);
  if (p.endedAt) txt.push(`Ended: ${new Date(p.endedAt).toLocaleString()}`);
  if (p.intention) txt.push(`\nIntention: ${p.intention}`);

  if (p.decisions.length) {
    txt.push('\nDecisions:');
    for (const d of p.decisions) {
      txt.push(`  - ${d.topicTitle}: ${d.decisionText}${d.ownerName ? ` (owner: ${d.ownerName})` : ''}`);
    }
  }
  if (p.intentions.length) {
    txt.push('\nIntentions / next actions:');
    for (const i of p.intentions) {
      const tag = i.status === 'done' ? '[done] ' : '';
      txt.push(`  - ${tag}${i.text}${i.ownerName ? ` — ${i.ownerName}` : ''}${i.softDueText ? ` (${i.softDueText})` : ''}`);
    }
  }
  if (p.followups.length) {
    txt.push('\nFollow-ups:');
    for (const f of p.followups) {
      txt.push(`  - ${f.text}${f.ownerName ? ` — ${f.ownerName}` : ''}${f.reviewDate ? ` (review ${f.reviewDate})` : ''}`);
    }
  }
  if (p.notes.length) {
    txt.push('\nNotes:');
    for (const n of p.notes) {
      txt.push(`  - ${n.text}${n.authorName ? ` — ${n.authorName}` : ''}`);
    }
  }
  if (p.hostSummary) {
    txt.push(`\nHost's summary:\n${p.hostSummary}`);
  }
  if (p.shareUrl) {
    txt.push(`\nView online: ${p.shareUrl}`);
  }

  // ── HTML ────────────────────────────────────────────────────────────────
  const sections: string[] = [];

  if (p.intention) {
    sections.push(`<p style="margin:0 0 16px;font-style:italic;color:#56607a;">“${escapeHtml(p.intention)}”</p>`);
  }

  if (p.decisions.length) {
    sections.push(`<h3 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#8a90a8;">Decisions</h3>`);
    sections.push('<ul style="margin:0 0 12px;padding-left:18px;">' +
      p.decisions.map((d) =>
        `<li style="margin:0 0 8px;"><strong>${escapeHtml(d.topicTitle)}:</strong> ${escapeHtml(d.decisionText)}${d.ownerName ? ` <span style="color:#8a90a8;">(${escapeHtml(d.ownerName)})</span>` : ''}</li>`,
      ).join('') +
      '</ul>');
  }

  if (p.intentions.length) {
    sections.push(`<h3 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#8a90a8;">Intentions</h3>`);
    sections.push('<ul style="margin:0 0 12px;padding-left:18px;">' +
      p.intentions.map((i) => {
        const done = i.status === 'done';
        return `<li style="margin:0 0 6px;${done ? 'text-decoration:line-through;color:#8a90a8;' : ''}">${escapeHtml(i.text)}${i.ownerName ? ` <span style="color:#8a90a8;">— ${escapeHtml(i.ownerName)}</span>` : ''}${i.softDueText ? ` <span style="color:#8a90a8;">(${escapeHtml(i.softDueText)})</span>` : ''}</li>`;
      }).join('') +
      '</ul>');
  }

  if (p.followups.length) {
    sections.push(`<h3 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#8a90a8;">Follow-ups</h3>`);
    sections.push('<ul style="margin:0 0 12px;padding-left:18px;">' +
      p.followups.map((f) =>
        `<li style="margin:0 0 6px;">${escapeHtml(f.text)}${f.ownerName ? ` <span style="color:#8a90a8;">— ${escapeHtml(f.ownerName)}</span>` : ''}${f.reviewDate ? ` <span style="color:#8a90a8;">(review ${escapeHtml(f.reviewDate)})</span>` : ''}</li>`,
      ).join('') +
      '</ul>');
  }

  if (p.notes.length) {
    sections.push(`<h3 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#8a90a8;">Notes</h3>`);
    sections.push('<ul style="margin:0 0 12px;padding-left:18px;">' +
      p.notes.map((n) =>
        `<li style="margin:0 0 6px;">${escapeHtml(n.text)}${n.authorName ? ` <span style="color:#8a90a8;">— ${escapeHtml(n.authorName)}</span>` : ''}</li>`,
      ).join('') +
      '</ul>');
  }

  if (p.hostSummary) {
    sections.push(`<h3 style="margin:18px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em;color:#8a90a8;">Host's summary</h3>`);
    sections.push(`<p style="margin:0 0 12px;white-space:pre-wrap;">${escapeHtml(p.hostSummary)}</p>`);
  }

  if (p.shareUrl) {
    sections.push(
      `<p style="margin:24px 0 4px;"><a href="${p.shareUrl}" style="display:inline-block;background:#191f4a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:600;">View full summary online</a></p>`,
    );
  }

  const heading = `Summary: ${escapeHtml(p.huddleTitle)}`;
  const meta: string[] = [];
  if (p.hostName) meta.push(`Hosted by ${escapeHtml(p.hostName)}`);
  if (p.endedAt) meta.push(`Ended ${escapeHtml(new Date(p.endedAt).toLocaleString())}`);

  const html = baseTemplate(heading, `
    ${meta.length ? `<p style="margin:0 0 12px;color:#8a90a8;font-size:13px;">${meta.join(' &middot; ')}</p>` : ''}
    ${sections.join('')}
  `);

  return { subject, text: txt.join('\n'), html };
}


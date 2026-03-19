import nodemailer from 'nodemailer';
import { childLogger } from '../utils/logger.js';

const log = childLogger('mailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // STARTTLS
  auth: {
    user: process.env.SMTP_USER || 'tlvrescueflights@gmail.com',
    pass: process.env.SMTP_PASS || '',
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
});

const FROM = '"FlyTLV" <tlvrescueflights@gmail.com>';

export async function sendOTP(email: string, code: string): Promise<boolean> {
  try {
    await transporter.sendMail({
      from: FROM,
      to: email,
      subject: `${code} — Your FlyTLV Verification Code`,
      text: `Your FlyTLV verification code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not sign up for FlyTLV, ignore this email.`,
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 0">
          <div style="background:#0f172a;padding:24px 32px;border-radius:12px 12px 0 0">
            <h1 style="color:#fff;font-size:20px;margin:0;font-weight:800;letter-spacing:-.3px">FlyTLV</h1>
            <p style="color:rgba(255,255,255,.5);font-size:13px;margin:4px 0 0">Rescue Flight Scanner</p>
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:32px;border-radius:0 0 12px 12px">
            <p style="font-size:15px;color:#0f172a;margin:0 0 8px;font-weight:600">Verify your email</p>
            <p style="font-size:13px;color:#64748b;margin:0 0 24px;line-height:1.6">Enter this code in FlyTLV to complete your registration:</p>
            <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:10px;padding:20px;text-align:center;margin:0 0 24px">
              <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#0f172a">${code}</span>
            </div>
            <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.5">This code expires in 10 minutes. If you didn't sign up for FlyTLV, you can safely ignore this email.</p>
          </div>
        </div>
      `,
    });
    log.info({ email }, 'OTP email sent');
    return true;
  } catch (err) {
    log.error({ email, error: err instanceof Error ? err.message : String(err) }, 'Failed to send OTP email');
    return false;
  }
}

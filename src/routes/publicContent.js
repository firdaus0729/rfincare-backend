import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { calculateEligibility } from '../lib/eligibilityEngine.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { FRONTEND_ENV_PATH } from '../lib/envPaths.js';
import { entriesToObject, readEnvFile } from '../lib/envFile.js';

export const publicContentRouter = Router();

publicContentRouter.get('/runtime-config', async (_req, res, next) => {
  try {
    const { entries } = await readEnvFile(FRONTEND_ENV_PATH);
    const vars = entriesToObject(entries);
    const vite = Object.fromEntries(
      Object.entries(vars).filter(([key]) => key.startsWith('VITE_')),
    );
    res.json({ vite, updatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/homepage/news', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, title, excerpt, blog_url AS blogUrl, image_url AS imageUrl, image_alt AS imageAlt,
              category, published_at AS publishedAt
       FROM homepage_news WHERE is_published = 1 ORDER BY sort_order DESC, published_at DESC LIMIT 12`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/homepage/videos', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, title, description, youtube_url AS youtubeUrl, thumbnail_url AS thumbnailUrl,
              thumbnail_alt AS thumbnailAlt, duration_label AS durationLabel
       FROM homepage_videos WHERE is_published = 1 ORDER BY sort_order DESC LIMIT 12`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/legal/:slug', async (req, res, next) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT slug, title, body_html AS bodyHtml, updated_at AS updatedAt FROM legal_pages WHERE slug = :slug`,
      { slug: req.params.slug },
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/success-stories', async (req, res, next) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, submitter_name AS name, story_type AS storyType, story_text AS storyText,
              location, loan_amount AS loanAmount, created_at AS createdAt
       FROM success_stories WHERE moderation_status = 'approved'
       ORDER BY display_order DESC, moderated_at DESC LIMIT 20`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const StorySchema = z.object({
  submitterName: z.string().min(1),
  submitterEmail: z.string().email(),
  submitterPhone: z.string().optional(),
  storyType: z.enum(['customer', 'agent']).default('customer'),
  storyText: z.string().min(20),
  location: z.string().optional(),
  loanAmount: z.string().optional(),
});

publicContentRouter.post('/success-stories', async (req, res, next) => {
  try {
    const input = StorySchema.parse(req.body);
    const pool = getPool();
    const id = newId();
    await pool.execute(
      `INSERT INTO success_stories (id, submitter_name, submitter_email, submitter_phone, story_type, story_text, location, loan_amount, moderation_status)
       VALUES (:id, :name, :email, :phone, :type, :text, :loc, :amt, 'pending')`,
      {
        id,
        name: input.submitterName,
        email: input.submitterEmail,
        phone: input.submitterPhone ?? null,
        type: input.storyType,
        text: input.storyText,
        loc: input.location ?? null,
        amt: input.loanAmount ?? null,
      },
    );
    res.status(201).json({ id, status: 'pending' });
  } catch (err) {
    next(err);
  }
});

publicContentRouter.post('/eligibility/calculate', async (req, res, next) => {
  try {
    const result = await calculateEligibility(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const OtpRequestSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
});

publicContentRouter.post('/status-check/request-otp', async (req, res, next) => {
  try {
    const input = OtpRequestSchema.parse(req.body);
    const pool = getPool();
    const [[app]] = await pool.query(
      `SELECT la.id FROM loan_applications la
       JOIN user_profiles up ON up.id = la.customer_id
       WHERE up.email = :email LIMIT 1`,
      { email: input.email },
    );
    if (!app) {
      return res.status(404).json({ error: 'No application found for this email' });
    }

    const otp = generateOtp();
    const id = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.execute(
      `INSERT INTO status_check_otps (id, email, phone, otp_hash, channel, expires_at)
       VALUES (:id, :email, :phone, :hash, :channel, :exp)`,
      {
        id,
        email: input.email,
        phone: input.phone ?? null,
        hash: hashOtp(otp),
        channel: input.channel,
        exp: expiresAt,
      },
    );
    await sendOtpNotification({ ...input, otp });
    res.json({ success: true, message: 'OTP sent', expiresInSeconds: 600 });
  } catch (err) {
    next(err);
  }
});

const VerifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
  applicationNumber: z.string().min(1),
});

publicContentRouter.post('/status-check/verify', async (req, res, next) => {
  try {
    const input = VerifySchema.parse(req.body);
    const pool = getPool();
    const [[otpRow]] = await pool.query(
      `SELECT id FROM status_check_otps
       WHERE email = :email AND otp_hash = :hash AND verified_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      { email: input.email, hash: hashOtp(input.otp) },
    );
    if (!otpRow) return res.status(401).json({ error: 'Invalid or expired OTP' });

    await pool.execute(`UPDATE status_check_otps SET verified_at = NOW() WHERE id = :id`, { id: otpRow.id });

    const [[app]] = await pool.query(
      `SELECT la.application_number AS applicationNumber, la.status, la.eligibility_status AS eligibilityStatus,
              la.status_notes AS statusNotes, la.updated_at AS updatedAt, la.data
       FROM loan_applications la
       JOIN user_profiles up ON up.id = la.customer_id
       WHERE up.email = :email AND la.application_number = :num LIMIT 1`,
      { email: input.email, num: input.applicationNumber },
    );
    if (!app) return res.status(404).json({ error: 'Application not found' });

    res.json({ application: app });
  } catch (err) {
    next(err);
  }
});

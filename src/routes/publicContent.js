import { Router } from 'express';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { calculateEligibility } from '../lib/eligibilityEngine.js';
import { generateOtp, hashOtp, sendOtpNotification } from '../lib/otp.js';
import { getSiteContactSettings } from '../lib/siteContactSettings.js';
import { getHomepageTrustContent } from '../lib/homepageTrustContent.js';
import { getAboutPageContent } from '../lib/aboutPageContent.js';
import { getPublicOAuthConfig } from '../lib/oauthProviderSettings.js';
import { createResumeToken, resolveResumeToken } from '../lib/resumeTokens.js';
import { resolveFrontendEnvPath } from '../lib/envPaths.js';
import { entriesToObject, readEnvFile } from '../lib/envFile.js';

export const publicContentRouter = Router();

const uploadRoot = process.env.UPLOAD_DIR || './uploads';
const storyPhotoDir = resolve(uploadRoot, 'stories');
mkdirSync(storyPhotoDir, { recursive: true });

const storyPhotoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, storyPhotoDir),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Photo must be JPG, PNG, or WebP'), ok);
  },
});

publicContentRouter.get('/site-contact', async (_req, res, next) => {
  try {
    res.json(await getSiteContactSettings());
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/runtime-config', async (_req, res, next) => {
  try {
    const { path } = await resolveFrontendEnvPath();
    const { entries } = await readEnvFile(path);
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

publicContentRouter.get('/homepage/trust-signals', async (_req, res, next) => {
  try {
    res.json(await getHomepageTrustContent());
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/oauth-config', async (_req, res, next) => {
  try {
    res.json(await getPublicOAuthConfig());
  } catch (err) {
    next(err);
  }
});

publicContentRouter.get('/about-content', async (_req, res, next) => {
  try {
    res.json(await getAboutPageContent());
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
              location, loan_amount AS loanAmount, photo_url AS photoUrl, created_at AS createdAt
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

publicContentRouter.post('/success-stories', storyPhotoUpload.single('photo'), async (req, res, next) => {
  try {
    const input = StorySchema.parse(req.body);
    const pool = getPool();
    const id = newId();
    const photoUrl = req.file ? `/uploads/stories/${req.file.filename}` : null;

    await pool.execute(
      `INSERT INTO success_stories (
         id, submitter_name, submitter_email, submitter_phone, story_type, story_text,
         location, loan_amount, photo_url, moderation_status
       )
       VALUES (:id, :name, :email, :phone, :type, :text, :loc, :amt, :photo, 'pending')`,
      {
        id,
        name: input.submitterName,
        email: input.submitterEmail,
        phone: input.submitterPhone ?? null,
        type: input.storyType,
        text: input.storyText,
        loc: input.location ?? null,
        amt: input.loanAmount ?? null,
        photo: photoUrl,
      },
    );
    res.status(201).json({ id, status: 'pending', photoUrl });
  } catch (err) {
    if (err?.code === 'ER_BAD_FIELD_ERROR' && String(err?.message || '').includes('photo_url')) {
      err.status = 500;
      err.message = 'Database missing photo_url column. Run: npm run db:migrate';
    }
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

const DraftRecoveryRequestSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10),
  channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
});

publicContentRouter.post('/draft-recovery/request-otp', async (req, res, next) => {
  try {
    const input = DraftRecoveryRequestSchema.parse(req.body);
    const phone = input.phone.replace(/\D/g, '').slice(-10);
    const pool = getPool();

    const [[row]] = await pool.execute(
      `SELECT ml.id AS lead_id, ml.session_key
       FROM marketing_leads ml
       INNER JOIN application_form_drafts d ON d.session_key = ml.session_key
       WHERE ml.email = :email AND ml.phone = :phone
       ORDER BY d.updated_at DESC
       LIMIT 1`,
      { email: input.email, phone },
    );

    if (!row?.session_key) {
      return res.status(404).json({
        error: 'No saved application found for this email and mobile number.',
      });
    }

    const otp = generateOtp();
    const id = newId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.execute(
      `INSERT INTO lead_otps (id, lead_id, email, phone, otp_hash, purpose, channel, expires_at)
       VALUES (:id, :lead_id, :email, :phone, :hash, 'draft_resume', :channel, :exp)`,
      {
        id,
        lead_id: row.lead_id,
        email: input.email,
        phone,
        hash: hashOtp(otp),
        channel: input.channel,
        exp: expiresAt,
      },
    );

    await sendOtpNotification({
      email: input.email,
      phone,
      otp,
      channel: input.channel,
    });

    res.json({ success: true, message: 'OTP sent', expiresInSeconds: 600 });
  } catch (err) {
    next(err);
  }
});

const DraftRecoveryVerifySchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10),
  otp: z.string().length(6),
  frontendOrigin: z.string().url().optional(),
});

publicContentRouter.post('/draft-recovery/verify', async (req, res, next) => {
  try {
    const input = DraftRecoveryVerifySchema.parse(req.body);
    const phone = input.phone.replace(/\D/g, '').slice(-10);
    const pool = getPool();

    const [[otpRow]] = await pool.execute(
      `SELECT id, lead_id FROM lead_otps
       WHERE email = :email AND phone = :phone AND otp_hash = :hash
         AND purpose = 'draft_resume' AND verified_at IS NULL AND expires_at > NOW(3)
       ORDER BY created_at DESC LIMIT 1`,
      { email: input.email, phone, hash: hashOtp(input.otp) },
    );

    if (!otpRow) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await pool.execute(`UPDATE lead_otps SET verified_at = NOW(3) WHERE id = :id`, { id: otpRow.id });

    const [[lead]] = await pool.execute(
      `SELECT ml.id, ml.session_key
       FROM marketing_leads ml
       INNER JOIN application_form_drafts d ON d.session_key = ml.session_key
       WHERE ml.id = :id
       LIMIT 1`,
      { id: otpRow.lead_id },
    );

    if (!lead?.session_key) {
      return res.status(404).json({ error: 'Saved application no longer available' });
    }

    const link = await createResumeToken({
      sessionKey: lead.session_key,
      leadId: lead.id,
      frontendOrigin: input.frontendOrigin,
    });

    res.json({ resumeUrl: link.url, expiresAt: link.expiresAt });
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      err.status = 503;
      err.message = 'Run migration 008_milestone2_resume_tokens.sql';
    }
    next(err);
  }
});

publicContentRouter.get('/resume-application/:token', async (req, res, next) => {
  try {
    const resolved = await resolveResumeToken(req.params.token);
    if (!resolved) {
      return res.status(404).json({ error: 'Invalid resume link' });
    }
    if (resolved.error === 'expired') {
      return res.status(410).json({ error: 'This resume link has expired' });
    }
    if (resolved.error === 'already_used') {
      return res.status(410).json({ error: 'This resume link was already used' });
    }

    res.json({
      sessionKey: resolved.sessionKey,
      leadId: resolved.leadId,
      loanType: resolved.loanType,
      currentStep: resolved.currentStep,
      applicationId: resolved.applicationId,
    });
  } catch (err) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return res.status(503).json({ error: 'Resume links not enabled on server yet' });
    }
    next(err);
  }
});

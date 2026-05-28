import { Router } from 'express';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { getSiteContactSettings, updateSiteContactSettings } from '../lib/siteContactSettings.js';
import { getHomepageTrustContent, upsertHomepageTrustContent } from '../lib/homepageTrustContent.js';
import {
  EMAIL_PROVIDERS,
  getOtpProviderSettings,
  SMS_PROVIDERS,
  WHATSAPP_PROVIDERS,
  updateOtpProviderSettings,
} from '../lib/otpProviderSettings.js';
import { getOAuthAdminPayload, updateOAuthSettings } from '../lib/oauthProviderSettings.js';
import { getAboutPageContent, upsertAboutPageContent } from '../lib/aboutPageContent.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/requireRoles.js';

export const cmsRouter = Router();

cmsRouter.use(authenticate);
cmsRouter.use(requireRoles('admin', 'super_admin', 'employee'));

const NewsSchema = z.object({
  title: z.string().min(1),
  excerpt: z.string().optional(),
  blogUrl: z.string().url().optional().or(z.literal('')),
  imageUrl: z.string().optional(),
  imageAlt: z.string().optional(),
  category: z.string().optional(),
  publishedAt: z.string().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const VideoSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  youtubeUrl: z.string().url(),
  thumbnailUrl: z.string().optional(),
  thumbnailAlt: z.string().optional(),
  durationLabel: z.string().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

const SiteContactSchema = z.object({
  tagline: z.string().optional(),
  email: z.string().email(),
  phone: z.string().min(6),
  emails: z.array(z.string().email()).optional(),
  phones: z.array(z.string().min(6)).optional(),
  registeredOfficeLabel: z.string().optional(),
  registeredAddress: z.string().min(1),
  branchOfficeLabel: z.string().optional(),
  branchAddress: z.string().min(1),
  offices: z
    .array(
      z.object({
        title: z.string().min(1),
        address: z.string().min(1),
      }),
    )
    .optional(),
  socialFacebook: z.string().optional(),
  socialTwitter: z.string().optional(),
  socialLinkedin: z.string().optional(),
  socialInstagram: z.string().optional(),
});

const TrustSignalItemSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1),
  color: z.string().min(1),
});

const CertificationItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().min(1),
  description: z.string().min(1),
});

const HomepageTrustContentSchema = z.object({
  heading: z.string().min(1),
  subtitle: z.string().optional(),
  stats: z.array(TrustSignalItemSchema).min(1),
  certifications: z.array(CertificationItemSchema).min(1),
});

const AboutStatItemSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1),
  label: z.string().min(1),
});

const AboutValueItemSchema = z.object({
  id: z.string().min(1),
  icon: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
});

const OAuthProviderConfigSchema = z.object({
  provider: z.enum(['google', 'microsoft', 'apple']),
  enabled: z.boolean(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().url().optional().or(z.literal('')),
});

const OAuthSettingsSchema = z.object({
  global: z
    .object({
      apiPublicBaseUrl: z.string().url().optional().or(z.literal('')),
      frontendCallbackUrls: z.array(z.string().url()).optional(),
      requireAppliedCustomerEmail: z.boolean().optional(),
    })
    .optional(),
  providers: z.array(OAuthProviderConfigSchema).optional(),
});

const OtpProviderSettingsSchema = z.object({
  smsProvider: z.enum(SMS_PROVIDERS),
  whatsappProvider: z.enum(WHATSAPP_PROVIDERS).optional(),
  emailProvider: z.enum(EMAIL_PROVIDERS),
  requireMobileOtp: z.boolean().optional(),
  requireEmailOtp: z.boolean().optional(),
  requireWhatsappOtp: z.boolean().optional(),
  providerConfig: z
    .object({
      msg91SenderId: z.string().optional(),
      msg91TemplateId: z.string().optional(),
      otpMessageTemplate: z.string().optional(),
    })
    .optional(),
});

const AboutPageContentSchema = z.object({
  heroTitle: z.string().min(1),
  heroSubtitle: z.string().min(1),
  stats: z.array(AboutStatItemSchema).min(1),
  values: z.array(AboutValueItemSchema).min(1),
  storyHeading: z.string().min(1),
  storyParagraphs: z.array(z.string().min(1)).min(1),
});

cmsRouter.get('/site-contact', async (req, res, next) => {
  try {
    res.json(await getSiteContactSettings());
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/site-contact', async (req, res, next) => {
  try {
    const input = SiteContactSchema.parse(req.body);
    const updated = await updateSiteContactSettings(input, req.auth.userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/homepage/trust-signals', async (_req, res, next) => {
  try {
    res.json(await getHomepageTrustContent());
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/homepage/trust-signals', async (req, res, next) => {
  try {
    const input = HomepageTrustContentSchema.parse(req.body);
    const updated = await upsertHomepageTrustContent(input, req.auth.userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/about-content', async (_req, res, next) => {
  try {
    res.json(await getAboutPageContent());
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/oauth-settings', async (_req, res, next) => {
  try {
    res.json(await getOAuthAdminPayload());
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/oauth-settings', async (req, res, next) => {
  try {
    const input = OAuthSettingsSchema.parse(req.body);
    const updated = await updateOAuthSettings(input, req.auth.userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/otp-settings', async (_req, res, next) => {
  try {
    res.json(await getOtpProviderSettings());
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/otp-settings', async (req, res, next) => {
  try {
    const input = OtpProviderSettingsSchema.parse(req.body);
    const updated = await updateOtpProviderSettings(input, req.auth.userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/about-content', async (req, res, next) => {
  try {
    const input = AboutPageContentSchema.parse(req.body);
    const updated = await upsertAboutPageContent(input, req.auth.userId);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/news', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(
      `SELECT * FROM homepage_news ORDER BY sort_order DESC, created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

cmsRouter.post('/news', async (req, res, next) => {
  try {
    const input = NewsSchema.parse(req.body);
    const id = newId();
    await getPool().execute(
      `INSERT INTO homepage_news (id, title, excerpt, blog_url, image_url, image_alt, category, published_at, is_published, sort_order, created_by)
       VALUES (:id, :title, :excerpt, :blogUrl, :imageUrl, :imageAlt, :category, :pubAt, :pub, :sort, :by)`,
      {
        id,
        title: input.title,
        excerpt: input.excerpt ?? null,
        blogUrl: input.blogUrl || null,
        imageUrl: input.imageUrl ?? null,
        imageAlt: input.imageAlt ?? null,
        category: input.category ?? null,
        pubAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
        pub: input.isPublished ? 1 : 0,
        sort: input.sortOrder ?? 0,
        by: req.auth.userId,
      },
    );
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/news/:id', async (req, res, next) => {
  try {
    const input = NewsSchema.partial().parse(req.body);
    await getPool().execute(
      `UPDATE homepage_news SET
        title = COALESCE(:title, title),
        excerpt = COALESCE(:excerpt, excerpt),
        blog_url = COALESCE(:blogUrl, blog_url),
        image_url = COALESCE(:imageUrl, image_url),
        image_alt = COALESCE(:imageAlt, image_alt),
        category = COALESCE(:category, category),
        is_published = COALESCE(:pub, is_published),
        sort_order = COALESCE(:sort, sort_order)
       WHERE id = :id`,
      {
        id: req.params.id,
        title: input.title ?? null,
        excerpt: input.excerpt ?? null,
        blogUrl: input.blogUrl ?? null,
        imageUrl: input.imageUrl ?? null,
        imageAlt: input.imageAlt ?? null,
        category: input.category ?? null,
        pub: input.isPublished === undefined ? null : input.isPublished ? 1 : 0,
        sort: input.sortOrder ?? null,
      },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

cmsRouter.delete('/news/:id', async (req, res, next) => {
  try {
    await getPool().execute(`DELETE FROM homepage_news WHERE id = :id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/videos', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(`SELECT * FROM homepage_videos ORDER BY sort_order DESC`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

cmsRouter.post('/videos', async (req, res, next) => {
  try {
    const input = VideoSchema.parse(req.body);
    const id = newId();
    await getPool().execute(
      `INSERT INTO homepage_videos (id, title, description, youtube_url, thumbnail_url, thumbnail_alt, duration_label, is_published, sort_order, created_by)
       VALUES (:id, :title, :desc, :url, :thumb, :thumbAlt, :dur, :pub, :sort, :by)`,
      {
        id,
        title: input.title,
        desc: input.description ?? null,
        url: input.youtubeUrl,
        thumb: input.thumbnailUrl ?? null,
        thumbAlt: input.thumbnailAlt ?? null,
        dur: input.durationLabel ?? null,
        pub: input.isPublished ? 1 : 0,
        sort: input.sortOrder ?? 0,
        by: req.auth.userId,
      },
    );
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/videos/:id', async (req, res, next) => {
  try {
    const input = VideoSchema.partial().parse(req.body);
    await getPool().execute(
      `UPDATE homepage_videos SET
        title = COALESCE(:title, title),
        description = COALESCE(:desc, description),
        youtube_url = COALESCE(:url, youtube_url),
        thumbnail_url = COALESCE(:thumb, thumbnail_url),
        is_published = COALESCE(:pub, is_published),
        sort_order = COALESCE(:sort, sort_order)
       WHERE id = :id`,
      {
        id: req.params.id,
        title: input.title ?? null,
        desc: input.description ?? null,
        url: input.youtubeUrl ?? null,
        thumb: input.thumbnailUrl ?? null,
        pub: input.isPublished === undefined ? null : input.isPublished ? 1 : 0,
        sort: input.sortOrder ?? null,
      },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

cmsRouter.delete('/videos/:id', async (req, res, next) => {
  try {
    await getPool().execute(`DELETE FROM homepage_videos WHERE id = :id`, { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/legal', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(`SELECT slug, title, updated_at FROM legal_pages ORDER BY slug`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

cmsRouter.put('/legal/:slug', async (req, res, next) => {
  try {
    const { title, bodyHtml } = z.object({ title: z.string(), bodyHtml: z.string() }).parse(req.body);
    await getPool().execute(
      `UPDATE legal_pages SET title = :title, body_html = :body, updated_by = :by WHERE slug = :slug`,
      { slug: req.params.slug, title, body: bodyHtml, by: req.auth.userId },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

cmsRouter.get('/success-stories', async (req, res, next) => {
  try {
    const status = req.query.status || 'pending';
    const [rows] = await getPool().query(
      `SELECT * FROM success_stories WHERE moderation_status = :status ORDER BY created_at DESC`,
      { status },
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

cmsRouter.post('/success-stories/:id/moderate', async (req, res, next) => {
  try {
    const { action, rejectionReason } = z.object({
      action: z.enum(['approve', 'reject']),
      rejectionReason: z.string().optional(),
    }).parse(req.body);
    await getPool().execute(
      `UPDATE success_stories SET moderation_status = :status, moderated_by = :by, moderated_at = NOW(), rejection_reason = :reason WHERE id = :id`,
      {
        id: req.params.id,
        status: action === 'approve' ? 'approved' : 'rejected',
        by: req.auth.userId,
        reason: rejectionReason ?? null,
      },
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

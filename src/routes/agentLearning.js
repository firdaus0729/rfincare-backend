import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { z } from 'zod';

import { getPool } from '../db/pool.js';
import { newId } from '../lib/ids.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { ensureAgentLearningSchema } from '../db/ensureAgentLearningSchema.js';

export const adminAgentLearningRouter = Router();
export const portalAgentLearningRouter = Router();

const CONTENT_TYPES = new Set([
  'video',
  'pdf',
  'presentation',
  'circular',
  'course',
  'webinar',
  'certification',
]);

const TRAINING_TYPE_MAP = {
  video: 'video',
  pdf: 'document',
  presentation: 'document',
  circular: 'document',
  course: 'course',
  webinar: 'webinar',
  certification: 'certification',
};

const uploadRoot = process.env.UPLOAD_DIR || './uploads';
const learningDir = resolve(uploadRoot, 'agent-learning');
mkdirSync(learningDir, { recursive: true });

const learningUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, learningDir),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${extname(file.originalname)}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function formatContentRow(row, progress = null) {
  const progressPercent = progress?.progress_percent ?? 0;
  return {
    id: row.id,
    contentType: row.content_type,
    type: TRAINING_TYPE_MAP[row.content_type] || 'document',
    title: row.title,
    description: row.description,
    duration: row.duration_label || '',
    durationLabel: row.duration_label,
    fileName: row.file_name,
    fileUrl: row.file_url,
    videoUrl: row.video_url,
    mimeType: row.mime_type,
    isNew: Boolean(row.is_new),
    isActive: Boolean(row.is_active),
    sortOrder: row.sort_order,
    progress: progressPercent,
    completedAt: progress?.completed_at || null,
    createdAt: row.created_at,
    openUrl: row.video_url || row.file_url,
  };
}

async function fetchLearningForAgent(pool, agentUserId) {
  await ensureAgentLearningSchema();
  const [rows] = await pool.execute(
    `SELECT c.*, p.progress_percent, p.completed_at
     FROM agent_learning_content c
     LEFT JOIN agent_learning_progress p
       ON p.content_id = c.id AND p.agent_user_id = :agentId
     WHERE c.is_active = 1 AND c.audience IN ('agent', 'all')
     ORDER BY c.is_new DESC, c.sort_order ASC, c.created_at DESC`,
    { agentId: agentUserId },
  );
  return rows.map((r) =>
    formatContentRow(r, {
      progress_percent: r.progress_percent,
      completed_at: r.completed_at,
    }),
  );
}

/** Include legacy commission circulars in agent feed */
async function fetchLegacyCirculars(pool) {
  try {
    const [rows] = await pool.execute(
      `SELECT id, title, description, file_name, file_url, created_at
       FROM agent_commission_circulars
       WHERE is_active = 1
       ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: `circular-${r.id}`,
      contentType: 'circular',
      type: 'document',
      title: r.title,
      description: r.description,
      duration: 'PDF',
      fileName: r.file_name,
      fileUrl: r.file_url,
      videoUrl: null,
      isNew: false,
      progress: 0,
      createdAt: r.created_at,
      openUrl: r.file_url,
      legacy: true,
    }));
  } catch {
    return [];
  }
}

// ——— Admin ———

adminAgentLearningRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'agents', action: 'read' }),
  async (_req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT * FROM agent_learning_content
         WHERE audience IN ('agent', 'all')
         ORDER BY sort_order ASC, created_at DESC`,
      );
      res.json(rows.map((r) => formatContentRow(r)));
    } catch (err) {
      next(err);
    }
  },
);

adminAgentLearningRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  learningUpload.single('file'),
  async (req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const contentType = String(req.body?.contentType || req.body?.content_type || 'pdf').toLowerCase();
      if (!CONTENT_TYPES.has(contentType)) {
        return res.status(400).json({ error: 'Invalid content type' });
      }

      const title = req.body?.title?.trim();
      if (!title) return res.status(400).json({ error: 'Title is required' });

      const videoUrl = req.body?.videoUrl?.trim() || req.body?.video_url?.trim() || null;
      if (contentType === 'video' && !videoUrl && !req.file) {
        return res.status(400).json({ error: 'Video URL or file is required for video content' });
      }
      if (contentType !== 'video' && !req.file && !videoUrl) {
        return res.status(400).json({ error: 'File upload is required' });
      }

      const id = newId();
      const pool = getPool();
      let fileUrl = null;
      let filePath = null;
      let fileName = null;
      let mimeType = null;

      if (req.file) {
        fileName = req.file.originalname;
        filePath = req.file.path;
        mimeType = req.file.mimetype;
        fileUrl = `/uploads/agent-learning/${req.file.filename}`;
      }

      await pool.execute(
        `INSERT INTO agent_learning_content
         (id, content_type, audience, title, description, category_label, duration_label, file_name, file_path, file_url, mime_type,
          video_url, is_new, sort_order, uploaded_by)
         VALUES
         (:id, :content_type, :audience, :title, :description, :category_label, :duration_label, :file_name, :file_path, :file_url, :mime_type,
          :video_url, :is_new, :sort_order, :uploaded_by)`,
        {
          id,
          content_type: contentType,
          audience: req.body?.audience === 'all' ? 'all' : 'agent',
          title,
          description: req.body?.description?.trim() || null,
          category_label: req.body?.categoryLabel?.trim() || req.body?.category_label?.trim() || null,
          duration_label: req.body?.durationLabel?.trim() || req.body?.duration_label?.trim() || null,
          file_name: fileName,
          file_path: filePath,
          file_url: fileUrl,
          mime_type: mimeType,
          video_url: videoUrl,
          is_new: req.body?.isNew === 'false' || req.body?.isNew === false ? 0 : 1,
          sort_order: Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order ?? '0', 10) || 0,
          uploaded_by: req.auth.userId,
        },
      );

      const [[row]] = await pool.execute(`SELECT * FROM agent_learning_content WHERE id = :id`, { id });
      res.status(201).json(formatContentRow(row));
    } catch (err) {
      next(err);
    }
  },
);

const PatchLearningSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  durationLabel: z.string().optional(),
  videoUrl: z.string().optional(),
  isNew: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  contentType: z.string().optional(),
});

adminAgentLearningRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const input = PatchLearningSchema.parse(req.body);
      const pool = getPool();
      await pool.execute(
        `UPDATE agent_learning_content SET
          title = COALESCE(:title, title),
          description = COALESCE(:description, description),
          duration_label = COALESCE(:duration_label, duration_label),
          video_url = COALESCE(:video_url, video_url),
          is_new = COALESCE(:is_new, is_new),
          is_active = COALESCE(:is_active, is_active),
          sort_order = COALESCE(:sort_order, sort_order),
          content_type = COALESCE(:content_type, content_type)
         WHERE id = :id`,
        {
          id: req.params.id,
          title: input.title || null,
          description: input.description ?? null,
          duration_label: input.durationLabel ?? null,
          video_url: input.videoUrl ?? null,
          is_new: input.isNew == null ? null : input.isNew ? 1 : 0,
          is_active: input.isActive == null ? null : input.isActive ? 1 : 0,
          sort_order: input.sortOrder ?? null,
          content_type: input.contentType || null,
        },
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

adminAgentLearningRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'agents', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const pool = getPool();
      await pool.execute(
        `UPDATE agent_learning_content SET is_active = 0 WHERE id = :id`,
        { id: req.params.id },
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ——— Agent portal ———

portalAgentLearningRouter.use(authenticate);

portalAgentLearningRouter.get('/', async (req, res, next) => {
  try {
    if (req.auth.role !== 'agent' && !['admin', 'super_admin'].includes(req.auth.role)) {
      const e = new Error('Agent access only');
      e.status = 403;
      throw e;
    }
    const pool = getPool();
    const items = await fetchLearningForAgent(pool, req.auth.userId);
    const legacy = await fetchLegacyCirculars(pool);
    const seen = new Set(items.map((i) => i.title));
    const merged = [
      ...items,
      ...legacy.filter((l) => !seen.has(l.title)),
    ];
    res.json(merged);
  } catch (err) {
    next(err);
  }
});

portalAgentLearningRouter.post('/:id/progress', async (req, res, next) => {
  try {
    if (req.auth.role !== 'agent') {
      const e = new Error('Agent access only');
      e.status = 403;
      throw e;
    }
    if (String(req.params.id).startsWith('circular-')) {
      return res.json({ ok: true, progress: req.body?.progress ?? 100 });
    }

    const progress = Math.min(100, Math.max(0, Number.parseInt(req.body?.progress ?? 0, 10) || 0));
    await ensureAgentLearningSchema();
    const pool = getPool();
    const contentId = req.params.id;

    const [[content]] = await pool.execute(
      `SELECT id FROM agent_learning_content WHERE id = :id AND is_active = 1 AND audience IN ('agent', 'all') LIMIT 1`,
      { id: contentId },
    );
    if (!content) return res.status(404).json({ error: 'Content not found' });

    const progressId = newId();
    await pool.execute(
      `INSERT INTO agent_learning_progress (id, agent_user_id, content_id, progress_percent, completed_at)
       VALUES (:id, :agent_id, :content_id, :progress, :completed_at)
       ON DUPLICATE KEY UPDATE
         progress_percent = :progress,
         completed_at = :completed_at,
         updated_at = NOW(3)`,
      {
        id: progressId,
        agent_id: req.auth.userId,
        content_id: contentId,
        progress,
        completed_at: progress >= 100 ? new Date() : null,
      },
    );

    res.json({ ok: true, progress });
  } catch (err) {
    next(err);
  }
});

export async function getAgentLearningFeed(pool, agentUserId) {
  const items = await fetchLearningForAgent(pool, agentUserId);
  const legacy = await fetchLegacyCirculars(pool);
  const seen = new Set(items.map((i) => i.title));
  return [...items, ...legacy.filter((l) => !seen.has(l.title))];
}

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

export const adminEmployeeLearningRouter = Router();
export const portalEmployeeLearningRouter = Router();

const CONTENT_TYPES = new Set([
  'video',
  'pdf',
  'presentation',
  'circular',
  'course',
  'webinar',
  'certification',
]);

const CATEGORY_BY_TYPE = {
  video: 'System Training',
  pdf: 'Document Verification',
  presentation: 'Compliance',
  circular: 'Compliance',
  course: 'Document Verification',
  webinar: 'System Training',
  certification: 'Compliance',
};

const uploadRoot = process.env.UPLOAD_DIR || './uploads';
const staffLearningDir = resolve(uploadRoot, 'staff-learning');
mkdirSync(staffLearningDir, { recursive: true });

const staffUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, staffLearningDir),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${extname(file.originalname)}`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function formatEmployeeContentRow(row, progress = null, completionCount = 0) {
  const progressPercent = progress?.progress_percent ?? 0;
  const category =
    row.category_label || CATEGORY_BY_TYPE[row.content_type] || 'Document Verification';
  return {
    id: row.id,
    contentType: row.content_type,
    type: row.content_type,
    category,
    categoryLabel: category,
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
    completions: String(completionCount || 0),
    completedAt: progress?.completed_at || null,
    createdAt: row.created_at,
    openUrl: row.video_url || row.file_url,
    audience: row.audience,
  };
}

async function fetchLearningForEmployee(pool, employeeUserId) {
  await ensureAgentLearningSchema();
  const [rows] = await pool.execute(
    `SELECT c.*, p.progress_percent, p.completed_at,
            (SELECT COUNT(*) FROM employee_learning_progress ep
             WHERE ep.content_id = c.id AND ep.progress_percent >= 100) AS completion_count
     FROM agent_learning_content c
     LEFT JOIN employee_learning_progress p
       ON p.content_id = c.id AND p.employee_user_id = :employeeId
     WHERE c.is_active = 1 AND c.audience IN ('employee', 'all')
     ORDER BY c.is_new DESC, c.sort_order ASC, c.created_at DESC`,
    { employeeId: employeeUserId },
  );
  return rows.map((r) =>
    formatEmployeeContentRow(
      r,
      { progress_percent: r.progress_percent, completed_at: r.completed_at },
      r.completion_count,
    ),
  );
}

export async function getEmployeeLearningFeed(pool, employeeUserId) {
  return fetchLearningForEmployee(pool, employeeUserId);
}

// ——— Admin ———

adminEmployeeLearningRouter.get(
  '/',
  authenticate,
  authorize({ resource: 'employees', action: 'read' }),
  async (_req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const pool = getPool();
      const [rows] = await pool.execute(
        `SELECT * FROM agent_learning_content
         WHERE audience IN ('employee', 'all')
         ORDER BY sort_order ASC, created_at DESC`,
      );
      res.json(rows.map((r) => formatEmployeeContentRow(r, null, 0)));
    } catch (err) {
      next(err);
    }
  },
);

adminEmployeeLearningRouter.post(
  '/',
  authenticate,
  authorize({ resource: 'employees', action: 'update' }),
  staffUpload.single('file'),
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
        fileUrl = `/uploads/staff-learning/${req.file.filename}`;
      }

      const categoryLabel =
        req.body?.categoryLabel?.trim() ||
        req.body?.category_label?.trim() ||
        CATEGORY_BY_TYPE[contentType] ||
        null;

      await pool.execute(
        `INSERT INTO agent_learning_content
         (id, content_type, audience, title, description, category_label, duration_label, file_name, file_path, file_url, mime_type,
          video_url, is_new, sort_order, uploaded_by)
         VALUES
         (:id, :content_type, 'employee', :title, :description, :category_label, :duration_label, :file_name, :file_path, :file_url, :mime_type,
          :video_url, :is_new, :sort_order, :uploaded_by)`,
        {
          id,
          content_type: contentType,
          title,
          description: req.body?.description?.trim() || null,
          category_label: categoryLabel,
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
      res.status(201).json(formatEmployeeContentRow(row));
    } catch (err) {
      next(err);
    }
  },
);

const PatchLearningSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  durationLabel: z.string().optional(),
  categoryLabel: z.string().optional(),
  videoUrl: z.string().optional(),
  isNew: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  contentType: z.string().optional(),
});

adminEmployeeLearningRouter.patch(
  '/:id',
  authenticate,
  authorize({ resource: 'employees', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const input = PatchLearningSchema.parse(req.body);
      const pool = getPool();
      await pool.execute(
        `UPDATE agent_learning_content SET
          title = COALESCE(:title, title),
          description = COALESCE(:description, description),
          category_label = COALESCE(:category_label, category_label),
          duration_label = COALESCE(:duration_label, duration_label),
          video_url = COALESCE(:video_url, video_url),
          is_new = COALESCE(:is_new, is_new),
          is_active = COALESCE(:is_active, is_active),
          sort_order = COALESCE(:sort_order, sort_order),
          content_type = COALESCE(:content_type, content_type)
         WHERE id = :id AND audience IN ('employee', 'all')`,
        {
          id: req.params.id,
          title: input.title || null,
          description: input.description ?? null,
          category_label: input.categoryLabel ?? null,
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

adminEmployeeLearningRouter.delete(
  '/:id',
  authenticate,
  authorize({ resource: 'employees', action: 'update' }),
  async (req, res, next) => {
    try {
      await ensureAgentLearningSchema();
      const pool = getPool();
      await pool.execute(
        `UPDATE agent_learning_content SET is_active = 0
         WHERE id = :id AND audience IN ('employee', 'all')`,
        { id: req.params.id },
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ——— Employee portal ———

portalEmployeeLearningRouter.use(authenticate);

portalEmployeeLearningRouter.get('/', async (req, res, next) => {
  try {
    if (req.auth.role !== 'employee' && !['admin', 'super_admin'].includes(req.auth.role)) {
      const e = new Error('Employee access only');
      e.status = 403;
      throw e;
    }
    const pool = getPool();
    const items = await fetchLearningForEmployee(pool, req.auth.userId);
    res.json(items);
  } catch (err) {
    next(err);
  }
});

portalEmployeeLearningRouter.post('/:id/progress', async (req, res, next) => {
  try {
    if (req.auth.role !== 'employee') {
      const e = new Error('Employee access only');
      e.status = 403;
      throw e;
    }

    const progress = Math.min(100, Math.max(0, Number.parseInt(req.body?.progress ?? 0, 10) || 0));
    await ensureAgentLearningSchema();
    const pool = getPool();
    const contentId = req.params.id;

    const [[content]] = await pool.execute(
      `SELECT id FROM agent_learning_content
       WHERE id = :id AND is_active = 1 AND audience IN ('employee', 'all') LIMIT 1`,
      { id: contentId },
    );
    if (!content) return res.status(404).json({ error: 'Content not found' });

    const progressId = newId();
    await pool.execute(
      `INSERT INTO employee_learning_progress (id, employee_user_id, content_id, progress_percent, completed_at)
       VALUES (:id, :employee_id, :content_id, :progress, :completed_at)
       ON DUPLICATE KEY UPDATE
         progress_percent = :progress,
         completed_at = :completed_at,
         updated_at = NOW(3)`,
      {
        id: progressId,
        employee_id: req.auth.userId,
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

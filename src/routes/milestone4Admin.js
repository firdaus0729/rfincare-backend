import { Router } from 'express';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { authenticate } from '../middleware/authenticate.js';
import {
  getFileNotificationSettings,
  saveFileNotificationSettings,
} from '../lib/fileNotificationService.js';
import {
  listCibilVendors,
  updateCibilVendor,
  pullCibilForApplication,
  getLatestCibilCheck,
} from '../lib/cibilService.js';
import { getUploadDir } from '../lib/uploadPaths.js';

export const milestone4AdminRouter = Router();

function requireAdmin(req) {
  if (!['admin', 'super_admin'].includes(req.auth.role)) {
    const e = new Error('Admin access required');
    e.status = 403;
    throw e;
  }
}

milestone4AdminRouter.use(authenticate);

milestone4AdminRouter.get('/cibil-vendors', async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json({ vendors: await listCibilVendors() });
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.put('/cibil-vendors/:vendorKey', async (req, res, next) => {
  try {
    requireAdmin(req);
    const payload = z
      .object({
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        sandboxMode: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    const vendors = await updateCibilVendor(req.params.vendorKey, payload, req.auth.userId);
    res.json({ vendors });
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.post('/cibil-sandbox/:applicationId', async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await pullCibilForApplication(req.params.applicationId, { forceSandbox: true });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.get('/applications/:applicationId/cibil', async (req, res, next) => {
  try {
    if (!['admin', 'super_admin', 'employee'].includes(req.auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const check = await getLatestCibilCheck(req.params.applicationId);
    res.json({ check });
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.get('/applications/:applicationId/cibil/report', async (req, res, next) => {
  try {
    if (!['admin', 'super_admin', 'employee'].includes(req.auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const check = await getLatestCibilCheck(req.params.applicationId);
    if (!check?.reportPath) return res.status(404).json({ error: 'Report not found' });
    const fileName = check.reportPath.split('/').pop();
    const fullPath = resolve(getUploadDir(), 'cibil-reports', fileName);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cibil-${fileName}"`);
    res.send(readFileSync(fullPath));
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.get('/file-notification-settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json(await getFileNotificationSettings());
  } catch (err) {
    next(err);
  }
});

milestone4AdminRouter.put('/file-notification-settings', async (req, res, next) => {
  try {
    requireAdmin(req);
    const settings = await saveFileNotificationSettings(req.body, req.auth.userId);
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import {
  buildAgentCommissionReport,
  commissionReportToCsv,
  commissionReportToPdf,
} from '../lib/commissionReportService.js';
import { ensureMilestone4Schema } from '../db/ensureMilestone4Schema.js';

export const portalAgentMilestone4Router = Router();

portalAgentMilestone4Router.use(authenticate);

portalAgentMilestone4Router.get('/commission-report', async (req, res, next) => {
  try {
    if (req.auth.role !== 'agent' && !['admin', 'super_admin'].includes(req.auth.role)) {
      return res.status(403).json({ error: 'Agent access only' });
    }
    await ensureMilestone4Schema();
    const agentId = req.query.agentId || req.auth.userId;
    if (req.auth.role === 'agent' && agentId !== req.auth.userId) {
      return res.status(403).json({ error: 'Cannot view other agent reports' });
    }

    const report = await buildAgentCommissionReport(agentId, {
      from: req.query.from || null,
      to: req.query.to || null,
      applicationStatus: req.query.applicationStatus || 'all',
      commissionStatus: req.query.commissionStatus || 'all',
      loanType: req.query.loanType || 'all',
    });

    const format = String(req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="commission-report-${Date.now()}.csv"`,
      );
      return res.send(commissionReportToCsv(report));
    }
    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="commission-report-${Date.now()}.pdf"`,
      );
      return res.send(commissionReportToPdf(report));
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

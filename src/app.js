import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { errorMiddleware } from './middleware/errorMiddleware.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { profilesRouter } from './routes/profiles.js';
import { banksRouter } from './routes/banks.js';
import { bankProductsRouter } from './routes/bankProducts.js';
import { documentsRouter } from './routes/documents.js';
import { statesRouter } from './routes/states.js';
import { loanApplicationsRouter } from './routes/loanApplications.js';
import { adminRouter } from './routes/admin.js';
import { publicContentRouter } from './routes/publicContent.js';
import { cmsRouter } from './routes/cms.js';
import { oauthRouter } from './routes/oauth.js';
import { developmentRouter } from './routes/development.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { getCorsOptions } from './lib/corsOptions.js';

export function createApp({ serveStatic = true } = {}) {
  const app = express();

  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/profiles', profilesRouter);
  app.use('/banks', banksRouter);
  app.use('/bank-products', bankProductsRouter);
  app.use('/documents', documentsRouter);
  app.use('/states', statesRouter);
  app.use('/loan-applications', loanApplicationsRouter);
  app.use('/admin', adminRouter);
  app.use('/public', publicContentRouter);
  app.use('/cms', cmsRouter);
  app.use('/auth/oauth', oauthRouter);
  app.use('/development-panel', developmentRouter);
  app.use('/audit-logs', auditLogsRouter);

  app.use(errorMiddleware);

  if (!serveStatic) {
    return app;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const buildPath = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(__dirname, '../../frontend/dist');

  app.use(express.static(buildPath));

  app.get('*', (req, res) => {
    if (
      req.path.startsWith('/api')
      || req.path.startsWith('/auth')
      || req.path.startsWith('/development-panel')
      || req.path.startsWith('/public')
    ) {
      return res.status(404).json({ message: 'Not Found' });
    }
    res.sendFile(path.join(buildPath, 'index.html'));
  });

  return app;
}


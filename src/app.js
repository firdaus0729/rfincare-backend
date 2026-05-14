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

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.API_CORS_ORIGIN ? process.env.API_CORS_ORIGIN.split(',').map((s) => s.trim()) : true,
      credentials: true,
    }),
  );
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

  app.use(errorMiddleware);
  
  // Serve static files from the "build" directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const buildPath = process.env.FRONTEND_DIST
    ? path.resolve(process.env.FRONTEND_DIST)
    : path.resolve(__dirname, '../../frontend/dist');
  
  app.use(express.static(buildPath));

  // Catch-all route to serve the frontend for SPA routing
  app.get('*', (req, res) => {
    // Skip if it's an API request that didn't match (already handled by routers above)
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
      return res.status(404).json({ message: 'Not Found' });
    }
    res.sendFile(path.join(buildPath, 'index.html'));
  });

  return app;
}


import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes/index.js';
import { AppError } from './utils/errors.js';

export function createApp(io) {
  const app = express();
  app.use(helmet());
  const allowedOrigins = process.env.CLIENT_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) || ['http://localhost:5173'];
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '1mb' }));
  routes.io = io;
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', routes);
  app.use((_req, _res, next) => next(new AppError(404, 'Route not found')));
  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    let message = err.message || 'Internal server error';
    if (err.name === 'ZodError') { status = 400; message = 'Request validation failed'; }
    if (err.code === 'P2002') { status = 409; message = 'A record with one of these values already exists'; }
    if (err.code === 'P2003') { status = 400; message = 'The request references a related record that does not exist'; }
    if (err.code === 'P2025') { status = 404; message = 'The requested record was not found'; }
    if (err.code === 'P2023' || err.code === 'P2009') { status = 400; message = 'A request identifier or field has an invalid format'; }
    if (err.code === 'P2034') { status = 409; message = 'A concurrent transaction conflicted. Refresh and retry.'; }
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : message, code: err.code || 'ERROR' });
  });
  return app;
}

import 'dotenv/config';
import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { configureSockets } from './sockets/index.js';
import { prisma } from './config/db.js';

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('DATABASE_URL and JWT_SECRET must be configured before starting the server.');
}

const allowedOrigins = process.env.CLIENT_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) || ['http://localhost:5173'];
const io = new Server();
const app = createApp(io);
const httpServer = http.createServer(app);
io.attach(httpServer, { cors: { origin: allowedOrigins } });
configureSockets(io);

const port = Number(process.env.PORT || 5000);
httpServer.listen(port, () => console.log(`API and Socket.IO server listening on http://localhost:${port}`));

async function shutdown() {
  await new Promise(resolve => io.close(resolve));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

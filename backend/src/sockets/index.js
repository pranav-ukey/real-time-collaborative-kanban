import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';

const onlineByTenant = new Map(); // tenantId -> Map(userId -> connection count)
function presencePayload(tenantId) {
  const users = onlineByTenant.get(tenantId) || new Map();
  return [...users.keys()];
}
export function configureSockets(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const tenantId = socket.handshake.auth?.tenantId;
      if (!token || !tenantId) return next(new Error('Authentication and tenant context required'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const membership = await prisma.membership.findFirst({
        where: { userId: payload.sub, OR: [{ tenantId }, { tenantId: null, role: 'ORG_ADMIN' }] },
        include: { tenant: true }
      });
      if (!membership) return next(new Error('Tenant access denied'));
      if (membership.tenantId === null) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!tenant || tenant.organizationId !== membership.organizationId) return next(new Error('Tenant access denied'));
      }
      socket.userId = payload.sub;
      socket.tenantId = tenantId;
      socket.userName = (await prisma.user.findUnique({ where: { id: payload.sub }, select: { name: true } }))?.name || 'User';
      next();
    } catch { next(new Error('Invalid or expired socket token')); }
  });

  io.on('connection', socket => {
    const { tenantId, userId, userName } = socket;
    const room = `tenant:${tenantId}`;
    socket.join(room);
    if (!onlineByTenant.has(tenantId)) onlineByTenant.set(tenantId, new Map());
    const users = onlineByTenant.get(tenantId);
    users.set(userId, (users.get(userId) || 0) + 1);
    io.to(room).emit('presence:update', { tenantId, onlineUserIds: presencePayload(tenantId) });
    socket.emit('presence:joined', { tenantId, userId, userName, onlineUserIds: presencePayload(tenantId) });

    // Mutations are performed through authenticated REST endpoints; clients cannot broadcast arbitrary task changes.
    socket.on('presence:ping', () => socket.emit('presence:pong', { at: Date.now() }));
    socket.on('disconnect', () => {
      const count = (users.get(userId) || 1) - 1;
      if (count <= 0) users.delete(userId); else users.set(userId, count);
      if (users.size === 0) onlineByTenant.delete(tenantId);
      io.to(room).emit('presence:update', { tenantId, onlineUserIds: presencePayload(tenantId) });
    });
  });
}

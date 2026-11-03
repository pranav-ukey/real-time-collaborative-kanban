import { prisma } from '../config/db.js';
export async function logActivity(tx, { tenantId, userId, entityType, entityId, action, details }) {
  return tx.activityLog.create({ data: { tenantId, userId, entityType, entityId, action, details: JSON.parse(JSON.stringify(details)) } });
}
export async function publishTenant(io, tenantId, event, payload) {
  io.to(`tenant:${tenantId}`).emit(event, payload);
}

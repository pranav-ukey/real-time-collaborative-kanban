import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { AppError } from '../utils/errors.js';

export async function authenticate(req, _res, next) {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) throw new AppError(401, 'Authentication required');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true }
    });
    if (!user) throw new AppError(401, 'Invalid authentication');
    req.user = user;
    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(401, 'Invalid or expired token'));
  }
}

export async function requireTenant(req, _res, next) {
  try {
    const tenantId = req.params.tenantId || req.headers['x-tenant-id'] || req.body?.tenantId || req.query.tenantId;
    if (!tenantId) throw new AppError(400, 'Tenant context is required');
    const tenant = await prisma.tenant.findUnique({ where: { id: String(tenantId) } });
    if (!tenant) throw new AppError(404, 'Tenant not found');

    // Prefer an organization-level Org Admin membership so an additional
    // tenant membership cannot accidentally downgrade the user's privileges.
    const orgAdmin = await prisma.membership.findFirst({
      where: { userId: req.user.id, organizationId: tenant.organizationId, tenantId: null, role: 'ORG_ADMIN' },
      include: { organization: true }
    });
    const membership = orgAdmin || await prisma.membership.findFirst({
      where: { userId: req.user.id, organizationId: tenant.organizationId, tenantId: tenant.id },
      include: { organization: true, tenant: true }
    });
    if (!membership) throw new AppError(403, 'You do not have access to this tenant');

    req.membership = { ...membership, tenant };
    req.tenantId = tenant.id;
    req.organizationId = tenant.organizationId;
    req.role = membership.role;
    next();
  } catch (error) {
    next(error);
  }
}

export const allowRoles = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.role)) return next(new AppError(403, 'Insufficient permissions'));
  next();
};

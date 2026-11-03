import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { authenticate, requireTenant, allowRoles } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { logActivity } from '../services/audit.js';

const router = Router();
const io = () => router.io;
const emit = (tenantId, event, payload) => io()?.to(`tenant:${tenantId}`).emit(event, payload);
const cleanUser = ({ id, name, email }) => ({ id, name, email });
async function membershipForTenant(userId, tenantId) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, organizationId: true } });
  if (!tenant) return null;
  const orgAdmin = await prisma.membership.findFirst({ where: { userId, organizationId: tenant.organizationId, tenantId: null, role: 'ORG_ADMIN' } });
  if (orgAdmin) return orgAdmin;
  return prisma.membership.findFirst({ where: { userId, organizationId: tenant.organizationId, tenantId: tenant.id } });
}

// Authentication. Registration bootstraps one organization, one tenant and an Org Admin.
router.post('/auth/register', asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8), organizationName: z.string().min(2), tenantName: z.string().min(2) }).parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (exists) throw new AppError(409, 'Email is already registered');
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { name: input.name, email: input.email.toLowerCase(), passwordHash } });
    const organization = await tx.organization.create({ data: { name: input.organizationName } });
    const tenant = await tx.tenant.create({ data: { name: input.tenantName, organizationId: organization.id } });
    await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: 'ORG_ADMIN' } });
    await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, tenantId: tenant.id, role: 'ORG_ADMIN' } });
    return { user, organization, tenant };
  });
  const token = jwt.sign({ sub: result.user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  res.status(201).json({ token, user: cleanUser(result.user), organization: result.organization, tenant: result.tenant });
}));

router.post('/auth/login', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, 'Invalid email or password');
  const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  res.json({ token, user: cleanUser(user) });
}));
router.get('/auth/me', authenticate, asyncHandler(async (req, res) => {
  const memberships = await prisma.membership.findMany({ where: { userId: req.user.id }, include: { organization: true, tenant: true } });
  res.json({ user: req.user, memberships });
}));

router.use(authenticate);

router.get('/organizations', asyncHandler(async (req, res) => {
  const memberships = await prisma.membership.findMany({ where: { userId: req.user.id }, include: { organization: true } });
  const unique = new Map(memberships.map(m => [m.organization.id, m.organization]));
  res.json([...unique.values()]);
}));
router.get('/organizations/:organizationId', asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: req.params.organizationId } });
  if (!membership) throw new AppError(404, 'Organization not found');
  const organization = await prisma.organization.findUnique({ where: { id: req.params.organizationId } });
  const memberships = await prisma.membership.findMany({ where: { userId: req.user.id, organizationId: organization.id } });
  const isOrgAdmin = memberships.some(m => m.tenantId === null && m.role === 'ORG_ADMIN');
  const tenantIds = memberships.map(m => m.tenantId).filter(Boolean);
  const tenants = await prisma.tenant.findMany({ where: { organizationId: organization.id, ...(isOrgAdmin ? {} : { id: { in: tenantIds } }) }, orderBy: { createdAt: 'asc' } });
  res.json({ ...organization, tenants });
}));
router.put('/organizations/:organizationId', asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: req.params.organizationId, tenantId: null, role: 'ORG_ADMIN' } });
  if (!membership) throw new AppError(403, 'Org Admin permission required');
  const name = z.string().min(2).parse(req.body.name);
  res.json(await prisma.organization.update({ where: { id: req.params.organizationId }, data: { name } }));
}));
router.delete('/organizations/:organizationId', asyncHandler(async (req, res) => {
  const membership = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: req.params.organizationId, tenantId: null, role: 'ORG_ADMIN' } });
  if (!membership) throw new AppError(403, 'Org Admin permission required');
  await prisma.organization.delete({ where: { id: req.params.organizationId } });
  res.status(204).send();
}));

router.post('/organizations', asyncHandler(async (req, res) => {
  const name = z.string().min(2).parse(req.body.name);
  const organization = await prisma.$transaction(async tx => {
    const org = await tx.organization.create({ data: { name } });
    await tx.membership.create({ data: { userId: req.user.id, organizationId: org.id, role: 'ORG_ADMIN' } });
    return org;
  });
  res.status(201).json(organization);
}));
router.get('/organizations/:organizationId/tenants', asyncHandler(async (req, res) => {
  const orgId = req.params.organizationId;
  const memberships = await prisma.membership.findMany({ where: { userId: req.user.id, organizationId: orgId } });
  if (!memberships.length) throw new AppError(403, 'Organization access denied');
  const isOrgAdmin = memberships.some(m => m.tenantId === null && m.role === 'ORG_ADMIN');
  const tenantIds = memberships.map(m => m.tenantId).filter(Boolean);
  const tenants = await prisma.tenant.findMany({
    where: { organizationId: orgId, ...(isOrgAdmin ? {} : { id: { in: tenantIds } }) },
    orderBy: { createdAt: 'asc' }
  });
  res.json(tenants);
}));
router.post('/organizations/:organizationId/tenants', asyncHandler(async (req, res) => {
  const orgId = req.params.organizationId;
  const orgMembership = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: orgId, tenantId: null, role: 'ORG_ADMIN' } });
  if (!orgMembership) throw new AppError(403, 'Org Admin permission required');
  const name = z.string().min(2).parse(req.body.name);
  const tenant = await prisma.$transaction(async tx => {
    const created = await tx.tenant.create({ data: { name, organizationId: orgId } });
    await logActivity(tx, { tenantId: created.id, userId: req.user.id, entityType: 'TENANT', entityId: created.id, action: 'CREATED', details: { name: created.name } });
    return created;
  });
  res.status(201).json(tenant);
}));
router.get('/tenants/:tenantId', authenticate, asyncHandler(async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!tenant) throw new AppError(404, 'Tenant not found');
  const membership = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: tenant.organizationId, OR: [{ tenantId: tenant.id }, { tenantId: null, role: 'ORG_ADMIN' }] } });
  if (!membership) throw new AppError(404, 'Tenant not found');
  res.json(tenant);
}));
router.put('/tenants/:tenantId', authenticate, asyncHandler(async (req, res) => {
  const tenantId = req.params.tenantId;
  const m = await membershipForTenant(req.user.id, tenantId);
  if (!m || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(m.role) || (m.tenantId === null && m.role !== 'ORG_ADMIN')) throw new AppError(403, 'Admin permission required');
  const tenant = await prisma.tenant.update({ where: { id: tenantId }, data: { name: z.string().min(2).parse(req.body.name) } });
  res.json(tenant);
}));
router.delete('/tenants/:tenantId', authenticate, asyncHandler(async (req, res) => {
  const tenantId = req.params.tenantId;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new AppError(404, 'Tenant not found');
  const m = await prisma.membership.findFirst({ where: { userId: req.user.id, organizationId: tenant.organizationId, tenantId: null, role: 'ORG_ADMIN' } });
  if (!m) throw new AppError(403, 'Org Admin permission required');
  await prisma.tenant.delete({ where: { id: tenantId } });
  res.status(204).send();
}));

// Tenant members and roles.
router.get('/tenants/:tenantId/members', authenticate, requireTenant, asyncHandler(async (req, res) => {
  const rows = await prisma.membership.findMany({ where: { organizationId: req.organizationId, OR: [{ tenantId: req.tenantId }, { tenantId: null, role: 'ORG_ADMIN' }] }, include: { user: { select: { id: true, name: true, email: true } } } });
  const unique = new Map();
  for (const membership of rows) {
    const previous = unique.get(membership.userId);
    if (!previous || membership.tenantId !== null) unique.set(membership.userId, membership);
  }
  res.json([...unique.values()].map(m => ({ membershipId: m.id, user: m.user, role: m.role })));
}));
router.post('/tenants/:tenantId/members', authenticate, requireTenant, allowRoles('ORG_ADMIN', 'TENANT_ADMIN'), asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email(), role: z.enum(['TENANT_ADMIN', 'MEMBER']) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw new AppError(404, 'User must register before being added');
  const membership = await prisma.$transaction(async tx => {
    const existing = await tx.membership.findFirst({ where: { userId: user.id, organizationId: req.organizationId, tenantId: req.tenantId } });
    if (existing) return tx.membership.update({ where: { id: existing.id }, data: { role: input.role } });
    return tx.membership.create({ data: { userId: user.id, organizationId: req.organizationId, tenantId: req.tenantId, role: input.role } });
  }, { isolationLevel: 'Serializable' });
  res.status(201).json(membership);
}));

// Boards.
router.get('/tenants/:tenantId/boards', authenticate, requireTenant, asyncHandler(async (req, res) => {
  const boards = await prisma.board.findMany({ where: { tenantId: req.tenantId }, include: { columns: { where: { tenantId: req.tenantId }, orderBy: { position: 'asc' }, include: { tasks: { where: { tenantId: req.tenantId }, orderBy: { position: 'asc' }, include: { assignee: { select: { id: true, name: true, email: true } } } } } } }, orderBy: { createdAt: 'asc' } });
  res.json(boards);
}));
router.post('/tenants/:tenantId/boards', authenticate, requireTenant, allowRoles('ORG_ADMIN', 'TENANT_ADMIN'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(1), description: z.string().optional() }).parse(req.body);
  const board = await prisma.$transaction(async tx => {
    const b = await tx.board.create({ data: { ...input, tenantId: req.tenantId, organizationId: req.organizationId, createdBy: req.user.id } });
    for (const [position, name] of ['To Do', 'In Progress', 'Testing', 'Done'].entries()) await tx.column.create({ data: { boardId: b.id, tenantId: req.tenantId, name, position } });
    await logActivity(tx, { tenantId: req.tenantId, userId: req.user.id, entityType: 'BOARD', entityId: b.id, action: 'CREATED', details: { name: b.name } });
    return tx.board.findUnique({ where: { id: b.id }, include: { columns: { orderBy: { position: 'asc' } } } });
  });
  emit(req.tenantId, 'board:created', board);
  res.status(201).json(board);
}));
router.get('/boards/:boardId', authenticate, asyncHandler(async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.boardId } });
  if (!board) throw new AppError(404, 'Board not found');
  const membership = await membershipForTenant(req.user.id, board.tenantId);
  if (!membership) throw new AppError(404, 'Board not found');
  const detailed = await prisma.board.findUnique({
    where: { id: board.id },
    include: {
      columns: {
        where: { tenantId: board.tenantId },
        orderBy: { position: 'asc' },
        include: {
          tasks: {
            where: { tenantId: board.tenantId },
            orderBy: { position: 'asc' },
            include: { assignee: { select: { id: true, name: true, email: true } } }
          }
        }
      }
    }
  });
  res.json(detailed);
}));
router.put('/boards/:boardId', authenticate, asyncHandler(async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.boardId } });
  if (!board) throw new AppError(404, 'Board not found');
  const membership = await membershipForTenant(req.user.id, board.tenantId);
  if (!membership || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(membership.role)) throw new AppError(403, 'Admin permission required');
  const input = z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional() }).parse(req.body);
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.board.update({ where: { id: board.id }, data: input });
    await logActivity(tx, { tenantId: board.tenantId, userId: req.user.id, entityType: 'BOARD', entityId: board.id, action: 'UPDATED', details: { before: board, after: result } });
    return result;
  });
  emit(board.tenantId, 'board:updated', updated);
  res.json(updated);
}));
router.delete('/boards/:boardId', authenticate, asyncHandler(async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.boardId } });
  if (!board) throw new AppError(404, 'Board not found');
  const m = await membershipForTenant(req.user.id, board.tenantId);
  if (!m || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(m.role)) throw new AppError(403, 'Admin permission required');
  await prisma.$transaction(async tx => {
    await logActivity(tx, { tenantId: board.tenantId, userId: req.user.id, entityType: 'BOARD', entityId: board.id, action: 'DELETED', details: { before: board } });
    await tx.board.delete({ where: { id: board.id } });
  }, { isolationLevel: 'Serializable' });
  emit(board.tenantId, 'board:deleted', { id: board.id });
  res.status(204).send();
}));

// Columns.
router.post('/boards/:boardId/columns', authenticate, asyncHandler(async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.boardId } });
  if (!board) throw new AppError(404, 'Board not found');
  const m = await membershipForTenant(req.user.id, board.tenantId);
  if (!m || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(m.role)) throw new AppError(403, 'Admin permission required');
  const input = z.object({ name: z.string().min(1) }).parse(req.body);
  const column = await prisma.$transaction(async tx => {
    const position = await tx.column.count({ where: { boardId: board.id, tenantId: board.tenantId } });
    const created = await tx.column.create({ data: { ...input, boardId: board.id, tenantId: board.tenantId, position } });
    await logActivity(tx, { tenantId: board.tenantId, userId: req.user.id, entityType: 'COLUMN', entityId: created.id, action: 'CREATED', details: { after: created } });
    return created;
  }, { isolationLevel: 'Serializable' });
  emit(board.tenantId, 'column:created', column);
  res.status(201).json(column);
}));
router.get('/boards/:boardId/columns', authenticate, asyncHandler(async (req, res) => {
  const board = await prisma.board.findUnique({ where: { id: req.params.boardId } });
  if (!board) throw new AppError(404, 'Board not found');
  const membership = await membershipForTenant(req.user.id, board.tenantId);
  if (!membership) throw new AppError(404, 'Board not found');
  res.json(await prisma.column.findMany({ where: { boardId: board.id, tenantId: board.tenantId }, orderBy: { position: 'asc' } }));
}));
router.get('/columns/:columnId', authenticate, asyncHandler(async (req, res) => {
  const column = await prisma.column.findUnique({ where: { id: req.params.columnId } });
  if (!column) throw new AppError(404, 'Column not found');
  const membership = await membershipForTenant(req.user.id, column.tenantId);
  if (!membership) throw new AppError(404, 'Column not found');
  res.json(column);
}));
router.put('/columns/:columnId', authenticate, asyncHandler(async (req, res) => {
  const column = await prisma.column.findUnique({ where: { id: req.params.columnId } });
  if (!column) throw new AppError(404, 'Column not found');
  const m = await membershipForTenant(req.user.id, column.tenantId);
  if (!m || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(m.role)) throw new AppError(403, 'Admin permission required');
  const data = z.object({ name: z.string().min(1).optional(), position: z.number().int().nonnegative().optional() }).parse(req.body);
  const updated = await prisma.$transaction(async tx => {
    if (data.position !== undefined) {
      const ordered = await tx.column.findMany({ where: { boardId: column.boardId, tenantId: column.tenantId }, orderBy: { position: 'asc' } });
      const withoutCurrent = ordered.filter(item => item.id !== column.id);
      const target = Math.min(data.position, withoutCurrent.length);
      withoutCurrent.splice(target, 0, column);
      // Move positions to unique negative values first to avoid transient unique-key collisions.
      for (const [index, item] of withoutCurrent.entries()) await tx.column.update({ where: { id: item.id }, data: { position: -(index + 1) } });
      for (const [position, item] of withoutCurrent.entries()) {
        await tx.column.update({ where: { id: item.id }, data: { position, ...(item.id === column.id && data.name ? { name: data.name } : {}) } });
      }
    } else {
      await tx.column.update({ where: { id: column.id }, data: { name: data.name } });
    }
    const result = await tx.column.findUnique({ where: { id: column.id } });
    await logActivity(tx, { tenantId: column.tenantId, userId: req.user.id, entityType: 'COLUMN', entityId: column.id, action: 'UPDATED', details: { before: column, after: result } });
    return result;
  }, { isolationLevel: 'Serializable' });
  emit(column.tenantId, 'column:updated', updated);
  res.json(updated);
}));
router.delete('/columns/:columnId', authenticate, asyncHandler(async (req, res) => {
  const column = await prisma.column.findUnique({ where: { id: req.params.columnId } });
  if (!column) throw new AppError(404, 'Column not found');
  const m = await membershipForTenant(req.user.id, column.tenantId);
  if (!m || !['ORG_ADMIN', 'TENANT_ADMIN'].includes(m.role)) throw new AppError(403, 'Admin permission required');
  await prisma.$transaction(async tx => {
    if (await tx.task.count({ where: { columnId: column.id, tenantId: column.tenantId } })) throw new AppError(409, 'Move or delete tasks before deleting this column');
    await logActivity(tx, { tenantId: column.tenantId, userId: req.user.id, entityType: 'COLUMN', entityId: column.id, action: 'DELETED', details: { before: column } });
    await tx.column.delete({ where: { id: column.id } });
    const remaining = await tx.column.findMany({ where: { boardId: column.boardId, tenantId: column.tenantId }, orderBy: { position: 'asc' } });
    for (const [position, item] of remaining.entries()) if (item.position !== position) await tx.column.update({ where: { id: item.id }, data: { position } });
  }, { isolationLevel: 'Serializable' });
  emit(column.tenantId, 'column:deleted', { id: column.id });
  res.status(204).send();
}));

async function getAuthorizedTask(taskId, userId) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError(404, 'Task not found');
  const membership = await membershipForTenant(userId, task.tenantId);
  if (!membership) throw new AppError(404, 'Task not found');
  const [board, column] = await Promise.all([
    prisma.board.findUnique({ where: { id: task.boardId }, select: { id: true, tenantId: true } }),
    prisma.column.findUnique({ where: { id: task.columnId }, select: { id: true, boardId: true, tenantId: true } })
  ]);
  if (!board || !column || board.tenantId !== task.tenantId || column.tenantId !== task.tenantId || column.boardId !== board.id) {
    throw new AppError(404, 'Task not found');
  }
  return task;
}
router.post('/tenants/:tenantId/tasks', authenticate, requireTenant, asyncHandler(async (req, res) => {
  const input = z.object({ boardId: z.string().uuid(), columnId: z.string().uuid(), title: z.string().min(1), description: z.string().optional(), assignedTo: z.string().uuid().nullable().optional(), priority: z.enum(['LOW','MEDIUM','HIGH']).optional(), dueDate: z.string().datetime().nullable().optional() }).parse(req.body);
  const [board, column] = await Promise.all([prisma.board.findUnique({ where: { id: input.boardId } }), prisma.column.findUnique({ where: { id: input.columnId } })]);
  if (!board || board.tenantId !== req.tenantId || !column || column.tenantId !== req.tenantId || column.boardId !== board.id) throw new AppError(400, 'Board and column must belong to the active tenant and board');
  if (input.assignedTo) {
    const assigneeMembership = await membershipForTenant(input.assignedTo, req.tenantId);
    if (!assigneeMembership) throw new AppError(400, 'Assignee must be a member of this tenant');
  }
  const task = await prisma.$transaction(async tx => {
    const position = await tx.task.count({ where: { tenantId: req.tenantId, columnId: column.id } });
    const created = await tx.task.create({ data: { ...input, dueDate: input.dueDate ? new Date(input.dueDate) : null, tenantId: req.tenantId, position } });
    await logActivity(tx, { tenantId: req.tenantId, userId: req.user.id, entityType: 'TASK', entityId: created.id, action: 'CREATED', details: { after: created } });
    return tx.task.findUnique({ where: { id: created.id }, include: { assignee: { select: { id: true, name: true, email: true } } } });
  }, { isolationLevel: 'Serializable' });
  emit(req.tenantId, 'task:created', task);
  res.status(201).json(task);
}));
router.get('/tenants/:tenantId/tasks', authenticate, requireTenant, asyncHandler(async (req, res) => {
  const tasks = await prisma.task.findMany({ where: { tenantId: req.tenantId, ...(req.query.boardId ? { boardId: String(req.query.boardId) } : {}) }, include: { assignee: { select: { id: true, name: true, email: true } } }, orderBy: [{ columnId: 'asc' }, { position: 'asc' }] });
  res.json(tasks);
}));
router.get('/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
  const task = await getAuthorizedTask(req.params.taskId, req.user.id);
  const detailed = await prisma.task.findUnique({ where: { id: task.id }, include: { assignee: { select: { id: true, name: true, email: true } }, column: true } });
  res.json(detailed);
}));
router.put('/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
  const task = await getAuthorizedTask(req.params.taskId, req.user.id);
  const membership = await membershipForTenant(req.user.id, task.tenantId);
  const input = z.object({ title: z.string().min(1).optional(), description: z.string().nullable().optional(), assignedTo: z.string().uuid().nullable().optional(), priority: z.enum(['LOW','MEDIUM','HIGH']).optional(), dueDate: z.string().datetime().nullable().optional(), expectedVersion: z.number().int().positive() }).parse(req.body);
  if (input.assignedTo) {
    const valid = await membershipForTenant(input.assignedTo, task.tenantId);
    if (!valid) throw new AppError(400, 'Assignee must belong to this tenant');
  }
  const before = task;
  const data = { ...input }; delete data.expectedVersion;
  if (data.dueDate !== undefined) data.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.task.updateMany({ where: { id: task.id, tenantId: task.tenantId, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (!result.count) throw new AppError(409, 'Task was changed by another user. Refresh and resolve the conflict.');
    const current = await tx.task.findUnique({ where: { id: task.id }, include: { assignee: { select: { id: true, name: true, email: true } } } });
    await logActivity(tx, { tenantId: task.tenantId, userId: req.user.id, entityType: 'TASK', entityId: task.id, action: 'UPDATED', details: { before, after: current } });
    return current;
  });
  emit(task.tenantId, 'task:updated', updated);
  res.json(updated);
}));
router.patch('/tasks/:taskId/move', authenticate, asyncHandler(async (req, res) => {
  const task = await getAuthorizedTask(req.params.taskId, req.user.id);
  const input = z.object({ destinationColumnId: z.string().uuid(), position: z.number().int().nonnegative(), expectedVersion: z.number().int().positive() }).parse(req.body);
  const destination = await prisma.column.findUnique({ where: { id: input.destinationColumnId } });
  if (!destination || destination.tenantId !== task.tenantId || destination.boardId !== task.boardId) throw new AppError(400, 'Destination column is not part of this task board');

  let moved;
  try {
    moved = await prisma.$transaction(async tx => {
      const sourceItems = await tx.task.findMany({ where: { tenantId: task.tenantId, columnId: task.columnId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
      const destinationItems = task.columnId === destination.id ? sourceItems : await tx.task.findMany({ where: { tenantId: task.tenantId, columnId: destination.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
      const claim = await tx.task.updateMany({
        where: { id: task.id, tenantId: task.tenantId, version: input.expectedVersion },
        data: { columnId: destination.id, version: { increment: 1 } }
      });
      if (!claim.count) throw new AppError(409, 'Task was moved or edited by another user. Refresh the board.');

      const sourceWithoutTask = sourceItems.filter(item => item.id !== task.id);
      const destinationWithoutTask = task.columnId === destination.id ? sourceWithoutTask : destinationItems.filter(item => item.id !== task.id);
      const targetList = task.columnId === destination.id ? sourceWithoutTask : destinationWithoutTask;
      const insertAt = Math.min(input.position, targetList.length);
      targetList.splice(insertAt, 0, { ...task, columnId: destination.id });

      if (task.columnId !== destination.id) {
        for (const [position, item] of sourceWithoutTask.entries()) {
          if (item.position !== position) await tx.task.update({ where: { id: item.id }, data: { position, version: { increment: 1 } } });
        }
      }
      for (const [position, item] of targetList.entries()) {
        if (item.id === task.id) {
          await tx.task.update({ where: { id: task.id }, data: { columnId: destination.id, position } });
        } else if (item.position !== position || item.columnId !== destination.id) {
          await tx.task.update({ where: { id: item.id }, data: { position, version: { increment: 1 } } });
        }
      }
      const current = await tx.task.findUnique({ where: { id: task.id }, include: { assignee: { select: { id: true, name: true, email: true } } } });
      await logActivity(tx, { tenantId: task.tenantId, userId: req.user.id, entityType: 'TASK', entityId: task.id, action: 'MOVED', details: { before: task, after: current } });
      return current;
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw new AppError(409, 'Another task reorder committed at the same time. Refresh the board and retry.');
    throw error;
  }
  emit(task.tenantId, 'task:moved', moved);
  res.json(moved);
}));
router.delete('/tasks/:taskId', authenticate, asyncHandler(async (req, res) => {
  const task = await getAuthorizedTask(req.params.taskId, req.user.id);
  const membership = await membershipForTenant(req.user.id, task.tenantId);
  if (!membership) throw new AppError(403, 'Tenant access denied');
  const expectedVersion = Number(req.query.version);
  if (!Number.isInteger(expectedVersion)) throw new AppError(400, 'Task version is required as query parameter version');
  await prisma.$transaction(async tx => {
    const deleted = await tx.task.deleteMany({ where: { id: task.id, tenantId: task.tenantId, version: expectedVersion } });
    if (!deleted.count) throw new AppError(409, 'Task changed before deletion. Refresh and retry.');
    await logActivity(tx, { tenantId: task.tenantId, userId: req.user.id, entityType: 'TASK', entityId: task.id, action: 'DELETED', details: { before: task } });
    const remaining = await tx.task.findMany({ where: { tenantId: task.tenantId, columnId: task.columnId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    for (const [position, item] of remaining.entries()) {
      if (item.position !== position) await tx.task.update({ where: { id: item.id }, data: { position, version: { increment: 1 } } });
    }
  }, { isolationLevel: 'Serializable' });
  emit(task.tenantId, 'task:deleted', { id: task.id, tenantId: task.tenantId });
  res.status(204).send();
}));

router.get('/tenants/:tenantId/activity', authenticate, requireTenant, asyncHandler(async (req, res) => {
  const logs = await prisma.activityLog.findMany({ where: { tenantId: req.tenantId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json(logs);
}));
async function historyCandidates(client, tenantId, userId) {
  const logs = await client.activityLog.findMany({ where: { tenantId, userId, entityType: 'TASK' }, orderBy: { createdAt: 'desc' }, take: 300 });
  const state = new Map();
  for (const log of logs) {
    if (['UNDONE', 'REDONE'].includes(log.action) && log.details?.targetLogId && !state.has(log.details.targetLogId)) {
      state.set(log.details.targetLogId, log);
    }
  }
  return logs
    .filter(log => ['CREATED', 'UPDATED', 'MOVED', 'DELETED'].includes(log.action))
    .map(log => ({ log, transition: state.get(log.id) || null }));
}

function taskSnapshotData(snapshot) {
  return {
    title: snapshot.title,
    description: snapshot.description,
    assignedTo: snapshot.assignedTo,
    priority: snapshot.priority,
    dueDate: snapshot.dueDate ? new Date(snapshot.dueDate) : null,
    columnId: snapshot.columnId,
    position: snapshot.position
  };
}

async function placeTaskAt(tx, tenantId, taskId, columnId, requestedPosition) {
  const siblings = await tx.task.findMany({
    where: { tenantId, columnId, id: { not: taskId } },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
  });
  siblings.splice(Math.min(Math.max(0, requestedPosition), siblings.length), 0, { id: taskId });
  for (const [position, item] of siblings.entries()) {
    if (item.id === taskId) {
      await tx.task.update({ where: { id: taskId }, data: { position } });
    } else if (item.position !== position) {
      await tx.task.update({ where: { id: item.id }, data: { position, version: { increment: 1 } } });
    }
  }
}

async function compactTaskColumn(tx, tenantId, columnId) {
  const tasks = await tx.task.findMany({ where: { tenantId, columnId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  for (const [position, item] of tasks.entries()) {
    if (item.position !== position) await tx.task.update({ where: { id: item.id }, data: { position, version: { increment: 1 } } });
  }
}

router.post('/tenants/:tenantId/history/undo', authenticate, requireTenant, asyncHandler(async (req, res) => {
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      const candidates = await historyCandidates(tx, req.tenantId, req.user.id);
      const candidate = candidates.find(item => item.transition?.action !== 'UNDONE');
      if (!candidate) throw new AppError(409, 'No action available to undo');
      const { log: original, transition } = candidate;
      const details = original.details;
      let event;
      let payload;
      let resultingVersion = null;

      if (original.action === 'CREATED') {
        const expectedVersion = transition?.details?.resultingVersion ?? details.after.version;
        const removed = await tx.task.deleteMany({ where: { id: original.entityId, tenantId: req.tenantId, version: expectedVersion } });
        if (!removed.count) throw new AppError(409, 'Task has changed since this action; undo is no longer safe');
        await compactTaskColumn(tx, req.tenantId, details.after.columnId);
        event = 'task:deleted'; payload = { id: original.entityId, tenantId: req.tenantId };
      } else if (original.action === 'DELETED') {
        if (await tx.task.findUnique({ where: { id: original.entityId } })) throw new AppError(409, 'Task already exists; undo is no longer valid');
        const old = details.before;
        const { createdAt, updatedAt, ...data } = old;
        const restored = await tx.task.create({ data: { ...data, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt), version: Number(old.version || 1) + 1 } });
        await placeTaskAt(tx, req.tenantId, restored.id, restored.columnId, restored.position);
        const positioned = await tx.task.findUnique({ where: { id: restored.id } });
        resultingVersion = positioned.version;
        event = 'task:created'; payload = positioned;
      } else {
        const old = details.before;
        const expectedVersion = transition?.details?.resultingVersion ?? details.after.version;
        const current = await tx.task.findFirst({ where: { id: original.entityId, tenantId: req.tenantId } });
        if (!current || current.version !== expectedVersion) throw new AppError(409, 'Task has changed since this action; undo is no longer safe');
        const restored = await tx.task.update({ where: { id: original.entityId }, data: { ...taskSnapshotData(old), version: { increment: 1 } } });
        if (current.columnId !== restored.columnId) await compactTaskColumn(tx, req.tenantId, current.columnId);
        await placeTaskAt(tx, req.tenantId, restored.id, restored.columnId, old.position);
        const positioned = await tx.task.findUnique({ where: { id: restored.id } });
        resultingVersion = positioned.version;
        event = 'task:updated'; payload = positioned;
      }

      await tx.activityLog.create({ data: { tenantId: req.tenantId, userId: req.user.id, entityType: 'TASK', entityId: original.entityId, action: 'UNDONE', details: { targetLogId: original.id, resultingVersion } } });
      return { event, payload };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw new AppError(409, 'History changed concurrently. Refresh and retry.');
    throw error;
  }
  emit(req.tenantId, result.event, result.payload);
  res.json({ message: 'Last eligible task action undone.' });
}));

router.post('/tenants/:tenantId/history/redo', authenticate, requireTenant, asyncHandler(async (req, res) => {
  let result;
  try {
    result = await prisma.$transaction(async tx => {
      const candidates = await historyCandidates(tx, req.tenantId, req.user.id);
      const candidate = candidates.find(item => item.transition?.action === 'UNDONE');
      if (!candidate) throw new AppError(409, 'No action available to redo');
      const { log: original, transition } = candidate;
      const details = original.details;
      let event;
      let payload;
      let resultingVersion = null;

      if (original.action === 'CREATED') {
        if (await tx.task.findUnique({ where: { id: original.entityId } })) throw new AppError(409, 'Task already exists; redo is no longer valid');
        const after = details.after;
        const { createdAt, updatedAt, ...data } = after;
        const restored = await tx.task.create({ data: { ...data, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt), version: Number(after.version || 1) + 1 } });
        await placeTaskAt(tx, req.tenantId, restored.id, restored.columnId, restored.position);
        const positioned = await tx.task.findUnique({ where: { id: restored.id } });
        resultingVersion = positioned.version;
        event = 'task:created'; payload = positioned;
      } else if (original.action === 'DELETED') {
        const expectedVersion = transition.details?.resultingVersion;
        if (!Number.isInteger(expectedVersion)) throw new AppError(409, 'Delete history is no longer valid');
        const removed = await tx.task.deleteMany({ where: { id: original.entityId, tenantId: req.tenantId, version: expectedVersion } });
        if (!removed.count) throw new AppError(409, 'Restored task has changed; redo is no longer safe');
        await compactTaskColumn(tx, req.tenantId, details.before.columnId);
        event = 'task:deleted'; payload = { id: original.entityId, tenantId: req.tenantId };
      } else {
        const after = details.after;
        const expectedVersion = transition.details?.resultingVersion;
        const current = await tx.task.findFirst({ where: { id: original.entityId, tenantId: req.tenantId } });
        if (!current || !Number.isInteger(expectedVersion) || current.version !== expectedVersion) throw new AppError(409, 'Task has changed since undo; redo is no longer safe');
        const restored = await tx.task.update({ where: { id: original.entityId }, data: { ...taskSnapshotData(after), version: { increment: 1 } } });
        if (current.columnId !== restored.columnId) await compactTaskColumn(tx, req.tenantId, current.columnId);
        await placeTaskAt(tx, req.tenantId, restored.id, restored.columnId, after.position);
        const positioned = await tx.task.findUnique({ where: { id: restored.id } });
        resultingVersion = positioned.version;
        event = 'task:updated'; payload = positioned;
      }

      await tx.activityLog.create({ data: { tenantId: req.tenantId, userId: req.user.id, entityType: 'TASK', entityId: original.entityId, action: 'REDONE', details: { targetLogId: original.id, resultingVersion } } });
      return { event, payload };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') throw new AppError(409, 'History changed concurrently. Refresh and retry.');
    throw error;
  }
  emit(req.tenantId, result.event, result.payload);
  res.json({ message: 'Last undone task action redone.' });
}));

export default router;

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const ids = {
  abc: '11111111-1111-4111-8111-111111111111',
  hyd: '22222222-2222-4222-8222-222222222222',
  blr: '22222222-2222-4222-8222-222222222223',
  xyz: '11111111-1111-4111-8111-111111111112',
  mum: '22222222-2222-4222-8222-222222222224'
};

async function upsertUser(name, email, passwordHash) {
  return prisma.user.upsert({ where: { email }, update: { name, passwordHash }, create: { name, email, passwordHash } });
}
async function addMembership(userId, organizationId, tenantId, role) {
  const existing = await prisma.membership.findFirst({ where: { userId, organizationId, tenantId } });
  if (existing) return prisma.membership.update({ where: { id: existing.id }, data: { role } });
  return prisma.membership.create({ data: { userId, organizationId, tenantId, role } });
}
async function createBoard(tenant, creator, boardName, taskRows) {
  let board = await prisma.board.findFirst({ where: { tenantId: tenant.id, name: boardName } });
  if (!board) board = await prisma.board.create({ data: { organizationId: tenant.organizationId, tenantId: tenant.id, name: boardName, description: 'Seeded demonstration board', createdBy: creator.id } });
  let columns = await prisma.column.findMany({ where: { boardId: board.id }, orderBy: { position: 'asc' } });
  if (!columns.length) {
    for (const [position, name] of ['To Do', 'In Progress', 'Testing', 'Done'].entries()) {
      columns.push(await prisma.column.create({ data: { boardId: board.id, tenantId: tenant.id, name, position } }));
    }
  }
  for (const [title, description, columnIndex, priority, assignee] of taskRows) {
    const exists = await prisma.task.findFirst({ where: { boardId: board.id, title } });
    if (!exists) {
      const position = await prisma.task.count({ where: { boardId: board.id, columnId: columns[columnIndex].id } });
      await prisma.task.create({ data: { boardId: board.id, tenantId: tenant.id, columnId: columns[columnIndex].id, title, description, priority, assignedTo: assignee?.id || null, position } });
    }
  }
}

async function main() {
  const passwordHash = await bcrypt.hash('DemoPass123!', 12);
  const abc = await prisma.organization.upsert({ where: { id: ids.abc }, update: { name: 'ABC Technologies' }, create: { id: ids.abc, name: 'ABC Technologies' } });
  const xyz = await prisma.organization.upsert({ where: { id: ids.xyz }, update: { name: 'XYZ Solutions' }, create: { id: ids.xyz, name: 'XYZ Solutions' } });
  const hyd = await prisma.tenant.upsert({ where: { id: ids.hyd }, update: { name: 'Hyderabad', organizationId: abc.id }, create: { id: ids.hyd, organizationId: abc.id, name: 'Hyderabad' } });
  const blr = await prisma.tenant.upsert({ where: { id: ids.blr }, update: { name: 'Bangalore', organizationId: abc.id }, create: { id: ids.blr, organizationId: abc.id, name: 'Bangalore' } });
  const mum = await prisma.tenant.upsert({ where: { id: ids.mum }, update: { name: 'Mumbai', organizationId: xyz.id }, create: { id: ids.mum, organizationId: xyz.id, name: 'Mumbai' } });

  const orgAdmin = await upsertUser('Demo Organization Admin', 'admin@example.com', passwordHash);
  const hydAdmin = await upsertUser('Hyderabad Tenant Admin', 'hyd.admin@example.com', passwordHash);
  const hydMember = await upsertUser('Hyderabad Member', 'hyd.member@example.com', passwordHash);
  const blrAdmin = await upsertUser('Bangalore Tenant Admin', 'blr.admin@example.com', passwordHash);
  const xyzMember = await upsertUser('Mumbai Member', 'mumbai.member@example.com', passwordHash);

  await addMembership(orgAdmin.id, abc.id, null, 'ORG_ADMIN');
  await addMembership(orgAdmin.id, abc.id, hyd.id, 'ORG_ADMIN');
  await addMembership(orgAdmin.id, abc.id, blr.id, 'ORG_ADMIN');
  await addMembership(hydAdmin.id, abc.id, hyd.id, 'TENANT_ADMIN');
  await addMembership(hydMember.id, abc.id, hyd.id, 'MEMBER');
  await addMembership(blrAdmin.id, abc.id, blr.id, 'TENANT_ADMIN');
  await addMembership(xyzMember.id, xyz.id, mum.id, 'MEMBER');

  await createBoard(hyd, orgAdmin, 'Website Development', [
    ['Create login page', 'Build the authentication screen', 0, 'HIGH', hydMember],
    ['Develop registration API', 'Validate and persist new users', 1, 'MEDIUM', hydAdmin],
    ['Test authentication', 'Verify login and token handling', 2, 'HIGH', hydMember],
    ['Deploy dashboard', 'Prepare the dashboard release', 3, 'LOW', orgAdmin]
  ]);
  await createBoard(blr, orgAdmin, 'CRM Development', [
    ['Design customer profile', 'Create customer profile layout', 0, 'MEDIUM', blrAdmin],
    ['Implement contact API', 'Add contact CRUD endpoints', 1, 'HIGH', blrAdmin]
  ]);
  await createBoard(mum, xyzMember, 'Customer Support Platform', [
    ['Create support queue', 'Build ticket queue view', 0, 'MEDIUM', xyzMember]
  ]);

  console.log('Seed complete. Demo password for all accounts: DemoPass123!');
  console.log('Org Admin: admin@example.com');
  console.log('Hyderabad Tenant Admin: hyd.admin@example.com');
  console.log('Hyderabad Member: hyd.member@example.com');
  console.log('Bangalore Tenant Admin: blr.admin@example.com');
  console.log('Mumbai Member: mumbai.member@example.com');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());

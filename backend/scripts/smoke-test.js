import { io } from 'socket.io-client';

const base = process.env.API_BASE_URL || 'http://localhost:5000/api';
const socketBase = process.env.SOCKET_URL || 'http://localhost:5000';

async function request(path, { token, method = 'GET', body, expected } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (expected && response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, received ${response.status}: ${text}`);
  return { response, data };
}

async function login(email) {
  const { data } = await request('/auth/login', { method: 'POST', body: { email, password: 'DemoPass123!' }, expected: 200 });
  return data.token;
}

function openSocket(token, tenantId) {
  return new Promise((resolve, reject) => {
    const socket = io(socketBase, { auth: { token, tenantId }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', error => { socket.close(); reject(error); });
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const [adminToken, hydMemberToken, blrAdminToken, xyzMemberToken] = await Promise.all([
    login('admin@example.com'), login('hyd.member@example.com'), login('blr.admin@example.com'), login('mumbai.member@example.com')
  ]);
  const { data: organizations } = await request('/organizations', { token: adminToken, expected: 200 });
  const abc = organizations.find(item => item.name === 'ABC Technologies');
  const { data: xyzOrganizations } = await request('/organizations', { token: xyzMemberToken, expected: 200 });
  const xyz = xyzOrganizations.find(item => item.name === 'XYZ Solutions');
  if (!abc || !xyz || xyzOrganizations.some(item => item.id === abc.id)) throw new Error('Organization isolation failed or seed data is missing.');

  const { data: abcTenants } = await request(`/organizations/${abc.id}/tenants`, { token: adminToken, expected: 200 });
  const hyd = abcTenants.find(item => item.name === 'Hyderabad');
  const blr = abcTenants.find(item => item.name === 'Bangalore');
  const { data: xyzTenants } = await request(`/organizations/${xyz.id}/tenants`, { token: xyzMemberToken, expected: 200 });
  const mum = xyzTenants.find(item => item.name === 'Mumbai');
  if (!hyd || !blr || !mum) throw new Error('Seed tenants are missing.');

  const { data: hydBoards } = await request(`/tenants/${hyd.id}/boards`, { token: hydMemberToken, expected: 200 });
  const { data: blrBoards } = await request(`/tenants/${blr.id}/boards`, { token: blrAdminToken, expected: 200 });
  const { data: mumBoards } = await request(`/tenants/${mum.id}/boards`, { token: xyzMemberToken, expected: 200 });
  const hydTask = hydBoards.flatMap(board => board.columns.flatMap(column => column.tasks))[0];
  const blrTask = blrBoards.flatMap(board => board.columns.flatMap(column => column.tasks))[0];
  const mumTask = mumBoards.flatMap(board => board.columns.flatMap(column => column.tasks))[0];
  if (!hydTask || !blrTask || !mumTask) throw new Error('Seed tasks are missing.');

  await request(`/tasks/${blrTask.id}`, { token: hydMemberToken, expected: 404 });
  await request(`/tasks/${mumTask.id}`, { token: hydMemberToken, expected: 404 });
  await request(`/tenants/${blr.id}/boards`, { token: hydMemberToken, expected: 403 });
  await request(`/tenants/${hyd.id}/boards`, { token: hydMemberToken, method: 'POST', body: { name: 'Member must not create a board' }, expected: 403 });

  const updated = await request(`/tasks/${hydTask.id}`, {
    token: hydMemberToken, method: 'PUT', expected: 200,
    body: { title: `${hydTask.title} (smoke test)`, expectedVersion: hydTask.version }
  });
  await request(`/tasks/${hydTask.id}`, {
    token: hydMemberToken, method: 'PUT', expected: 409,
    body: { title: 'Stale write must fail', expectedVersion: hydTask.version }
  });

  const hydSocket = await openSocket(hydMemberToken, hyd.id);
  const blrSocket = await openSocket(blrAdminToken, blr.id);
  let foreignEventReceived = false;
  blrSocket.on('task:created', () => { foreignEventReceived = true; });
  const hydEvent = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for tenant task event.')), 5000);
    hydSocket.once('task:created', payload => { clearTimeout(timeout); resolve(payload); });
  });
  await request(`/tenants/${hyd.id}/tasks`, {
    token: hydMemberToken, method: 'POST', expected: 201,
    body: { boardId: hydBoards[0].id, columnId: hydBoards[0].columns[0].id, title: `Socket isolation test ${Date.now()}`, priority: 'LOW' }
  });
  await hydEvent;
  await delay(400);
  hydSocket.close();
  blrSocket.close();
  if (foreignEventReceived) throw new Error('A task event leaked into another tenant room.');

  console.log('Smoke tests passed: authentication, organization isolation, tenant isolation, RBAC, stale-version conflict, and tenant-scoped Socket.IO delivery.');
  console.log(`Updated task version: ${updated.data.version}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });

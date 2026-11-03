import React, { useEffect, useState } from 'react';
import { DndContext, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { api, getError } from './services/api';
import { createTenantSocket } from './services/socket';

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', organizationName: '', tenantName: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const change = e => setForm({ ...form, [e.target.name]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post(`/auth/${mode}`, form);
      localStorage.setItem('token', data.token); onLogin(data.user);
    } catch (err) { setError(getError(err)); } finally { setBusy(false); }
  }
  return <main className="auth-wrap"><form className="auth-card" onSubmit={submit}>
    <div className="brand-mark">J</div><p className="eyebrow">JULLEYONLINE · COLLABORATION</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="muted">Real-time work, shared securely across your teams.</p>
    {mode === 'register' && <><label>Full name<input name="name" value={form.name} onChange={change} required minLength="2" /></label><label>Organization name<input name="organizationName" value={form.organizationName} onChange={change} required /></label><label>First branch / tenant<input name="tenantName" value={form.tenantName} onChange={change} required /></label></>}
    <label>Email<input name="email" type="email" value={form.email} onChange={change} required /></label><label>Password<input name="password" type="password" value={form.password} onChange={change} required minLength="8" /></label>
    {error && <div className="error">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
    <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? 'Create a new organization' : 'Already have an account? Sign in'}</button>
  </form></main>;
}

function TaskCard({ task, onOpen }) {
  const draggable = useDraggable({ id: task.id });
  const droppable = useDroppable({ id: `task:${task.id}` });
  const setNodeRef = node => {
    draggable.setNodeRef(node);
    droppable.setNodeRef(node);
  };
  const style = {
    transform: draggable.transform ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)` : undefined,
    opacity: draggable.isDragging ? 0.55 : 1,
    touchAction: 'none'
  };
  return <article ref={setNodeRef} style={style} {...draggable.listeners} {...draggable.attributes} className="task-card" onClick={() => onOpen(task)}>
    <div className="task-top"><span className={`priority ${task.priority?.toLowerCase()}`}>{task.priority || 'MEDIUM'}</span><span className="version">v{task.version}</span></div>
    <h3>{task.title}</h3>{task.description && <p>{task.description}</p>}
    <div className="task-foot"><span>{task.assignee?.name || 'Unassigned'}</span>{task.dueDate && <span>{new Date(task.dueDate).toLocaleDateString()}</span>}</div>
  </article>;
}

function DroppableColumn({ column, onAddTask, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.id}` });
  return <section ref={setNodeRef} className={`board-column ${isOver ? 'drag-over' : ''}`}>
    <div className="column-heading"><div><span className="column-indicator"/><h2>{column.name}</h2><span className="task-count">{column.tasks.length}</span></div><button className="icon-button" onClick={onAddTask}>＋</button></div>
    <div className="task-list">{children}{column.tasks.length === 0 && <div className="drop-placeholder">Drop tasks here</div>}</div>
    <button className="add-task-inline" onClick={onAddTask}>＋ Add a task</button>
  </section>;
}

function TaskModal({ task, members, onClose, onSave, onDelete, saving }) {
  const [form, setForm] = useState({ title: task?.title || '', description: task?.description || '', priority: task?.priority || 'MEDIUM', assignedTo: task?.assignedTo || '', dueDate: task?.dueDate ? task.dueDate.slice(0,10) : '' });
  useEffect(() => {
    if (task) setForm({ title: task.title || '', description: task.description || '', priority: task.priority || 'MEDIUM', assignedTo: task.assignedTo || '', dueDate: task.dueDate ? task.dueDate.slice(0,10) : '' });
  }, [task?.id, task?.version]);
  if (!task) return null;
  const change = e => setForm({ ...form, [e.target.name]: e.target.value });
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><form className="modal" onSubmit={e => { e.preventDefault(); onSave({ ...form, assignedTo: form.assignedTo || null, dueDate: form.dueDate ? new Date(`${form.dueDate}T00:00:00.000Z`).toISOString() : null, expectedVersion: task.version }); }}>
    <div className="modal-head"><div><p className="eyebrow">TASK DETAILS</p><h2>{task.title}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div>
    <label>Title<input name="title" value={form.title} onChange={change} required /></label><label>Description<textarea name="description" value={form.description} onChange={change} rows="4" /></label>
    <div className="two-col"><label>Priority<select name="priority" value={form.priority} onChange={change}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label><label>Assignee<select name="assignedTo" value={form.assignedTo} onChange={change}><option value="">Unassigned</option>{members.map(m => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}</select></label></div>
    <label>Due date<input type="date" name="dueDate" value={form.dueDate} onChange={change} /></label>
    <div className="modal-actions"><button type="button" className="danger ghost" onClick={() => onDelete(task)}>Delete task</button><span className="spacer"/><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    <p className="tiny muted">Version {task.version}. If another user saves first, this update will be rejected to prevent overwriting their changes.</p>
  </form></div>;
}

export default function App() {
  const [user, setUser] = useState(null); const [booting, setBooting] = useState(true);
  const [organizations, setOrganizations] = useState([]); const [organizationId, setOrganizationId] = useState('');
  const [tenants, setTenants] = useState([]); const [tenantId, setTenantId] = useState(localStorage.getItem('tenantId') || '');
  const [boards, setBoards] = useState([]); const [boardId, setBoardId] = useState(''); const [members, setMembers] = useState([]); const [activity, setActivity] = useState([]);
  const [online, setOnline] = useState([]); const [socketStatus, setSocketStatus] = useState('offline');
  const [selectedTask, setSelectedTask] = useState(null); const [newTask, setNewTask] = useState(false); const [newBoardName, setNewBoardName] = useState('');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeBoard = boards.find(b => b.id === boardId);
  const currentRole = members.find(member => member.user.id === user?.id)?.role || 'MEMBER';
  const canManageBoards = currentRole === 'ORG_ADMIN' || currentRole === 'TENANT_ADMIN';

  async function loadOrganizations() {
    const { data } = await api.get('/organizations'); setOrganizations(data);
    if (!organizationId && data.length) setOrganizationId(data[0].id);
  }
  async function loadTenants(orgId) {
    if (!orgId) return; const { data } = await api.get(`/organizations/${orgId}/tenants`); setTenants(data);
    const preferred = data.find(t => t.id === localStorage.getItem('tenantId')) || data[0];
    setTenantId(preferred?.id || '');
  }
  async function loadTenantData(id) {
    if (!id) return; localStorage.setItem('tenantId', id);
    const [b, m, a] = await Promise.all([api.get(`/tenants/${id}/boards`), api.get(`/tenants/${id}/members`), api.get(`/tenants/${id}/activity`)]);
    setBoards(b.data); setMembers(m.data); setActivity(a.data); setBoardId(current => b.data.some(x => x.id === current) ? current : (b.data[0]?.id || ''));
  }
  useEffect(() => { (async () => { try { const token = localStorage.getItem('token'); if (token) { const { data } = await api.get('/auth/me'); setUser(data.user); const orgs = await api.get('/organizations'); setOrganizations(orgs.data); const savedOrg = orgs.data[0]?.id; if (savedOrg) setOrganizationId(savedOrg); } } catch { localStorage.removeItem('token'); } finally { setBooting(false); } })(); }, []);
  useEffect(() => { if (user && organizationId) loadTenants(organizationId).catch(e => setError(getError(e))); }, [user, organizationId]);
  useEffect(() => { if (user && tenantId) loadTenantData(tenantId).catch(e => setError(getError(e))); }, [user, tenantId]);
  useEffect(() => {
    if (!user || !tenantId) return;
    const socket = createTenantSocket(localStorage.getItem('token'), tenantId);
    socket.on('connect', () => { setSocketStatus('live'); loadTenantData(tenantId).catch(() => {}); });
    socket.on('disconnect', () => setSocketStatus('reconnecting'));
    socket.on('connect_error', () => setSocketStatus('reconnecting'));
    socket.on('presence:update', data => setOnline(data.onlineUserIds || []));
    const refresh = () => loadTenantData(tenantId).catch(() => {});
    ['task:created','task:updated','task:moved','task:deleted','board:created','board:updated','board:deleted','column:created','column:updated','column:deleted'].forEach(event => socket.on(event, refresh));
    return () => socket.disconnect();
  }, [user, tenantId]);
  function logout() {
    localStorage.removeItem('token'); localStorage.removeItem('tenantId');
    setUser(null); setOrganizations([]); setOrganizationId(''); setTenants([]); setTenantId('');
    setBoards([]); setBoardId(''); setMembers([]); setActivity([]); setOnline([]); setSelectedTask(null); setNewTask(false);
  }
  async function createBoard(e) { e.preventDefault(); if (!newBoardName.trim()) return; try { await api.post(`/tenants/${tenantId}/boards`, { name: newBoardName.trim() }); setNewBoardName(''); await loadTenantData(tenantId); } catch (e) { setError(getError(e)); } }
  async function createTask(e) { e.preventDefault(); const form = new FormData(e.currentTarget); const columnId = form.get('columnId'); try { await api.post(`/tenants/${tenantId}/tasks`, { boardId, columnId, title: form.get('title'), description: form.get('description'), priority: form.get('priority') }); setNewTask(false); await loadTenantData(tenantId); } catch (e) { setError(getError(e)); } }
  async function saveTask(data) {
    setSaving(true);
    try {
      const { expectedVersion, ...body } = data;
      await api.put(`/tasks/${selectedTask.id}`, { ...body, expectedVersion });
      setSelectedTask(null);
      await loadTenantData(tenantId);
      setError('');
    } catch (e) {
      setError(getError(e));
      if (e.response?.status === 409 && selectedTask) {
        await loadTenantData(tenantId);
        try {
          const { data: latestTask } = await api.get(`/tasks/${selectedTask.id}`);
          setSelectedTask(latestTask);
          setError('This task changed elsewhere. The latest version has been loaded; review it before saving again.');
        } catch {
          setSelectedTask(null);
          setError('This task is no longer available. The board has been refreshed.');
        }
      }
    } finally { setSaving(false); }
  }
  async function deleteTask(task) { if (!confirm('Delete this task?')) return; try { await api.delete(`/tasks/${task.id}?version=${task.version}`); setSelectedTask(null); await loadTenantData(tenantId); } catch (e) { setError(getError(e)); } }
  async function moveTask(task, destinationColumnId, requestedPosition) {
    const snapshot = boards;
    const sourceBoard = boards.find(board => board.id === task.boardId);
    if (!sourceBoard) return;
    const sourceColumn = sourceBoard.columns.find(column => column.id === task.columnId);
    const destinationColumn = sourceBoard.columns.find(column => column.id === destinationColumnId);
    if (!sourceColumn || !destinationColumn) return;

    const sourceTasks = sourceColumn.tasks.filter(item => item.id !== task.id);
    const destinationTasks = sourceColumn.id === destinationColumn.id
      ? sourceTasks
      : [...destinationColumn.tasks];
    const position = Math.max(0, Math.min(requestedPosition, destinationTasks.length));
    destinationTasks.splice(position, 0, { ...task, columnId: destinationColumnId, version: task.version + 1 });
    const optimisticBoard = {
      ...sourceBoard,
      columns: sourceBoard.columns.map(column => {
        if (column.id === sourceColumn.id && column.id === destinationColumn.id) {
          return { ...column, tasks: destinationTasks.map((item, index) => ({ ...item, position: index })) };
        }
        if (column.id === sourceColumn.id) return { ...column, tasks: sourceTasks.map((item, index) => ({ ...item, position: index })) };
        if (column.id === destinationColumn.id) return { ...column, tasks: destinationTasks.map((item, index) => ({ ...item, position: index })) };
        return column;
      })
    };
    setBoards(current => current.map(board => board.id === sourceBoard.id ? optimisticBoard : board));
    try {
      await api.patch(`/tasks/${task.id}/move`, { destinationColumnId, position, expectedVersion: task.version });
      await loadTenantData(tenantId);
    } catch (err) {
      setBoards(snapshot);
      setError(getError(err));
      await loadTenantData(tenantId);
    }
  }

  function handleDragEnd(event) {
    const taskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : '';
    if (!overId || !activeBoard) return;
    const task = activeBoard.columns.flatMap(column => column.tasks).find(item => item.id === taskId);
    if (!task) return;

    if (overId.startsWith('column:')) {
      const destinationId = overId.slice('column:'.length);
      const destination = activeBoard.columns.find(column => column.id === destinationId);
      if (destination) moveTask(task, destination.id, destination.tasks.length);
      return;
    }
    if (overId.startsWith('task:')) {
      const targetId = overId.slice('task:'.length);
      if (targetId === task.id) return;
      const destination = activeBoard.columns.find(column => column.tasks.some(item => item.id === targetId));
      if (!destination) return;
      let position = destination.tasks.findIndex(item => item.id === targetId);
      const sourceIndex = task.columnId === destination.id ? destination.tasks.findIndex(item => item.id === task.id) : -1;
      if (sourceIndex >= 0 && sourceIndex < position) position -= 1;
      moveTask(task, destination.id, Math.max(0, position));
    }
  }
  async function history(action) { try { await api.post(`/tenants/${tenantId}/history/${action}`); await loadTenantData(tenantId); } catch (e) { setError(getError(e)); } }
  if (booting) return <div className="loading">Loading workspace…</div>;
  if (!user) return <Login onLogin={u => { setUser(u); loadOrganizations().catch(e => setError(getError(e))); }} />;

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark small">J</span><span>Julley<span className="brand-light">Online</span></span></div><div className="selectors"><select value={organizationId} onChange={e => { setOrganizationId(e.target.value); setTenantId(''); setTenants([]); setBoards([]); setMembers([]); setActivity([]); setOnline([]); }} aria-label="Organization">{organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select><span className="selector-divider">/</span><select value={tenantId} onChange={e => { setTenantId(e.target.value); setBoards([]); setMembers([]); setActivity([]); setOnline([]); }} aria-label="Tenant">{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div><div className="top-actions"><span className={`live-status ${socketStatus}`}><i/> {socketStatus === 'live' ? 'Live sync' : 'Reconnecting'}</span><span className="user-chip">{user.name?.slice(0,1).toUpperCase()} · {user.name}</span><button className="link-button logout" onClick={logout}>Sign out</button></div></header>
    <div className="workspace"><aside className="sidebar"><div className="side-section"><p className="side-label">WORKSPACE</p><div className="side-item active">▦ <span>Boards</span></div><div className="side-item">◷ <span>Activity</span></div></div><div className="side-section"><div className="side-heading"><p className="side-label">YOUR BOARDS</p><span>{boards.length}</span></div>{boards.map(b => <button key={b.id} className={`board-link ${boardId === b.id ? 'selected' : ''}`} onClick={() => setBoardId(b.id)}>▤ {b.name}</button>)}{canManageBoards && <form className="new-board" onSubmit={createBoard}><input value={newBoardName} onChange={e => setNewBoardName(e.target.value)} placeholder="New board name"/><button title="Create board">+</button></form>}</div><div className="side-bottom"><p className="side-label">TEAM PRESENCE</p><p className="online-count"><span className="green-dot"/>{online.length} online</p>{members.map(m => <div className="member-line" key={m.user.id}><span className="avatar">{m.user.name[0]}</span><span>{m.user.name}</span><span className={online.includes(m.user.id) ? 'presence-dot online' : 'presence-dot'}/></div>)}</div></aside>
      <main className="main-content"><div className="page-heading"><div><p className="eyebrow">{tenants.find(t => t.id === tenantId)?.name || 'TENANT'} WORKSPACE</p><h1>{activeBoard?.name || 'Your boards'}</h1><p className="muted">Plan, track and move work together.</p></div><div className="heading-actions"><button className="secondary" onClick={() => history('undo')}>↶ Undo</button><button className="secondary" onClick={() => history('redo')}>↷ Redo</button><button className="primary" disabled={!activeBoard} onClick={() => setNewTask(true)}>＋ Add task</button></div></div>
      {error && <div className="notice"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
      {!activeBoard ? <div className="empty-state"><div className="empty-icon">▤</div><h2>No board selected</h2><p>Create a board from the left sidebar to get started.</p></div> : <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}><div className="board-grid">{activeBoard.columns.map(column => <DroppableColumn key={column.id} column={column} onAddTask={() => setNewTask(true)}>{column.tasks.map(task => <TaskCard key={task.id} task={task} onOpen={setSelectedTask}/>)}</DroppableColumn>)}</div></DndContext>}
      <section className="activity-panel"><div className="activity-head"><div><p className="eyebrow">TENANT HISTORY</p><h2>Recent activity</h2></div><span className="muted tiny">Latest 100 events</span></div>{activity.slice(0,6).map(log => <div className="activity-row" key={log.id}><span className="activity-avatar">{log.user.name[0]}</span><div><strong>{log.user.name}</strong> <span>{log.action.toLowerCase()} {log.entityType.toLowerCase()}</span><small>{new Date(log.createdAt).toLocaleString()}</small></div></div>)}{!activity.length && <p className="muted">No activity yet.</p>}</section>
      </main></div>
    {newTask && <div className="modal-backdrop"><form className="modal" onSubmit={createTask}><div className="modal-head"><div><p className="eyebrow">NEW WORK ITEM</p><h2>Create task</h2></div><button type="button" className="icon-button" onClick={() => setNewTask(false)}>×</button></div><label>Task title<input name="title" required autoFocus placeholder="What needs to be done?"/></label><label>Description<textarea name="description" rows="3" placeholder="Add more context…"/></label><div className="two-col"><label>Status<select name="columnId">{activeBoard?.columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Priority<select name="priority"><option>MEDIUM</option><option>HIGH</option><option>LOW</option></select></label></div><div className="modal-actions"><span className="spacer"/><button type="button" className="secondary" onClick={() => setNewTask(false)}>Cancel</button><button className="primary">Create task</button></div></form></div>}
    <TaskModal task={selectedTask} members={members} onClose={() => setSelectedTask(null)} onSave={saveTask} onDelete={deleteTask} saving={saving}/>
  </div>;
}

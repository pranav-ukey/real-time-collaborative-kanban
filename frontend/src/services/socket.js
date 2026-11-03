import { io } from 'socket.io-client';
export function createTenantSocket(token, tenantId) {
  return io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token, tenantId }, transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 700 });
}

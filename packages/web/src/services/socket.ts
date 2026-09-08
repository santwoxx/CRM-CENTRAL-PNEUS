import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@crm/shared';

export type CrmSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: CrmSocket | null = null;
let heartbeatTimer: any = null;

export function getSocket(token?: string | null): CrmSocket {
  if (socket && socket.connected) {
    return socket;
  }

  const authToken = token || localStorage.getItem('crm_access_token');

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  // Mesma logica do api.ts: em producao o backend esta em outro dominio,
  // entao `window.location.origin` (o Vercel) apontaria para o lugar errado.
  const origin = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') || window.location.origin;

  socket = io(origin, {
    path: '/socket.io',
    auth: { token: authToken },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    // Inicia heartbeat a cada 45 segundos para manter status ativo
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (socket?.connected) {
        socket.emit('presence:heartbeat');
      }
    }, 45_000);
  });

  socket.on('disconnect', () => {
    clearInterval(heartbeatTimer);
  });

  return socket;
}

export function disconnectSocket() {
  clearInterval(heartbeatTimer);
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

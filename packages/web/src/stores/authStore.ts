import { create } from 'zustand';
import type { AuthenticatedUser } from '@crm/shared';
import { api } from '../services/api.js';
import { disconnectSocket, getSocket } from '../services/socket.js';

interface AuthState {
  user: AuthenticatedUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  setUser: (user: AuthenticatedUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('crm_access_token'),
  isLoading: true,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.post('/auth/login', { email, password });
      api.setToken(data.accessToken);
      set({ user: data.user, token: data.accessToken, isLoading: false });
      getSocket(data.accessToken);
    } catch (err: any) {
      set({ error: err.message || 'Falha ao autenticar', isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    api.setToken(null);
    disconnectSocket();
    set({ user: null, token: null, isLoading: false });
  },

  checkAuth: async () => {
    const token = localStorage.getItem('crm_access_token');
    if (!token) {
      set({ user: null, token: null, isLoading: false });
      return;
    }

    try {
      api.setToken(token);
      const user = await api.get('/auth/me');
      set({ user, token, isLoading: false });
      getSocket(token);
    } catch {
      api.setToken(null);
      set({ user: null, token: null, isLoading: false });
    }
  },

  setUser: (user) => set({ user }),
}));

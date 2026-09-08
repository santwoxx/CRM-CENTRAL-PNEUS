import { create } from 'zustand';
import type { AuthenticatedUser } from '@crm/shared';
import { api } from '../services/api.js';
import { disconnectSocket, getSocket } from '../services/socket.js';
import { describeFirebaseError, signInWithGoogle, signOutFromGoogle } from '../services/firebase.js';

interface AuthState {
  user: AuthenticatedUser | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
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

  /**
   * Entra com a conta Google.
   *
   * Sao duas etapas: o Google prova quem a pessoa e (popup do Firebase) e o
   * NOSSO backend decide se ela tem acesso. Se o e-mail nao estiver
   * cadastrado, o backend recusa - e por isso desfazemos a sessao do
   * Firebase logo em seguida, para o proximo clique nao entrar em silencio
   * com a mesma conta recusada.
   */
  loginWithGoogle: async () => {
    set({ isLoading: true, error: null });
    try {
      const { idToken } = await signInWithGoogle();
      const data = await api.post('/auth/google', { idToken });
      api.setToken(data.accessToken);
      set({ user: data.user, token: data.accessToken, isLoading: false });
      getSocket(data.accessToken);
    } catch (err: any) {
      await signOutFromGoogle();
      const message =
        err?.code?.startsWith?.('auth/') ? describeFirebaseError(err) : err?.message;
      set({ error: message || 'Falha ao entrar com o Google', isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    await signOutFromGoogle();
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

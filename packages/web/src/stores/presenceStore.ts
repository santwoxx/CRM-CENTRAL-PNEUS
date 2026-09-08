import { create } from 'zustand';
import type { AgentPresenceDTO } from '@crm/shared';

interface QueueStats {
  departmentId: string | null;
  waiting: number;
  oldestWaitingSeconds: number;
}

interface SystemAlert {
  id: string;
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  at: string;
}

interface PresenceState {
  agents: AgentPresenceDTO[];
  queueStats: Record<string, QueueStats>; // departmentId | 'global' -> QueueStats
  alerts: SystemAlert[];

  setAgents: (agents: AgentPresenceDTO[]) => void;
  updateAgentPresence: (presence: AgentPresenceDTO) => void;
  updateQueueStats: (stats: QueueStats) => void;
  addAlert: (alert: Omit<SystemAlert, 'id'>) => void;
  dismissAlert: (id: string) => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  agents: [],
  queueStats: {},
  alerts: [],

  setAgents: (agents) => set({ agents }),

  updateAgentPresence: (presence) => {
    set((state) => {
      const idx = state.agents.findIndex((a) => a.userId === presence.userId);
      if (idx >= 0) {
        const copy = [...state.agents];
        copy[idx] = presence;
        return { agents: copy };
      }
      return { agents: [...state.agents, presence] };
    });
  },

  updateQueueStats: (stats) => {
    const key = stats.departmentId || 'global';
    set((state) => ({
      queueStats: { ...state.queueStats, [key]: stats },
    }));
  },

  addAlert: (alert) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      alerts: [{ ...alert, id }, ...state.alerts].slice(0, 10),
    }));
  },

  dismissAlert: (id) => {
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    }));
  },
}));

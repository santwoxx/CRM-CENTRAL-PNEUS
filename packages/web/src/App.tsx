import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore.js';
import { useSocketEvents } from './hooks/useSocketEvents.js';
import { NavigationSidebar } from './components/NavigationSidebar.js';

// Páginas
import { LoginPage } from './pages/Login.js';
import { InboxPage } from './pages/Inbox.js';
import { AdminLiveMonitorPage } from './pages/AdminLiveMonitor.js';
import { DepartmentsPage } from './pages/DepartmentsPage.js';
import { TeamPage } from './pages/TeamPage.js';
import { ChannelsPage } from './pages/ChannelsPage.js';
import { AiConfigPage } from './pages/AiConfigPage.js';
import { SimulatorPage } from './pages/SimulatorPage.js';

export const App: React.FC = () => {
  const { user, token, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, []);

  // Hook global do Socket.IO (ativo enquanto houver token)
  useSocketEvents();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs font-semibold tracking-wider">CARREGANDO CENTRAL PNEUS...</p>
      </div>
    );
  }

  // Rota pública de Login
  if (!token || !user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Layout Autenticado com Sidebar e Telas
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950">
      <NavigationSidebar />
      <main className="flex-1 flex overflow-hidden">
        <Routes>
          <Route path="/" element={<InboxPage />} />
          <Route path="/supervisao" element={<AdminLiveMonitorPage />} />
          <Route path="/setores" element={<DepartmentsPage />} />
          <Route path="/equipe" element={<TeamPage />} />
          <Route path="/canais" element={<ChannelsPage />} />
          <Route path="/ia" element={<AiConfigPage />} />
          <Route path="/simulador" element={<SimulatorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

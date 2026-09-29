import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore.js';
import { useSocketEvents } from './hooks/useSocketEvents.js';
import { NavigationSidebar } from './components/NavigationSidebar.js';

// Login e Atendimento sao as telas que todo mundo abre: vao no primeiro
// carregamento.
import { LoginPage } from './pages/Login.js';
import { InboxPage } from './pages/Inbox.js';

// As telas de administracao carregam quando alguem abre cada uma. O atendente
// entra pelo celular, muitas vezes em rede fraca dentro da loja, e nunca usa
// nenhuma delas - nao faz sentido baixa-las para atender.
const AdminLiveMonitorPage = lazy(() =>
  import('./pages/AdminLiveMonitor.js').then((m) => ({ default: m.AdminLiveMonitorPage })),
);
const DepartmentsPage = lazy(() =>
  import('./pages/DepartmentsPage.js').then((m) => ({ default: m.DepartmentsPage })),
);
const TeamPage = lazy(() => import('./pages/TeamPage.js').then((m) => ({ default: m.TeamPage })));
const ChannelsPage = lazy(() =>
  import('./pages/ChannelsPage.js').then((m) => ({ default: m.ChannelsPage })),
);
const AiConfigPage = lazy(() =>
  import('./pages/AiConfigPage.js').then((m) => ({ default: m.AiConfigPage })),
);
const SimulatorPage = lazy(() =>
  import('./pages/SimulatorPage.js').then((m) => ({ default: m.SimulatorPage })),
);

const CarregandoTela: React.FC = () => (
  <div className="flex-1 flex items-center justify-center text-slate-500">
    <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

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
        <Suspense fallback={<CarregandoTela />}>
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
        </Suspense>
      </main>
    </div>
  );
};

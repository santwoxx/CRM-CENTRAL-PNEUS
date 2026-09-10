import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { MessageSquare, Activity, Layers, Users, Radio, Cpu, LogOut, Circle, AlertCircle, ChevronDown, Smartphone } from 'lucide-react';
import { AgentPresence, UserRole } from '@crm/shared';
import { useAuthStore } from '../stores/authStore.js';
import { usePresenceStore } from '../stores/presenceStore.js';
import { api } from '../services/api.js';

export const NavigationSidebar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { queueStats, alerts, dismissAlert } = usePresenceStore();
  const [presenceMenuOpen, setPresenceMenuOpen] = useState(false);

  const totalWaiting = Object.values(queueStats).reduce((acc, q) => acc + q.waiting, 0);

  const handlePresenceChange = async (presence: AgentPresence) => {
    setPresenceMenuOpen(false);
    if (!user) return;
    try {
      await api.put(`/users/${user.id}/presence`, { presence });
      useAuthStore.getState().setUser({ ...user, presence });
    } catch (err) {
      console.error('Falha ao atualizar presenca:', err);
    }
  };

  const presenceColor = {
    [AgentPresence.ONLINE]: 'text-emerald-400 fill-emerald-400',
    [AgentPresence.AWAY]: 'text-amber-400 fill-amber-400',
    [AgentPresence.BUSY]: 'text-rose-400 fill-rose-400',
    [AgentPresence.OFFLINE]: 'text-slate-500 fill-slate-500',
  }[user?.presence || AgentPresence.OFFLINE];

  const presenceLabel = {
    [AgentPresence.ONLINE]: 'Disponível',
    [AgentPresence.AWAY]: 'Ausente',
    [AgentPresence.BUSY]: 'Ocupado',
    [AgentPresence.OFFLINE]: 'Offline',
  }[user?.presence || AgentPresence.OFFLINE];

  const isAdminOrSupervisor =
    user?.role === UserRole.OWNER ||
    user?.role === UserRole.ADMIN ||
    user?.role === UserRole.SUPERVISOR;

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0 select-none z-20">
      {/* Topo: Marca e Identidade */}
      <div>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-blue-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
              {/* Ícone estilizado de pneu/roda */}
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="4"/>
                <line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/>
                <line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/>
                <line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/>
                <line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-white tracking-wide text-sm leading-tight">CENTRAL PNEUS</h1>
              <p className="text-[11px] text-brand-400 font-medium tracking-wider">CRM MULTI-ATENDENTE</p>
            </div>
          </div>
        </div>

        {/* Notificações/Alertas no topo */}
        {alerts.length > 0 && (
          <div className="p-2 space-y-1">
            {alerts.slice(0, 2).map((alert) => (
              <div
                key={alert.id}
                onClick={() => dismissAlert(alert.id)}
                className="bg-amber-950/80 border border-amber-600/40 rounded-lg p-2 text-xs text-amber-200 flex items-start space-x-2 cursor-pointer hover:bg-amber-900/60 transition"
              >
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="line-clamp-2 leading-snug">{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Menu de Navegação */}
        <nav className="p-3 space-y-1 text-sm font-medium">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center justify-between px-3 py-2.5 rounded-xl transition ${
                isActive
                  ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`
            }
          >
            <div className="flex items-center space-x-3">
              <MessageSquare className="w-5 h-5" />
              <span>Atendimento</span>
            </div>
            {totalWaiting > 0 && (
              <span className="bg-amber-500 text-slate-950 text-[11px] font-bold px-2 py-0.5 rounded-full">
                {totalWaiting}
              </span>
            )}
          </NavLink>

          {isAdminOrSupervisor && (
            <NavLink
              to="/supervisao"
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2.5 rounded-xl transition ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`
              }
            >
              <div className="flex items-center space-x-3">
                <Activity className="w-5 h-5" />
                <span>Supervisão ao Vivo</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </NavLink>
          )}

          {isAdminOrSupervisor && (
            <>
              <div className="pt-3 pb-1 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Administração
              </div>

              <NavLink
                to="/setores"
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl transition ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Layers className="w-5 h-5" />
                <span>Setores & Menus</span>
              </NavLink>

              <NavLink
                to="/equipe"
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl transition ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Users className="w-5 h-5" />
                <span>Equipe & Cargos</span>
              </NavLink>

              <NavLink
                to="/canais"
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl transition ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Radio className="w-5 h-5" />
                <span>Canais WhatsApp</span>
              </NavLink>

              <NavLink
                to="/simulador"
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl transition ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Smartphone className="w-5 h-5" />
                <span>Simulador</span>
              </NavLink>

              <NavLink
                to="/ia"
                className={({ isActive }) =>
                  `flex items-center space-x-3 px-3 py-2.5 rounded-xl transition ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                  }`
                }
              >
                <Cpu className="w-5 h-5" />
                <span>Inteligência Artificial</span>
              </NavLink>
            </>
          )}
        </nav>
      </div>

      {/* Rodapé: Perfil e Status de Presença */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/80">
        <div className="relative">
          <div
            onClick={() => setPresenceMenuOpen(!presenceMenuOpen)}
            className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-800 cursor-pointer transition"
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200">
                  {user?.name.slice(0, 2).toUpperCase() || 'CP'}
                </div>
                <Circle className={`w-3.5 h-3.5 absolute -bottom-0.5 -right-0.5 ${presenceColor}`} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-200 truncate">{user?.name}</p>
                <p className="text-xs text-slate-400 flex items-center space-x-1">
                  <span>{presenceLabel}</span>
                  <span>•</span>
                  <span className="text-[10px] text-brand-400">{user?.role}</span>
                </p>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
          </div>

          {/* Menu Dropdown de Presença */}
          {presenceMenuOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-850 border border-slate-700 rounded-xl shadow-2xl p-1.5 space-y-0.5 z-30 animate-fade-in">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Meu Status de Atendimento
              </div>
              <button
                onClick={() => handlePresenceChange(AgentPresence.ONLINE)}
                className="w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 text-slate-200 text-left transition"
              >
                <Circle className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                <span>Disponível (Receber Conversas)</span>
              </button>
              <button
                onClick={() => handlePresenceChange(AgentPresence.AWAY)}
                className="w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 text-slate-200 text-left transition"
              >
                <Circle className="w-3 h-3 text-amber-400 fill-amber-400" />
                <span>Ausente (Intervalo / Almoço)</span>
              </button>
              <button
                onClick={() => handlePresenceChange(AgentPresence.BUSY)}
                className="w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 text-slate-200 text-left transition"
              >
                <Circle className="w-3 h-3 text-rose-400 fill-rose-400" />
                <span>Ocupado (Atendendo Presencial)</span>
              </button>
              <button
                onClick={() => handlePresenceChange(AgentPresence.OFFLINE)}
                className="w-full flex items-center space-x-2.5 px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-800 text-slate-400 text-left transition"
              >
                <Circle className="w-3 h-3 text-slate-500 fill-slate-500" />
                <span>Offline</span>
              </button>
            </div>
          )}
        </div>

        {/* Botão de Logout */}
        <button
          onClick={logout}
          className="mt-2 w-full flex items-center justify-center space-x-2 px-3 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/40 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sair da Conta</span>
        </button>
      </div>
    </aside>
  );
};

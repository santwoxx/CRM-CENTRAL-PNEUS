import React, { useState, useEffect } from 'react';
import {
  Activity,
  Users,
  Clock,
  Flame,
  AlertTriangle,
  Bot,
  MessageSquare,
  ShieldCheck,
  Eye,
  RefreshCw,
  Send,
  Lock,
  ArrowRightLeft,
  Circle,
} from 'lucide-react';
import { AgentPresence, ConversationStatus, type AgentPresenceDTO, type ConversationSummary, type DashboardMetrics, type MessageDTO } from '@crm/shared';
import { api } from '../services/api.js';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const AdminLiveMonitorPage: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [agents, setAgents] = useState<AgentPresenceDTO[]>([]);
  const [liveConversations, setLiveConversations] = useState<ConversationSummary[]>([]);
  const [spectatingConv, setSpectatingConv] = useState<ConversationSummary | null>(null);
  const [spectatingMessages, setSpectatingMessages] = useState<MessageDTO[]>([]);
  const [adminNote, setAdminNote] = useState('');
  const [isSendingNote, setIsSendingNote] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    try {
      const [m, a, l] = await Promise.all([
        api.get<DashboardMetrics>('/dashboard/metrics'),
        api.get<AgentPresenceDTO[]>('/dashboard/presence'),
        api.get<ConversationSummary[]>('/dashboard/live'),
      ]);
      setMetrics(m);
      setAgents(a || []);
      setLiveConversations(l || []);
    } catch (err) {
      console.error('Falha ao atualizar supervisao:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Polling suave de 5s como fallback para o socket
    return () => clearInterval(interval);
  }, []);

  // Quando o admin abre uma conversa para espionar ao vivo
  const handleSpectate = async (conv: ConversationSummary) => {
    setSpectatingConv(conv);
    try {
      const msgs = await api.get<{ items: MessageDTO[] }>(`/conversations/${conv.id}/messages`, {
        params: { limit: 50 },
      });
      setSpectatingMessages(msgs.items || []);
    } catch (err) {
      console.error(err);
    }
  };

  // Envia nota interna de orientação (sussurro do admin para o atendente)
  const handleSendAdminWhisper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spectatingConv || !adminNote.trim()) return;

    setIsSendingNote(true);
    try {
      await api.post(`/conversations/${spectatingConv.id}/messages`, {
        type: 'TEXT',
        content: `[ORIENTAÇÃO DA SUPERVISÃO]: ${adminNote.trim()}`,
        isPrivate: true,
      });
      setAdminNote('');
      const msgs = await api.get<{ items: MessageDTO[] }>(`/conversations/${spectatingConv.id}/messages`, {
        params: { limit: 50 },
      });
      setSpectatingMessages(msgs.items || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSendingNote(false);
    }
  };

  // Forçar presença de atendente pelo Admin
  const handleForcePresence = async (userId: string, presence: AgentPresence) => {
    try {
      await api.put(`/users/${userId}/presence`, { presence });
      loadData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6 select-none text-slate-100">
      {/* Topo do Painel de Supervisão */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
            <Activity className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">
              Supervisão em Tempo Real (Admin)
            </h1>
            <p className="text-xs text-slate-400">
              Monitoramento ao vivo dos atendentes, fila de espera e conversas em andamento
            </p>
          </div>
        </div>

        <button
          onClick={loadData}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Atualizar Agora</span>
        </button>
      </div>

      {/* 1. Indicadores Operacionais em Tempo Real (KPIs) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* IA Conduzindo */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Com IA / Triagem</span>
            <Bot className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-purple-400">
            {metrics?.live.botConversations ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">aquecendo leads</span>
        </div>

        {/* Fila de Espera */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Fila de Espera</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-amber-400">
            {metrics?.live.waitingInQueue ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">
            Mais antigo:{' '}
            {metrics?.live.oldestWaitingSeconds ? `${Math.round(metrics.live.oldestWaitingSeconds / 60)} min` : '0 min'}
          </span>
        </div>

        {/* Com Atendentes */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Em Atendimento</span>
            <MessageSquare className="w-4 h-4 text-brand-400" />
          </div>
          <div className="text-2xl font-black text-brand-400">
            {metrics?.live.activeWithAgents ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">conversas ativas</span>
        </div>

        {/* Atendentes Online */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Equipe Online</span>
            <Users className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">
            {metrics?.live.agentsOnline ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">
            {metrics?.live.agentsAvailable ?? 0} com vagas livres
          </span>
        </div>

        {/* SLA Estourado */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>SLA Violado</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className={`text-2xl font-black ${(metrics?.live.slaBreached ?? 0) > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`}>
            {metrics?.live.slaBreached ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">tempo excedido</span>
        </div>

        {/* Contenção da IA */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs mb-1">
            <span>Contenção IA</span>
            <Flame className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-white">
            {metrics?.today.aiContainmentRate ?? 0}%
          </div>
          <span className="text-[10px] text-slate-500">resolvidos sem humano</span>
        </div>
      </div>

      {/* 2. Grid de Presença e Ocupação dos Atendentes */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
          <Users className="w-4 h-4 text-brand-400" />
          <span>Status de Presença e Ocupação dos Atendentes</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {agents.map((agent) => {
            const isFull = agent.activeChats >= agent.maxConcurrentChats;
            const statusColor = {
              [AgentPresence.ONLINE]: 'bg-emerald-500',
              [AgentPresence.AWAY]: 'bg-amber-500',
              [AgentPresence.BUSY]: 'bg-rose-500',
              [AgentPresence.OFFLINE]: 'bg-slate-600',
            }[agent.presence];

            return (
              <div
                key={agent.userId}
                className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 relative hover:border-slate-700 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-xs">
                        {agent.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className={`w-3 h-3 rounded-full absolute -bottom-0.5 -right-0.5 border-2 border-slate-900 ${statusColor}`} />
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-slate-100">{agent.name}</h4>
                      <p className="text-[10px] text-slate-400">{agent.role}</p>
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                      agent.presence === AgentPresence.ONLINE
                        ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                        : agent.presence === AgentPresence.AWAY
                        ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {agent.presence}
                  </span>
                </div>

                {/* Barra de Capacidade de Chats */}
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-400">Capacidade de Chats:</span>
                    <strong className={isFull ? 'text-rose-400' : 'text-slate-200'}>
                      {agent.activeChats} / {agent.maxConcurrentChats}
                    </strong>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isFull ? 'bg-rose-500' : 'bg-brand-500'
                      }`}
                      style={{
                        width: `${Math.min(100, (agent.activeChats / agent.maxConcurrentChats) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Ações de Forçar Presença pelo Admin */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[10px]">
                  <span className="text-slate-400">Alterar Status:</span>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => handleForcePresence(agent.userId, AgentPresence.ONLINE)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-emerald-900/60 hover:text-emerald-300 transition"
                      title="Forçar Online"
                    >
                      On
                    </button>
                    <button
                      onClick={() => handleForcePresence(agent.userId, AgentPresence.AWAY)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-amber-900/60 hover:text-amber-300 transition"
                      title="Forçar Ausente"
                    >
                      Aus
                    </button>
                    <button
                      onClick={() => handleForcePresence(agent.userId, AgentPresence.OFFLINE)}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-900/60 hover:text-rose-300 transition"
                      title="Forçar Offline"
                    >
                      Off
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Feed de Conversas ao Vivo (Espião / Escuta do Admin) */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
          <Eye className="w-4 h-4 text-brand-400" />
          <span>Monitoramento ao Vivo de Conversas em Andamento ({liveConversations.length})</span>
        </h2>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-850 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3">Cliente / Telefone</th>
                  <th className="px-4 py-3">Setor</th>
                  <th className="px-4 py-3">Atendente</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Aquecimento IA</th>
                  <th className="px-4 py-3">Última Mensagem</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {liveConversations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      Nenhuma conversa ativa no momento.
                    </td>
                  </tr>
                ) : (
                  liveConversations.map((conv) => {
                    const isWarm = (conv.leadScore ?? 0) >= 60;
                    return (
                      <tr key={conv.id} className="hover:bg-slate-850/50 transition">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-100">
                            {conv.contact.name || conv.contact.pushName || 'Cliente'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {conv.contact.phone}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {conv.department ? (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: `${conv.department.color}22`,
                                color: conv.department.color,
                              }}
                            >
                              {conv.department.name}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">Geral</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {conv.assignedUser ? (
                            <span className="font-medium text-slate-200">
                              {conv.assignedUser.name}
                            </span>
                          ) : (
                            <span className="text-amber-400 italic text-[11px]">Na Fila</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              conv.status === ConversationStatus.BOT
                                ? 'bg-purple-950 text-purple-300 border border-purple-700/60'
                                : conv.status === ConversationStatus.QUEUED
                                ? 'bg-amber-950 text-amber-300 border border-amber-700/60 animate-pulse'
                                : 'bg-brand-950 text-brand-300 border border-brand-700/60'
                            }`}
                          >
                            {conv.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {conv.leadScore !== null && conv.leadScore !== undefined ? (
                            <span
                              className={`text-[11px] font-bold flex items-center space-x-1 ${
                                isWarm ? 'text-amber-400' : 'text-slate-400'
                              }`}
                            >
                              <Flame className={`w-3 h-3 ${isWarm ? 'fill-amber-400' : ''}`} />
                              <span>{conv.leadScore}%</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-xs truncate text-slate-400 text-[11px]">
                          {conv.lastMessage?.preview || '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleSpectate(conv)}
                            className="inline-flex items-center space-x-1.5 px-3 py-1 bg-brand-600/20 hover:bg-brand-600 text-brand-300 hover:text-white rounded-lg text-xs font-semibold border border-brand-500/30 transition"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Acompanhar ao Vivo</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal / Gaveta de Acompanhamento ao Vivo (Modo Espião / Whisper do Admin) */}
      {spectatingConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-2xl flex flex-col h-[650px] shadow-2xl animate-fade-in overflow-hidden">
            {/* Topo da Escuta */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-850">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-brand-600/30 text-brand-400">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-100 flex items-center space-x-2">
                    <span>
                      Escuta ao Vivo: {spectatingConv.contact.name || spectatingConv.contact.phone}
                    </span>
                    <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-700/60 px-2 py-0.2 rounded-full animate-pulse">
                      AO VIVO
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Atendente:{' '}
                    <strong className="text-slate-200">
                      {spectatingConv.assignedUser?.name || 'Com a IA / Na Fila'}
                    </strong>{' '}
                    • Setor:{' '}
                    <strong className="text-slate-200">
                      {spectatingConv.department?.name || 'Geral'}
                    </strong>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSpectatingConv(null)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
              >
                Fechar
              </button>
            </div>

            {/* Mensagens em Tempo Real */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60">
              {spectatingMessages.map((m) => {
                const isCust = m.direction === 'INBOUND';
                const isInternal = m.isPrivate;

                if (isInternal) {
                  return (
                    <div
                      key={m.id}
                      className="bg-amber-950/40 border border-amber-600/40 rounded-xl p-2.5 text-xs text-amber-200 my-1 max-w-lg mx-auto"
                    >
                      <div className="flex items-center space-x-1.5 font-bold text-[10px] text-amber-400 mb-1">
                        <Lock className="w-3 h-3" />
                        <span>NOTA INTERNA ({m.senderUser?.name})</span>
                      </div>
                      <p>{m.content}</p>
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isCust ? 'items-start' : 'items-end'}`}
                  >
                    <div
                      className={`max-w-md rounded-2xl p-2.5 text-xs ${
                        isCust
                          ? 'bg-slate-800 text-slate-200'
                          : m.senderType === 'AI'
                          ? 'bg-purple-900/60 border border-purple-700/60 text-purple-200'
                          : 'bg-brand-600 text-white'
                      }`}
                    >
                      <div className="text-[10px] opacity-70 mb-0.5">
                        {isCust ? 'Cliente' : m.senderType === 'AI' ? 'IA' : m.senderUser?.name}
                      </div>
                      <p>{m.content}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Enviar Sussurro / Orientação Interna pelo Admin */}
            <form
              onSubmit={handleSendAdminWhisper}
              className="p-3 border-t border-slate-800 bg-slate-900 flex items-center space-x-2"
            >
              <div className="flex items-center space-x-1 text-amber-400 text-xs px-2 shrink-0">
                <Lock className="w-3.5 h-3.5" />
                <span className="font-bold hidden sm:inline">Sussurro:</span>
              </div>
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="Escreva uma orientação interna para o atendente (o cliente não vê)..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-amber-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="submit"
                disabled={isSendingNote || !adminNote.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Enviar</span>
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

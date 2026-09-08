import React from 'react';
import {
  Search,
  Bot,
  User,
  Clock,
  CheckCheck,
  AlertTriangle,
  Flame,
  MessageCircle,
} from 'lucide-react';
import { ConversationStatus, MessageDirection } from '@crm/shared';
import { useChatStore, type InboxTab } from '../stores/chatStore.js';
import { useAuthStore } from '../stores/authStore.js';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ConversationListProps {
  departments: { id: string; name: string; color: string }[];
}

export const ConversationList: React.FC<ConversationListProps> = ({ departments }) => {
  const { user } = useAuthStore();
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    selectedDepartmentId,
    setSelectedDepartmentId,
  } = useChatStore();

  // Filtragem conforme a aba ativa
  const filtered = conversations.filter((c) => {
    // 1. Filtro de pesquisa de texto (nome, pushName ou telefone)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = c.contact.name?.toLowerCase().includes(q);
      const matchPush = c.contact.pushName?.toLowerCase().includes(q);
      const matchPhone = c.contact.phone?.includes(q);
      if (!matchName && !matchPush && !matchPhone) return false;
    }

    // 2. Filtro por departamento
    if (selectedDepartmentId && c.department?.id !== selectedDepartmentId) {
      return false;
    }

    // 3. Filtro por Aba
    if (activeTab === 'my') {
      return c.assignedUser?.id === user?.id && c.status !== ConversationStatus.RESOLVED;
    }
    if (activeTab === 'queue') {
      return c.status === ConversationStatus.QUEUED;
    }
    if (activeTab === 'bot') {
      return c.status === ConversationStatus.BOT;
    }
    if (activeTab === 'all') {
      return c.status !== ConversationStatus.RESOLVED;
    }
    if (activeTab === 'resolved') {
      return c.status === ConversationStatus.RESOLVED;
    }

    return true;
  });

  // Contagens para os badges das abas
  const counts = {
    my: conversations.filter((c) => c.assignedUser?.id === user?.id && c.status !== ConversationStatus.RESOLVED).length,
    queue: conversations.filter((c) => c.status === ConversationStatus.QUEUED).length,
    bot: conversations.filter((c) => c.status === ConversationStatus.BOT).length,
    all: conversations.filter((c) => c.status !== ConversationStatus.RESOLVED).length,
    resolved: conversations.filter((c) => c.status === ConversationStatus.RESOLVED).length,
  };

  const tabs: { id: InboxTab; label: string; count: number }[] = [
    { id: 'my', label: 'Minhas', count: counts.my },
    { id: 'queue', label: 'Fila', count: counts.queue },
    { id: 'bot', label: 'IA / Robô', count: counts.bot },
    { id: 'all', label: 'Todos', count: counts.all },
    { id: 'resolved', label: 'Resolvidas', count: counts.resolved },
  ];

  return (
    <div className="w-80 sm:w-96 bg-slate-900 border-r border-slate-800 flex flex-col h-full shrink-0 select-none">
      {/* Busca e Filtros */}
      <div className="p-3 border-b border-slate-800 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por cliente ou telefone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-800/80 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 transition"
          />
        </div>

        {/* Filtro por Departamento (chips) */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
          <button
            onClick={() => setSelectedDepartmentId(null)}
            className={`px-2.5 py-1 rounded-lg shrink-0 font-medium transition ${
              selectedDepartmentId === null
                ? 'bg-slate-700 text-white'
                : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos Setores
          </button>
          {departments.map((d) => (
            <button
              key={d.id}
              onClick={() => setSelectedDepartmentId(d.id === selectedDepartmentId ? null : d.id)}
              className={`px-2.5 py-1 rounded-lg shrink-0 font-medium flex items-center space-x-1.5 transition ${
                selectedDepartmentId === d.id
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>

        {/* Abas Superiores */}
        <div className="flex items-center justify-between border-t border-slate-800/80 pt-2 text-xs font-semibold">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`relative pb-1.5 px-1 transition flex items-center space-x-1 ${
                activeTab === tab.id
                  ? 'text-brand-400 border-b-2 border-brand-500'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    tab.id === 'queue'
                      ? 'bg-amber-500 text-slate-950 animate-pulse'
                      : activeTab === tab.id
                      ? 'bg-brand-500/20 text-brand-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Conversas com Scroll */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            <MessageCircle className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
            Nenhuma conversa encontrada nesta aba.
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === activeConversationId;
            const displayName = conv.contact.name || conv.contact.pushName || conv.contact.phone || 'Cliente';
            const isWarm = (conv.leadScore ?? 0) >= 60;

            return (
              <div
                key={conv.id}
                onClick={() => setActiveConversationId(conv.id)}
                className={`p-3 cursor-pointer transition flex items-start space-x-3 relative ${
                  isSelected
                    ? 'bg-slate-800/90 border-l-4 border-brand-500'
                    : 'hover:bg-slate-850/60'
                }`}
              >
                {/* Avatar do Contato */}
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-sm">
                    {displayName.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Badge de Status / Robô */}
                  {conv.aiControlled && (
                    <div className="absolute -bottom-1 -right-1 bg-purple-600 text-white rounded-full p-0.5 shadow">
                      <Bot className="w-3 h-3" />
                    </div>
                  )}
                </div>

                {/* Dados da Conversa */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-xs text-slate-100 truncate pr-1">
                      {displayName}
                    </h3>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {conv.lastMessage?.createdAt
                        ? formatDistanceToNow(new Date(conv.lastMessage.createdAt), {
                            addSuffix: false,
                            locale: ptBR,
                          })
                        : ''}
                    </span>
                  </div>

                  {/* Telefone e Badges */}
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span className="text-[11px] text-slate-400 font-mono">
                      {conv.contact.phone || 'WhatsApp'}
                    </span>

                    {/* Badge de Lead Aquecido */}
                    {isWarm && (
                      <span className="flex items-center text-[10px] font-bold text-amber-400 bg-amber-950/60 border border-amber-600/30 px-1 py-0.2 rounded">
                        <Flame className="w-2.5 h-2.5 mr-0.5 fill-amber-400" />
                        {conv.leadScore}%
                      </span>
                    )}

                    {/* Tag do Setor */}
                    {conv.department && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.2 rounded truncate max-w-[100px]"
                        style={{
                          backgroundColor: `${conv.department.color}22`,
                          color: conv.department.color,
                        }}
                      >
                        {conv.department.name}
                      </span>
                    )}
                  </div>

                  {/* Preview da Mensagem */}
                  <p className="text-xs text-slate-400 truncate mt-1">
                    {conv.lastMessage ? (
                      conv.lastMessage.direction === MessageDirection.OUTBOUND ? (
                        <span className="text-slate-400">Você: {conv.lastMessage.preview}</span>
                      ) : (
                        <span>{conv.lastMessage.preview}</span>
                      )
                    ) : (
                      <span className="italic text-slate-400">Conversa iniciada</span>
                    )}
                  </p>

                  {/* Linha de rodapé do card: Atendente + Alerta SLA */}
                  <div className="flex items-center justify-between mt-1.5 text-[10px]">
                    <div className="flex items-center space-x-1 text-slate-400 truncate">
                      <User className="w-3 h-3 shrink-0" />
                      <span className="truncate">
                        {conv.assignedUser ? conv.assignedUser.name : 'Aguardando Atendente'}
                      </span>
                    </div>

                    {/* Alerta de estouro de SLA */}
                    {conv.slaBreached && (
                      <span className="flex items-center text-rose-400 font-bold bg-rose-950/70 border border-rose-600/40 px-1.5 py-0.5 rounded-full animate-pulse">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                        SLA Estourado
                      </span>
                    )}

                    {/* Não lidas */}
                    {conv.unreadCount > 0 && (
                      <span className="bg-brand-500 text-white font-bold px-1.5 py-0.2 rounded-full text-[10px]">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

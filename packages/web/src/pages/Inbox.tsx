import React, { useState, useEffect } from 'react';
import { useChatStore } from '../stores/chatStore.js';
import { ConversationList } from '../components/ConversationList.js';
import { ChatArea } from '../components/ChatArea.js';
import { ContactInfoSidebar } from '../components/ContactInfoSidebar.js';
import { api } from '../services/api.js';
import { MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import type { ConversationDetail } from '@crm/shared';

export const InboxPage: React.FC = () => {
  const {
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    isContactInfoOpen,
  } = useChatStore();

  const [departments, setDepartments] = useState<{ id: string; name: string; color: string }[]>([]);
  const [activeConversationDetail, setActiveConversationDetail] = useState<ConversationDetail | null>(null);

  // Carrega departamentos e lista inicial de conversas
  const loadData = async () => {
    try {
      const [deptData, convData] = await Promise.all([
        api.get<any[]>('/departments'),
        api.get<{ items: any[] }>('/conversations', { params: { limit: 100 } }),
      ]);
      setDepartments(deptData || []);
      setConversations(convData.items || []);
    } catch (err) {
      console.error('Falha ao carregar dados do atendimento:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Quando seleciona uma conversa, busca o detalhe completo para a barra lateral
  useEffect(() => {
    if (!activeConversationId) {
      setActiveConversationDetail(null);
      return;
    }

    api
      .get<ConversationDetail>(`/conversations/${activeConversationId}`)
      .then((data) => setActiveConversationDetail(data))
      .catch((err) => console.error(err));
  }, [activeConversationId]);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Coluna 1: Lista de Conversas com Abas */}
      <ConversationList departments={departments} />

      {/* Coluna 2: Janela de Chat ou Tela Vazia */}
      {activeConversationId ? (
        <ChatArea
          conversationId={activeConversationId}
          departments={departments}
          onRefreshList={loadData}
          onConversationDeleted={() => {
            // A conversa deixou de existir: fecha o painel para nao ficar
            // exibindo mensagens de algo que ja foi apagado.
            setActiveConversationId(null);
            loadData();
          }}
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-950 p-8 text-center select-none text-slate-500">
          <div className="w-16 h-16 rounded-3xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 mb-4 shadow-xl">
            <MessageSquare className="w-8 h-8 opacity-60" />
          </div>
          <h2 className="text-base font-bold text-slate-300">Central de Atendimento Omnichannel</h2>
          <p className="text-xs text-slate-500 max-w-sm mt-1 leading-relaxed">
            Selecione uma conversa ao lado para visualizar o histórico de mensagens, assumir o contato ou transferir para outro setor.
          </p>
          <div className="mt-6 flex items-center space-x-2 text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 px-3.5 py-1.5 rounded-full">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>IA de Triagem e Aquecimento de Leads Ativa</span>
          </div>
        </div>
      )}

      {/* Coluna 3: Painel de Informações do Contato e Aquecimento da IA */}
      {activeConversationId && isContactInfoOpen && (
        <ContactInfoSidebar
          conversation={activeConversationDetail}
          onUpdate={() => {
            if (activeConversationId) {
              api.get<ConversationDetail>(`/conversations/${activeConversationId}`).then(setActiveConversationDetail);
            }
          }}
        />
      )}
    </div>
  );
};

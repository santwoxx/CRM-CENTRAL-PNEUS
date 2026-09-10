import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Paperclip,
  Lock,
  Bot,
  UserCheck,
  ArrowRightLeft,
  CheckCircle2,
  Check,
  CheckCheck,
  PanelRightOpen,
  PanelRightClose,
  Zap,
  Image as ImageIcon,
  File,
  Trash2,
} from 'lucide-react';
import { ConversationStatus, MessageDirection, MessageSenderType, MessageStatus, MessageType, type ConversationDetail, type MessageDTO, Permission } from '@crm/shared';
import { api } from '../services/api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useChatStore } from '../stores/chatStore.js';
import { TransferModal } from './TransferModal.js';
import { format } from 'date-fns';

interface ChatAreaProps {
  conversationId: string;
  departments: { id: string; name: string; color: string }[];
  onRefreshList?: () => void;
  /** Avisa a tela para fechar a conversa aberta apos a exclusao. */
  onConversationDeleted?: (conversationId: string) => void;
}

const QUICK_REPLIES = [
  {
    shortcut: 'pneus',
    title: 'Modelos de Pneus',
    content: 'Temos pneus novos das principais marcas (Pirelli, Michelin, Goodyear, Continental) com 5 anos de garantia. Qual o aro e medida do seu veículo?',
  },
  {
    shortcut: 'orcamento',
    title: 'Condições de Pagamento',
    content: 'Temos desconto especial de 7% à vista no PIX ou em até 10x sem juros no cartão de crédito com montagem grátis na loja.',
  },
  {
    shortcut: 'horario',
    title: 'Horário de Funcionamento',
    content: 'Nosso horário de funcionamento é de Segunda a Sexta das 08h às 18h e aos Sábados das 08h às 12h30.',
  },
  {
    shortcut: 'pix',
    title: 'Chave PIX da Central Pneus',
    content: 'Chave PIX CNPJ: 12.345.678/0001-90 (Central Pneus Comércio de Peças e Serviços Ltda). Por favor, nos envie o comprovante assim que concluir.',
  },
  {
    shortcut: 'alinhamento',
    title: 'Alinhamento 3D e Balanceamento',
    content: 'Nosso alinhamento é computadorizado 3D de alta precisão. O pacote inclui alinhamento + balanceamento das 4 rodas + revisão preventiva da suspensão.',
  },
];

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversationId,
  departments,
  onRefreshList,
  onConversationDeleted,
}) => {
  const { user } = useAuthStore();

  // A permissao vem do backend junto com o usuario; ADMIN e OWNER a possuem.
  // Esconder o botao e conveniencia - quem autoriza de fato e o servidor.
  const podeExcluir = user?.permissions?.includes(Permission.CONVERSATION_DELETE) ?? false;
  const {
    messages,
    setMessages,
    addMessage,
    typingUsers,
    isContactInfoOpen,
    toggleContactInfo,
  } = useChatStore();

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [inputText, setInputText] = useState('');
  const [isPrivateNote, setIsPrivateNote] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carrega os detalhes da conversa e o histórico de mensagens
  const loadConversationData = async () => {
    try {
      const [convData, msgData] = await Promise.all([
        api.get<ConversationDetail>(`/conversations/${conversationId}`),
        api.get<{ items: MessageDTO[] }>(`/conversations/${conversationId}/messages`, {
          params: { limit: 60 },
        }),
      ]);
      setConversation(convData);
      setMessages(conversationId, msgData.items || []);
    } catch (err) {
      console.error('Falha ao carregar conversa:', err);
    }
  };

  useEffect(() => {
    loadConversationData();
  }, [conversationId]);

  // Scroll automático para a última mensagem
  const currentMessages = messages[conversationId] || [];
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  // Assumir conversa
  const handleAssignSelf = async () => {
    if (!user) return;
    try {
      await api.post(`/conversations/${conversationId}/assign`, { userId: user.id });
      loadConversationData();
      onRefreshList?.();
    } catch (err) {
      console.error(err);
    }
  };

  // Alternar controle da IA
  const handleToggleAi = async () => {
    if (!conversation) return;
    try {
      const updated = await api.put<ConversationDetail>(`/conversations/${conversationId}/ai`, {
        aiControlled: !conversation.aiControlled,
      });
      setConversation(updated);
      onRefreshList?.();
    } catch (err) {
      console.error(err);
    }
  };

  // Finalizar conversa
  const handleResolve = async () => {
    if (!window.confirm('Deseja realmente finalizar este atendimento?')) return;
    try {
      await api.post(`/conversations/${conversationId}/resolve`, { sendClosingMessage: true });
      loadConversationData();
      onRefreshList?.();
    } catch (err) {
      console.error(err);
    }
  };

  /**
   * Excluir a conversa (somente administrador).
   *
   * Pede confirmacao digitada, e nao um simples "ok": a operacao apaga todo o
   * historico e nao tem volta. Um clique acidental num botao ao lado de
   * "Finalizar" custaria caro demais.
   */
  const handleDelete = async () => {
    const nome = conversation?.contact?.name || conversation?.contact?.phone || 'esta conversa';
    const resposta = window.prompt(
      `Isto apaga PERMANENTEMENTE a conversa de ${nome} e todas as mensagens dela.

` +
        'Digite APAGAR para confirmar:',
    );
    if (resposta?.trim().toUpperCase() !== 'APAGAR') return;

    try {
      await api.delete(`/conversations/${conversationId}`);
      onRefreshList?.();
      onConversationDeleted?.(conversationId);
    } catch (err: any) {
      window.alert(err?.message ?? 'Nao foi possivel apagar a conversa.');
    }
  };

  // Enviar mensagem ou nota interna
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !fileInputRef.current?.files?.length) return;

    setIsSending(true);
    const content = inputText.trim();
    const isPrivate = isPrivateNote;
    setInputText('');
    setShowQuickReplies(false);

    try {
      await api.post(`/conversations/${conversationId}/messages`, {
        type: MessageType.TEXT,
        content,
        isPrivate,
        clientMessageId: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      });
    } catch (err: any) {
      alert(err.message || 'Falha ao enviar mensagem');
      setInputText(content);
    } finally {
      setIsSending(false);
    }
  };

  // Upload de arquivo / anexo
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const uploadRes = await api.post<{ id: string; mimeType: string }>('/uploads', formData);
      let msgType: MessageType = MessageType.DOCUMENT;
      if (file.type.startsWith('image/')) msgType = MessageType.IMAGE;
      else if (file.type.startsWith('audio/')) msgType = MessageType.AUDIO;
      else if (file.type.startsWith('video/')) msgType = MessageType.VIDEO;

      await api.post(`/conversations/${conversationId}/messages`, {
        type: msgType,
        mediaId: uploadRes.id,
        content: file.name,
        isPrivate: isPrivateNote,
      });
    } catch (err) {
      console.error('Falha no upload:', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    // Se começou com '/', abre menu de respostas rápidas
    if (val.startsWith('/') && val.length > 1) {
      setShowQuickReplies(true);
    } else {
      setShowQuickReplies(false);
    }
  };

  const selectQuickReply = (text: string) => {
    setInputText(text);
    setShowQuickReplies(false);
  };

  const typingUser = typingUsers[conversationId];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* 1. Barra Superior do Chat */}
      <div className="h-16 border-b border-slate-800 bg-slate-900/90 backdrop-blur px-4 flex items-center justify-between z-10 shrink-0 select-none">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-brand-600 to-blue-500 flex items-center justify-center font-bold text-white shadow-md">
            {(conversation?.contact.name || conversation?.contact.pushName || 'CP').slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <h2 className="font-bold text-sm text-slate-100 truncate">
                {conversation?.contact.name || conversation?.contact.pushName || conversation?.contact.phone || 'Cliente'}
              </h2>
              {conversation?.department && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${conversation.department.color}22`,
                    color: conversation.department.color,
                  }}
                >
                  {conversation.department.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 font-mono">
              {conversation?.contact.phone} •{' '}
              <span className="text-slate-300">
                {conversation?.assignedUser ? `Atendente: ${conversation.assignedUser.name}` : 'Sem atendente'}
              </span>
            </p>
          </div>
        </div>

        {/* Ações Rápidas do Atendimento */}
        <div className="flex items-center space-x-2">
          {/* Assumir conversa */}
          {conversation?.assignedUser?.id !== user?.id && conversation?.status !== ConversationStatus.RESOLVED && (
            <button
              onClick={handleAssignSelf}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow transition"
            >
              <UserCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Assumir Conversa</span>
            </button>
          )}

          {/* Alternar IA (Ligar / Desligar robô) */}
          {conversation?.status !== ConversationStatus.RESOLVED && (
            <button
              onClick={handleToggleAi}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition ${
                conversation?.aiControlled
                  ? 'bg-purple-950/70 border-purple-600/60 text-purple-300 hover:bg-purple-900/60'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title={conversation?.aiControlled ? 'IA respondendo. Clique para pausar.' : 'IA pausada. Clique para reativar.'}
            >
              <Bot className="w-4 h-4" />
              <span className="hidden md:inline">{conversation?.aiControlled ? 'Robô Ativo' : 'Ativar IA'}</span>
            </button>
          )}

          {/* Transferir */}
          {conversation?.status !== ConversationStatus.RESOLVED && (
            <button
              onClick={() => setIsTransferOpen(true)}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition"
              title="Transferir para outro atendente ou setor"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>
          )}

          {/* Finalizar */}
          {conversation?.status !== ConversationStatus.RESOLVED && (
            <button
              onClick={handleResolve}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-950/70 border border-emerald-600/50 hover:bg-emerald-900/60 text-emerald-300 text-xs font-medium transition"
              title="Finalizar e fechar conversa"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span className="hidden md:inline">Finalizar</span>
            </button>
          )}

          {/* Excluir: so quem tem a permissao ve o botao. O backend confere
              de novo - a interface esconde, ela nao autoriza. */}
          {podeExcluir && (
            <button
              onClick={handleDelete}
              className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-red-950/70 border border-red-700/50 hover:bg-red-900/60 text-red-300 text-xs font-medium transition"
              title="Apagar a conversa e todo o historico (irreversivel)"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline">Apagar</span>
            </button>
          )}

          {/* Alternar Gaveta de Dados do Cliente */}
          <button
            onClick={toggleContactInfo}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Ver detalhes do cliente e veículo"
          >
            {isContactInfoOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* 2. Área de Mensagens (Timeline) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {currentMessages.map((msg) => {
          const isCustomer = msg.direction === MessageDirection.INBOUND;
          const isAI = msg.senderType === MessageSenderType.AI;
          const isInternal = msg.isPrivate;

          // Se for NOTA INTERNA DA EQUIPE
          if (isInternal) {
            return (
              <div
                key={msg.id}
                className="max-w-xl mx-auto bg-amber-950/40 border border-amber-500/40 rounded-2xl p-3 shadow-lg my-2 text-amber-100"
              >
                <div className="flex items-center justify-between border-b border-amber-600/30 pb-1.5 mb-1.5 text-[11px] font-bold text-amber-400">
                  <div className="flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5" />
                    <span>NOTA INTERNA DA EQUIPE (Privada - Cliente não visualiza)</span>
                  </div>
                  <span className="text-[10px] text-amber-500 font-normal">
                    {msg.senderUser?.name} • {format(new Date(msg.createdAt), 'HH:mm')}
                  </span>
                </div>
                <p className="text-xs text-amber-200 leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            );
          }

          // Mensagens comuns (Cliente, Atendente ou IA)
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-md lg:max-w-lg rounded-2xl p-3 shadow-md relative ${
                  isCustomer
                    ? 'bg-slate-800 text-slate-100 rounded-tl-sm'
                    : isAI
                    ? 'bg-purple-900/60 border border-purple-700/50 text-purple-100 rounded-tr-sm'
                    : 'bg-brand-600 text-white rounded-tr-sm'
                }`}
              >
                {/* Identificação do Remetente */}
                <div className="flex items-center justify-between space-x-2 text-[10px] mb-1 opacity-80 font-medium">
                  <span>
                    {isCustomer
                      ? conversation?.contact.name || conversation?.contact.pushName || 'Cliente'
                      : isAI
                      ? '🤖 Atendente Virtual Central Pneus'
                      : msg.senderUser?.name || 'Atendente'}
                  </span>
                  <span>{format(new Date(msg.createdAt), 'HH:mm')}</span>
                </div>

                {/* Conteúdo da Mensagem */}
                {msg.type === MessageType.IMAGE && msg.attachment && (
                  <div className="mb-2 overflow-hidden rounded-xl bg-slate-900">
                    <img
                      src={msg.attachment.url}
                      alt="Anexo"
                      className="max-h-60 w-full object-cover cursor-pointer hover:opacity-95 transition"
                      onClick={() => window.open(msg.attachment?.url, '_blank')}
                    />
                  </div>
                )}

                {msg.type === MessageType.AUDIO && msg.attachment && (
                  <div className="my-1.5">
                    <audio controls className="w-full h-8 brightness-90">
                      <source src={msg.attachment.url} type={msg.attachment.mimeType} />
                    </audio>
                  </div>
                )}

                {msg.type === MessageType.DOCUMENT && msg.attachment && (
                  <a
                    href={msg.attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-2 p-2 bg-slate-900/50 rounded-xl mb-1.5 hover:bg-slate-900 transition"
                  >
                    <File className="w-5 h-5 text-brand-400 shrink-0" />
                    <span className="text-xs truncate">{msg.attachment.fileName || 'Documento'}</span>
                  </a>
                )}

                {msg.content && (
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                )}

                {/* Ticks de Entrega (Apenas nas enviadas pela equipe) */}
                {!isCustomer && (
                  <div className="flex items-center justify-end space-x-1 mt-1 text-[10px] opacity-75">
                    {msg.status === MessageStatus.READ ? (
                      <CheckCheck className="w-3.5 h-3.5 text-blue-300" />
                    ) : msg.status === MessageStatus.DELIVERED ? (
                      <CheckCheck className="w-3.5 h-3.5 text-slate-300" />
                    ) : msg.status === MessageStatus.SENT ? (
                      <Check className="w-3.5 h-3.5 text-slate-300" />
                    ) : (
                      <span className="text-[9px] italic">enviando...</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Indicador de Digitação */}
        {typingUser && (
          <div className="flex items-center space-x-2 text-xs text-brand-400 italic">
            <span className="animate-pulse">● ● ●</span>
            <span>{typingUser} está digitando...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 3. Autocomplete de Respostas Rápidas (/atalhos) */}
      {showQuickReplies && (
        <div className="absolute bottom-20 left-4 right-4 max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-2 z-20 animate-fade-in max-h-48 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
            <Zap className="w-3 h-3 text-amber-400" />
            <span>Respostas Rápidas da Loja (Central Pneus)</span>
          </div>
          {QUICK_REPLIES.map((qr) => (
            <div
              key={qr.shortcut}
              onClick={() => selectQuickReply(qr.content)}
              className="p-2 hover:bg-slate-800 rounded-xl cursor-pointer transition text-xs"
            >
              <span className="font-bold text-brand-400 font-mono">/{qr.shortcut}</span>
              <span className="text-slate-300 ml-2 font-medium">{qr.title}</span>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">{qr.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* 4. Caixa de Entrada e Envio */}
      <div className="p-3 border-t border-slate-800 bg-slate-900 shrink-0">
        {/* Toggle Modo: Mensagem para Cliente vs Nota Interna */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsPrivateNote(false)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                !isPrivateNote
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Mensagem WhatsApp
            </button>
            <button
              type="button"
              onClick={() => setIsPrivateNote(true)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1 transition ${
                isPrivateNote
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lock className="w-3 h-3" />
              <span>Nota Interna (Equipe)</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Dica: digite <strong className="text-brand-400 font-mono">/pneus</strong> ou <strong className="text-brand-400 font-mono">/orcamento</strong>
          </span>
        </div>

        <form onSubmit={handleSendMessage} className="flex items-end space-x-2">
          {/* Botão de Anexo */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept="image/*,audio/*,application/pdf"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Enviar foto, comprovante ou documento"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Campo de Texto */}
          <div className="flex-1 relative">
            <textarea
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              placeholder={
                isPrivateNote
                  ? 'Escreva uma nota interna privada para a equipe...'
                  : 'Digite sua mensagem para o cliente (ou / para atalhos)...'
              }
              className={`w-full rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none transition resize-none max-h-28 ${
                isPrivateNote
                  ? 'bg-amber-950/30 border border-amber-500/60 focus:border-amber-400 text-amber-100'
                  : 'bg-slate-800 border border-slate-700 focus:border-brand-500'
              }`}
            />
          </div>

          {/* Botão de Enviar */}
          <button
            type="submit"
            disabled={isSending || (!inputText.trim() && !fileInputRef.current?.files?.length)}
            className={`p-2.5 rounded-xl text-white font-semibold transition disabled:opacity-40 ${
              isPrivateNote
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                : 'bg-brand-600 hover:bg-brand-500 shadow-md shadow-brand-600/20'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Modal de Transferência */}
      <TransferModal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        conversationId={conversationId}
        departments={departments}
        onTransferred={() => {
          loadConversationData();
          onRefreshList?.();
        }}
      />
    </div>
  );
};

import React, { useState } from 'react';
import {
  User,
  Phone,
  Mail,
  FileText,
  Flame,
  Tag,
  ShieldCheck,
  Bot,
  Plus,
  X,
  Building,
} from 'lucide-react';
import type { ConversationDetail } from '@crm/shared';
import { api } from '../services/api.js';

interface ContactInfoSidebarProps {
  conversation: ConversationDetail | null;
  onUpdate?: () => void;
}

export const ContactInfoSidebar: React.FC<ContactInfoSidebarProps> = ({
  conversation,
  onUpdate,
}) => {
  const [newTag, setNewTag] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!conversation) return null;

  const contact = conversation.contact;
  const leadScore = conversation.leadScore ?? 20;
  const isWarm = leadScore >= 60;

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;

    const currentTags = contact.tags || [];
    if (currentTags.includes(newTag.trim())) {
      setNewTag('');
      return;
    }

    setIsSaving(true);
    try {
      await api.put(`/contacts/${contact.id}`, {
        tags: [...currentTags, newTag.trim()],
      });
      setNewTag('');
      onUpdate?.();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    const currentTags = contact.tags || [];
    try {
      await api.put(`/contacts/${contact.id}`, {
        tags: currentTags.filter((t) => t !== tagToRemove),
      });
      onUpdate?.();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <aside className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 select-none text-slate-200">
      {/* Topo: Avatar e Identificação */}
      <div className="p-5 border-b border-slate-800 text-center relative">
        <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-brand-600 to-indigo-500 mx-auto flex items-center justify-center text-xl font-bold text-white shadow-xl shadow-brand-500/20 mb-3">
          {(contact.name || contact.pushName || 'CP').slice(0, 2).toUpperCase()}
        </div>
        <h3 className="font-bold text-sm text-slate-100 truncate">
          {contact.name || contact.pushName || 'Cliente WhatsApp'}
        </h3>
        <p className="text-xs text-slate-400 font-mono mt-0.5">{contact.phone || 'Sem número'}</p>

        <div className="mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-brand-400 border border-slate-700">
          {contact.lifecycleStage}
        </div>
      </div>

      <div className="p-4 space-y-5 text-xs">
        {/* Termômetro de Aquecimento de Lead da IA */}
        <div className="bg-slate-850 border border-slate-800 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-slate-300 flex items-center space-x-1.5">
              <Flame className={`w-4 h-4 ${isWarm ? 'text-amber-400 fill-amber-400' : 'text-slate-500'}`} />
              <span>Aquecimento do Lead</span>
            </span>
            <span
              className={`font-extrabold text-xs ${
                isWarm ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {leadScore}%
            </span>
          </div>

          {/* Barra de Progresso */}
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isWarm
                  ? 'bg-gradient-to-r from-amber-500 to-rose-500 shadow-sm shadow-amber-500/50'
                  : 'bg-brand-500'
              }`}
              style={{ width: `${leadScore}%` }}
            />
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            {isWarm
              ? '🔥 Lead qualificado e pronto para fechar! Detalhes do pneu/veículo identificados.'
              : 'Lead em triagem pela IA ou colhendo informações do veículo.'}
          </p>
        </div>

        {/* Resumo da IA */}
        {conversation.leadSummary && (
          <div className="bg-purple-950/30 border border-purple-800/40 rounded-2xl p-3.5 space-y-1.5">
            <div className="flex items-center space-x-1.5 text-purple-300 font-bold text-xs">
              <Bot className="w-3.5 h-3.5" />
              <span>Resumo Gerado pela IA</span>
            </div>
            <p className="text-[11px] text-purple-200/90 leading-snug">
              {conversation.leadSummary}
            </p>
          </div>
        )}

        {/* Dados de Contato */}
        <div className="space-y-3">
          <h4 className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
            Informações do Contato
          </h4>

          <div className="space-y-2 text-slate-300">
            <div className="flex items-center space-x-2">
              <Phone className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-mono text-[11px]">{contact.phone || 'Não informado'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Mail className="w-3.5 h-3.5 text-slate-500" />
              <span className="truncate text-[11px]">{conversation.contact.name ? `${contact.phone}@wa.me` : 'Sem e-mail'}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Building className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px]">
                Setor:{' '}
                <strong className="text-slate-100">
                  {conversation.department?.name || 'Geral / Não atribuído'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Etiquetas / Tags (ex: Aro 16, Corolla, Pirelli, Revisão) */}
        <div className="space-y-2">
          <h4 className="font-bold text-slate-400 uppercase tracking-wider text-[10px] flex items-center justify-between">
            <span className="flex items-center space-x-1">
              <Tag className="w-3 h-3" />
              <span>Etiquetas & Tags</span>
            </span>
            <span className="text-[10px] text-slate-500">{contact.tags?.length || 0}</span>
          </h4>

          <div className="flex flex-wrap gap-1.5">
            {(contact.tags || []).map((t) => (
              <span
                key={t}
                className="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded-lg text-[10px] flex items-center space-x-1"
              >
                <span>{t}</span>
                <button
                  onClick={() => handleRemoveTag(t)}
                  className="text-slate-500 hover:text-slate-300 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>

          <form onSubmit={handleAddTag} className="flex items-center space-x-1.5 mt-2">
            <input
              type="text"
              placeholder="Adicionar tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={isSaving}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Informações da Conversa */}
        <div className="bg-slate-850/60 rounded-xl p-3 border border-slate-800 space-y-1.5 text-[11px] text-slate-400">
          <div className="flex justify-between">
            <span>Canal:</span>
            <strong className="text-slate-200">{conversation.channel.name}</strong>
          </div>
          <div className="flex justify-between">
            <span>Atendente Atual:</span>
            <strong className="text-slate-200">
              {conversation.assignedUser?.name || 'Nenhum'}
            </strong>
          </div>
          <div className="flex justify-between">
            <span>Controle da IA:</span>
            <strong className={conversation.aiControlled ? 'text-purple-400' : 'text-slate-400'}>
              {conversation.aiControlled ? 'Robô Ativo' : 'Atendimento Humano'}
            </strong>
          </div>
        </div>
      </div>
    </aside>
  );
};

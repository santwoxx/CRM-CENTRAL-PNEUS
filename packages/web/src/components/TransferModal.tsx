import React, { useState } from 'react';
import { X, ArrowRightLeft, Users, Layers, MessageSquare } from 'lucide-react';
import { api } from '../services/api.js';
import { usePresenceStore } from '../stores/presenceStore.js';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  departments: { id: string; name: string; color: string }[];
  onTransferred?: () => void;
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  departments,
  onTransferred,
}) => {
  const { agents } = usePresenceStore();
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const onlineAgents = agents.filter((a) => a.acceptingChats || a.presence === 'ONLINE');

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeptId && !selectedUserId) {
      setError('Selecione ao menos um setor ou atendente de destino');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await api.post(`/conversations/${conversationId}/transfer`, {
        departmentId: selectedDeptId || null,
        userId: selectedUserId || null,
        note: note.trim() || undefined,
      });
      onTransferred?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Falha ao transferir conversa');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-fade-in text-slate-100">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-brand-500/20 text-brand-400">
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Transferir Conversa</h2>
              <p className="text-xs text-slate-400">Encaminhe o cliente para outro setor ou especialista</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mt-3 p-2.5 bg-rose-950/60 border border-rose-600/40 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleTransfer} className="mt-4 space-y-4">
          {/* Destino 1: Setor */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5 text-brand-400" />
              <span>Setor / Departamento</span>
            </label>
            <select
              value={selectedDeptId}
              onChange={(e) => setSelectedDeptId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
            >
              <option value="">-- Manter ou Distribuir Automaticamente --</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          {/* Destino 2: Atendente específico */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
              <Users className="w-3.5 h-3.5 text-brand-400" />
              <span>Atendente Específico (Opcional)</span>
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
            >
              <option value="">-- Qualquer Atendente Disponível no Setor --</option>
              {onlineAgents.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name} ({a.activeChats}/{a.maxConcurrentChats} atendimentos) - {a.presence}
                </option>
              ))}
            </select>
          </div>

          {/* Nota interna sobre a transferência */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center space-x-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
              <span>Motivo / Nota Interna (Privada para a equipe)</span>
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex: Cliente quer pneus aro 16, já passei os modelos, precisa negociar prazo de entrega..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 resize-none"
            />
          </div>

          {/* Botões */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-brand-600/20 disabled:opacity-50 transition"
            >
              {isSubmitting ? 'Transferindo...' : 'Confirmar Transferência'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Layers, Plus, Edit2, Trash2, Users, Clock, Check, X } from 'lucide-react';
import { api } from '../services/api.js';

export const DepartmentsPage: React.FC = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<any | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [menuLabel, setMenuLabel] = useState('');
  const [routingStrategy, setRoutingStrategy] = useState('LEAST_BUSY');
  const [offlineMessage, setOfflineMessage] = useState('');

  const loadDepartments = async () => {
    try {
      const data = await api.get<any[]>('/departments');
      setDepartments(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  const openCreateModal = () => {
    setEditingDept(null);
    setName('');
    setColor('#2563eb');
    setMenuLabel('');
    setRoutingStrategy('LEAST_BUSY');
    setOfflineMessage('');
    setIsModalOpen(true);
  };

  const openEditModal = (dept: any) => {
    setEditingDept(dept);
    setName(dept.name);
    setColor(dept.color || '#2563eb');
    setMenuLabel(dept.menuLabel || '');
    setRoutingStrategy(dept.routingStrategy || 'LEAST_BUSY');
    setOfflineMessage(dept.offlineMessage || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingDept) {
        await api.put(`/departments/${editingDept.id}`, {
          name,
          color,
          menuLabel: menuLabel || name.slice(0, 24),
          routingStrategy,
          offlineMessage: offlineMessage || null,
        });
      } else {
        await api.post('/departments', {
          name,
          color,
          menuLabel: menuLabel || name.slice(0, 24),
          routingStrategy,
          offlineMessage: offlineMessage || null,
        });
      }
      setIsModalOpen(false);
      loadDepartments();
    } catch (err: any) {
      alert(err.message || 'Falha ao salvar setor');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 p-6 overflow-y-auto space-y-6 select-none text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">Setores & Departamentos</h1>
            <p className="text-xs text-slate-400">
              Configure as equipes de atendimento, distribuição de conversas e menus do WhatsApp
            </p>
          </div>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-600/20 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Setor</span>
        </button>
      </div>

      {/* Grid de Departamentos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map((d) => (
          <div
            key={d.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 hover:border-slate-700 transition"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: d.color }} />
                <div>
                  <h3 className="font-bold text-sm text-slate-100">{d.name}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">/{d.slug}</p>
                </div>
              </div>

              <button
                onClick={() => openEditModal(d)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-slate-850 rounded-xl p-3 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Rótulo no Menu WhatsApp:</span>
                <strong className="text-slate-200 font-semibold">{d.menuLabel || d.name}</strong>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Estratégia de Distribuição:</span>
                <strong className="text-brand-400 font-semibold">
                  {d.routingStrategy === 'LEAST_BUSY' ? 'Menos Ocupado' : 'Rodízio Equitativo'}
                </strong>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Atendentes Vinculados:</span>
                <strong className="text-slate-200">{d.memberCount} membros</strong>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Fila no Momento:</span>
                <strong className={d.waitingCount > 0 ? 'text-amber-400 font-bold' : 'text-slate-400'}>
                  {d.waitingCount} aguardando
                </strong>
              </div>
            </div>

            {d.offlineMessage && (
              <p className="text-[11px] text-slate-400 italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80">
                "{d.offlineMessage}"
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Modal Criar / Editar Setor */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base">
                {editingDept ? 'Editar Setor' : 'Criar Novo Setor'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome do Setor</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Comercial, Financeiro, Oficina..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Cor Identificadora</label>
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-full h-9 bg-slate-800 border border-slate-700 rounded-xl p-1 cursor-pointer"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Distribuição</label>
                  <select
                    value={routingStrategy}
                    onChange={(e) => setRoutingStrategy(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                  >
                    <option value="LEAST_BUSY">Menos Ocupado</option>
                    <option value="ROUND_ROBIN">Rodízio (Round-Robin)</option>
                    <option value="MANUAL">Manual (Fila)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Rótulo no Menu WhatsApp (Máx. 24 caracteres)
                </label>
                <input
                  type="text"
                  maxLength={24}
                  value={menuLabel}
                  onChange={(e) => setMenuLabel(e.target.value)}
                  placeholder="Ex: 1 - Vendas de Pneus"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Mensagem Fora do Expediente
                </label>
                <textarea
                  rows={3}
                  value={offlineMessage}
                  onChange={(e) => setOfflineMessage(e.target.value)}
                  placeholder="Mensagem enviada automaticamente ao cliente quando o setor estiver fechado..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl p-2.5 text-slate-100 focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-bold shadow-md shadow-brand-600/20"
                >
                  Salvar Setor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

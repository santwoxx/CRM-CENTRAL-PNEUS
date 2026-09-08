import React, { useState, useEffect } from 'react';
import { Users, Plus, Shield, Mail, Circle, X } from 'lucide-react';
import { UserRole, AgentPresence } from '@crm/shared';
import { api } from '../services/api.js';

export const TeamPage: React.FC = () => {
  const [team, setTeam] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.AGENT);
  const [maxConcurrentChats, setMaxConcurrentChats] = useState(5);
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);

  const loadData = async () => {
    try {
      const [u, d] = await Promise.all([api.get<any[]>('/users'), api.get<any[]>('/departments')]);
      setTeam(u || []);
      setDepartments(d || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/users', {
        name,
        email,
        password,
        role,
        maxConcurrentChats: Number(maxConcurrentChats),
        departmentIds: selectedDeptIds,
      });
      setIsModalOpen(false);
      setName('');
      setEmail('');
      setPassword('');
      setSelectedDeptIds([]);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Falha ao cadastrar atendente');
    }
  };

  const toggleDept = (id: string) => {
    if (selectedDeptIds.includes(id)) {
      setSelectedDeptIds(selectedDeptIds.filter((d) => d !== id));
    } else {
      setSelectedDeptIds([...selectedDeptIds, id]);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 p-6 overflow-y-auto space-y-6 select-none text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">Equipe & Atendentes</h1>
            <p className="text-xs text-slate-400">
              Controle de atendentes, cargos administrativos e capacidade máxima simultânea
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-600/20 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Membro</span>
        </button>
      </div>

      {/* Tabela de Usuários */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-850 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
            <tr>
              <th className="px-5 py-3.5">Nome / E-mail</th>
              <th className="px-5 py-3.5">Cargo</th>
              <th className="px-5 py-3.5">Setores Vinculados</th>
              <th className="px-5 py-3.5">Presença</th>
              <th className="px-5 py-3.5">Chats Ativos / Teto</th>
              <th className="px-5 py-3.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {team.map((u) => (
              <tr key={u.id} className="hover:bg-slate-850/40 transition">
                <td className="px-5 py-3.5">
                  <div className="font-bold text-slate-100">{u.name}</div>
                  <div className="text-[11px] text-slate-400">{u.email}</div>
                </td>
                <td className="px-5 py-3.5">
                  <span className="font-semibold text-brand-400 bg-brand-950/80 border border-brand-800/40 px-2 py-0.5 rounded-full text-[10px]">
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex flex-wrap gap-1">
                    {u.departments.map((d: any) => (
                      <span
                        key={d.id}
                        className="px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{ backgroundColor: `${d.color}22`, color: d.color }}
                      >
                        {d.name}
                      </span>
                    ))}
                    {u.departments.length === 0 && (
                      <span className="text-slate-500 italic text-[11px]">Nenhum</span>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center space-x-1.5 font-medium">
                    <Circle
                      className={`w-2.5 h-2.5 ${
                        u.presence === AgentPresence.ONLINE
                          ? 'text-emerald-400 fill-emerald-400'
                          : u.presence === AgentPresence.AWAY
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-slate-500 fill-slate-500'
                      }`}
                    />
                    <span>{u.presence}</span>
                  </div>
                </td>
                <td className="px-5 py-3.5">
                  <strong className="text-slate-100">{u.activeChats}</strong>{' '}
                  <span className="text-slate-400">/ {u.maxConcurrentChats} simultâneos</span>
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      u.isActive
                        ? 'bg-emerald-950/70 text-emerald-400'
                        : 'bg-rose-950/70 text-rose-400'
                    }`}
                  >
                    {u.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal Criar Novo Membro */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md p-6 shadow-2xl animate-fade-in text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base">Novo Membro da Equipe</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carlos Vendas"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">E-mail de Acesso</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="carlos@centralpneus.com.br"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Senha Provisória</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 10 caracteres..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Cargo / Função</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                  >
                    <option value={UserRole.AGENT}>Atendente (AGENT)</option>
                    <option value={UserRole.SUPERVISOR}>Supervisor</option>
                    <option value={UserRole.ADMIN}>Administrador (ADMIN)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Capacidade de Chats
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={maxConcurrentChats}
                    onChange={(e) => setMaxConcurrentChats(Number(e.target.value))}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              {/* Selecionar Setores */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Setores de Atuação
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {departments.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => toggleDept(d.id)}
                      className={`px-3 py-1 rounded-xl text-xs font-semibold border transition ${
                        selectedDeptIds.includes(d.id)
                          ? 'bg-brand-600 text-white border-brand-500'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
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
                  Cadastrar Membro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

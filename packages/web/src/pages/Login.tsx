import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, Mail, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, isLoading, error } = useAuthStore();

  const [email, setEmail] = useState('admin@centralpneus.com.br');
  const [password, setPassword] = useState('AdminPassword123!');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/');
    } catch {
      // Erro gerenciado no store
    }
  };

  const setDemoUser = (userEmail: string, userPass: string) => {
    setEmail(userEmail);
    setPassword(userPass);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Luzes de fundo sutis (glassmorphism/glow) */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-brand-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl relative z-10 animate-fade-in">
        {/* Identidade Visual da Central Pneus */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-600 to-blue-400 mx-auto flex items-center justify-center shadow-xl shadow-brand-500/25 mb-3">
            <svg className="w-9 h-9 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="4"/>
              <line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/>
              <line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/>
              <line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/>
              <line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/>
            </svg>
          </div>
          <h1 className="text-xl font-black tracking-wide text-white">CENTRAL PNEUS</h1>
          <p className="text-xs text-brand-400 font-semibold tracking-wider uppercase mt-0.5">
            CRM Omnichannel Multi-Atendente
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-950/60 border border-rose-600/40 rounded-xl text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* Formulário de Login */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center space-x-1.5">
              <Mail className="w-3.5 h-3.5 text-brand-400" />
              <span>E-mail Corporativo</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="exemplo@centralpneus.com.br"
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center space-x-1.5">
              <Lock className="w-3.5 h-3.5 text-brand-400" />
              <span>Senha de Acesso</span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 bg-gradient-to-r from-brand-600 to-blue-600 hover:from-brand-500 hover:to-blue-500 text-white font-bold py-3 rounded-xl text-xs shadow-lg shadow-brand-600/25 flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            <span>{isLoading ? 'Entrando...' : 'Entrar no Sistema'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Acesso Rápido de Demonstração */}
        <div className="mt-6 pt-5 border-t border-slate-800 text-center">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Contas de Teste Pré-Configuradas
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setDemoUser('admin@centralpneus.com.br', 'AdminPassword123!')}
              className="p-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl text-left transition"
            >
              <span className="font-bold text-slate-200 block truncate">👑 Administrador</span>
              <span className="text-[10px] text-slate-400">admin@</span>
            </button>
            <button
              type="button"
              onClick={() => setDemoUser('carlos@centralpneus.com.br', 'Atendente123!')}
              className="p-2 bg-slate-800 hover:bg-slate-750 border border-slate-700 rounded-xl text-left transition"
            >
              <span className="font-bold text-slate-200 block truncate">🧑‍💼 Carlos (Vendas)</span>
              <span className="text-[10px] text-slate-400">carlos@</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

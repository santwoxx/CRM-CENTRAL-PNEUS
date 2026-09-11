import React, { useState } from 'react';
import { isFirebaseConfigured } from '../services/firebase.js';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, Mail, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../stores/authStore.js';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loginWithGoogle, isLoading, error } = useAuthStore();

  const handleGoogle = async () => {
    try {
      await loginWithGoogle();
      navigate('/');
    } catch {
      // A mensagem ja foi para o `error` da store e aparece na tela.
    }
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      navigate('/');
    } catch {
      // Erro gerenciado no store
    }
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
        {/* Google e o caminho principal de entrada. */}
        {isFirebaseConfigured ? (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              disabled={isLoading}
              className="w-full bg-white hover:bg-slate-100 text-slate-800 font-bold py-3.5 rounded-xl text-sm flex items-center justify-center gap-2.5 transition disabled:opacity-50 shadow-lg"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z"/>
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/>
                <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z"/>
                <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-5 6.7-5z"/>
              </svg>
              <span>{isLoading ? 'Entrando...' : 'Entrar com o Google'}</span>
            </button>

            <p className="text-center text-[11px] text-slate-500 mt-3 leading-relaxed">
              Use a conta Google cadastrada pelo administrador.
            </p>
          </>
        ) : (
          <div className="bg-amber-950/40 border border-amber-800/50 rounded-xl p-3 text-[11px] text-amber-300">
            Login com Google não está configurado neste ambiente. Use e-mail e senha.
          </div>
        )}

        {/*
          Senha continua disponivel, mas discreta.

          Nao e teimosia: o Firebase so autoriza login em dominios que voce
          cadastrou, e o endereco do tunel muda a cada reinicio. Sem esta
          porta, uma troca de endereco tranca todo mundo do lado de fora ate
          alguem entrar no console do Firebase.
        */}
        <div className="mt-6 pt-5 border-t border-slate-800">
          {!mostrarSenha ? (
            <button
              type="button"
              onClick={() => setMostrarSenha(true)}
              className="w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition"
            >
              Entrar com e-mail e senha
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail corporativo"
                autoComplete="username"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Senha"
                autoComplete="current-password"
                className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500 transition"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <span>{isLoading ? 'Entrando...' : 'Entrar'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

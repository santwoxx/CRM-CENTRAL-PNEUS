import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Smartphone, RefreshCw, Bot, User, Headphones, Info, Zap } from 'lucide-react';
import { api } from '../services/api.js';

/**
 * Simulador de cliente.
 *
 * Escreve como se fosse o cliente no WhatsApp e acompanha a conversa
 * acontecer. A mensagem percorre o MESMO caminho de uma mensagem real:
 * leitura da medida, consulta ao catalogo, resposta da IA, fila e
 * distribuicao. So o transporte muda - nada sai para a internet.
 */

interface Mensagem {
  id: string;
  from: 'cliente' | 'ia' | 'atendente' | 'sistema';
  author: string | null;
  text: string;
  status: string;
  at: string;
}

interface Conversa {
  conversationId: string | null;
  status: string | null;
  department: string | null;
  assignedTo: string | null;
  aiControlled: boolean;
  intent: string | null;
  leadScore: number | null;
  detected: Record<string, unknown>;
  messages: Mensagem[];
}

const VAZIO: Conversa = {
  conversationId: null, status: null, department: null, assignedTo: null,
  aiControlled: false, intent: null, leadScore: null, detected: {}, messages: [],
};

const SUGESTOES = [
  { texto: 'Bom dia! Vocês têm pneu 205/55 R16?', nota: 'lê a medida e busca preço real' },
  { texto: 'Quero um jogo de 195/65R15', nota: 'entende "jogo" = 4 e soma o total' },
  { texto: 'Meu carro é aro 16, tem pneu?', nota: 'pede a medida completa' },
  { texto: 'Meu pneu está com uma bolha na lateral', nota: 'caso de segurança → Oficina' },
  { texto: 'Quero falar com o financeiro', nota: 'transfere sem passar pela IA' },
  { texto: 'Quanto custa alinhamento?', nota: 'traz a tabela de serviços' },
];

const ROTULO_STATUS: Record<string, string> = {
  BOT: 'IA atendendo',
  QUEUED: 'Na fila',
  ASSIGNED: 'Com atendente',
  PENDING: 'Aguardando cliente',
  RESOLVED: 'Encerrada',
};

const ESTILO: Record<Mensagem['from'], { bolha: string; icone: React.ReactNode; nome: string }> = {
  cliente: { bolha: 'bg-brand-600 text-white ml-auto', icone: <User className="w-3 h-3" />, nome: 'Você (cliente)' },
  ia: { bolha: 'bg-slate-700 text-slate-100', icone: <Bot className="w-3 h-3" />, nome: 'IA' },
  atendente: { bolha: 'bg-emerald-700 text-white', icone: <Headphones className="w-3 h-3" />, nome: 'Atendente' },
  sistema: { bolha: 'bg-slate-800 text-slate-400 italic', icone: <Info className="w-3 h-3" />, nome: 'Sistema' },
};

export const SimulatorPage: React.FC = () => {
  const [telefone, setTelefone] = useState('31999990001');
  const [nome, setNome] = useState('Cliente Teste');
  const [texto, setTexto] = useState('');
  const [conversa, setConversa] = useState<Conversa>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fimDaLista = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const dados = await api.get(`/simulator/conversation?phone=${encodeURIComponent(telefone)}`);
      setConversa(dados);
    } catch {
      // Silencioso: a busca roda em laco e um erro pontual nao deve poluir a tela.
    }
  }, [telefone]);

  // A IA responde de forma assincrona (o worker processa a fila), entao a
  // tela consulta periodicamente em vez de esperar a resposta do envio.
  useEffect(() => {
    void carregar();
    const timer = setInterval(() => void carregar(), 3000);
    return () => clearInterval(timer);
  }, [carregar]);

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversa.messages.length]);

  const enviar = async (mensagem: string) => {
    const conteudo = mensagem.trim();
    if (!conteudo || enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      await api.post('/simulator/message', { phone: telefone, name: nome, text: conteudo });
      setTexto('');
      await carregar();
    } catch (e: any) {
      setErro(e?.message ?? 'Falha ao enviar');
    } finally {
      setEnviando(false);
    }
  };

  const reiniciar = async () => {
    if (!confirm('Apagar este contato e toda a conversa dele?')) return;
    await api.post('/simulator/reset', { phone: telefone }).catch(() => undefined);
    setConversa(VAZIO);
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-brand-500" />
          Simulador de cliente
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Escreva como se fosse o cliente no WhatsApp. A mensagem percorre o mesmo caminho de
          uma mensagem real — só não sai para a internet.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 max-w-6xl">
        {/* Celular do cliente */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[560px]">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-3 bg-slate-900/80">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 w-40"
              placeholder="Nome do cliente"
            />
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value.replace(/\D/g, ''))}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 w-36 font-mono"
              placeholder="31999990001"
            />
            <button
              onClick={reiniciar}
              title="Apagar a conversa e recomeçar"
              className="ml-auto text-slate-400 hover:text-slate-100 p-1.5 rounded-lg hover:bg-slate-800 transition"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {conversa.messages.length === 0 && (
              <p className="text-center text-xs text-slate-500 mt-16">
                Nenhuma mensagem ainda. Escreva abaixo ou use um exemplo ao lado.
              </p>
            )}

            {conversa.messages.map((m) => {
              const estilo = ESTILO[m.from];
              return (
                <div key={m.id} className={`max-w-[80%] ${m.from === 'cliente' ? 'ml-auto' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-slate-500">
                    {estilo.icone}
                    <span>{m.author ?? estilo.nome}</span>
                    <span>· {new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed whitespace-pre-wrap ${estilo.bolha}`}>
                    {m.text}
                  </div>
                </div>
              );
            })}
            <div ref={fimDaLista} />
          </div>

          {erro && (
            <div className="px-4 py-2 bg-red-950/60 border-t border-red-900 text-[11px] text-red-300">
              {erro}
            </div>
          )}

          <div className="p-3 border-t border-slate-800 flex gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void enviar(texto);
                }
              }}
              placeholder="Escreva como o cliente..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />
            <button
              onClick={() => void enviar(texto)}
              disabled={enviando || !texto.trim()}
              className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white px-4 rounded-xl transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* O que o sistema entendeu */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              O que o sistema entendeu
            </h2>

            {!conversa.conversationId ? (
              <p className="text-xs text-slate-500">Nenhuma conversa aberta.</p>
            ) : (
              <dl className="space-y-2 text-xs">
                <Linha rotulo="Situação" valor={ROTULO_STATUS[conversa.status ?? ''] ?? conversa.status} />
                <Linha rotulo="Setor" valor={conversa.department} />
                <Linha rotulo="Atendente" valor={conversa.assignedTo ?? '— (na fila)'} />
                <Linha rotulo="Intenção" valor={conversa.intent} />
                <Linha
                  rotulo="Lead"
                  valor={conversa.leadScore !== null ? `${conversa.leadScore}/100` : null}
                />
                {Object.entries(conversa.detected)
                  .filter(([chave]) => ['tireSize', 'quantity', 'vehicle', 'rim'].includes(chave))
                  .map(([chave, valor]) => (
                    <Linha
                      key={chave}
                      rotulo={
                        { tireSize: 'Medida', quantity: 'Quantidade', vehicle: 'Veículo', rim: 'Aro' }[chave] ?? chave
                      }
                      valor={String(valor)}
                    />
                  ))}
              </dl>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              Exemplos para testar
            </h2>
            <div className="space-y-1.5">
              {SUGESTOES.map((s) => (
                <button
                  key={s.texto}
                  onClick={() => void enviar(s.texto)}
                  disabled={enviando}
                  className="w-full text-left p-2.5 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-xl transition disabled:opacity-40"
                >
                  <span className="block text-[11px] text-slate-200">{s.texto}</span>
                  <span className="block text-[10px] text-slate-500 mt-0.5">{s.nota}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-[10px] text-slate-500 leading-relaxed px-1">
            A IA roda no seu computador e é gratuita. A primeira resposta pode levar de 30 a 90
            segundos porque o modelo carrega na memória; depois fica mais rápida.
          </p>
        </div>
      </div>
    </div>
  );
};

const Linha: React.FC<{ rotulo: string; valor: string | null | undefined }> = ({ rotulo, valor }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-slate-500">{rotulo}</dt>
    <dd className="text-slate-200 text-right font-medium">{valor ?? '—'}</dd>
  </div>
);

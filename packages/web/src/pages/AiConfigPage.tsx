import React, { useState, useEffect } from 'react';
import { Cpu, Save, Sparkles, Plus, X, DollarSign, BarChart2 } from 'lucide-react';
import { api } from '../services/api.js';

export const AiConfigPage: React.FC = () => {
  const [persona, setPersona] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);

  // Form
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-sonnet-5');
  const [temperature, setTemperature] = useState(0.4);
  const [maxTurnsBeforeHandoff, setMaxTurnsBeforeHandoff] = useState(10);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [qualificationGoals, setQualificationGoals] = useState<string[]>([]);
  const [newGoal, setNewGoal] = useState('');

  const loadData = async () => {
    try {
      const [p, u] = await Promise.all([api.get('/ai/persona'), api.get('/ai/usage')]);
      setPersona(p);
      setUsage(u);

      setName(p.name || '');
      setProvider(p.provider || 'anthropic');
      setModel(p.model || 'claude-sonnet-5');
      setTemperature(p.temperature ?? 0.4);
      setMaxTurnsBeforeHandoff(p.maxTurnsBeforeHandoff ?? 10);
      setSystemPrompt(p.systemPrompt || '');
      setQualificationGoals(p.qualificationGoals || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMsg(false);

    try {
      await api.put('/ai/persona', {
        name,
        provider,
        model,
        temperature: Number(temperature),
        maxTurnsBeforeHandoff: Number(maxTurnsBeforeHandoff),
        systemPrompt,
        qualificationGoals,
      });
      setSuccessMsg(true);
      setTimeout(() => setSuccessMsg(false), 3000);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Falha ao salvar persona');
    } finally {
      setIsSaving(false);
    }
  };

  const addGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.trim()) return;
    setQualificationGoals([...qualificationGoals, newGoal.trim()]);
    setNewGoal('');
  };

  const removeGoal = (idx: number) => {
    setQualificationGoals(qualificationGoals.filter((_, i) => i !== idx));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 p-6 overflow-y-auto space-y-6 select-none text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">
              Inteligência Artificial (Triagem & Aquecimento)
            </h1>
            <p className="text-xs text-slate-400">
              Personalize o comportamento do robô, critérios de aquecimento de lead e limites de transbordo
            </p>
          </div>
        </div>

        {successMsg && (
          <span className="text-xs text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-3 py-1.5 rounded-xl font-bold animate-fade-in">
            Configurações salvas com sucesso!
          </span>
        )}
      </div>

      {/* Métricas de Consumo da IA */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 flex items-center space-x-1.5 mb-1">
            <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
            <span>Custo Total Estimado</span>
          </span>
          <div className="text-xl font-black text-emerald-400">
            ${usage?.totalCostUsd ? usage.totalCostUsd.toFixed(4) : '0.0000'}
          </div>
          <span className="text-[10px] text-slate-500">Teto mensal: $200.00</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 flex items-center space-x-1.5 mb-1">
            <BarChart2 className="w-3.5 h-3.5 text-brand-400" />
            <span>Interações da IA</span>
          </span>
          <div className="text-xl font-black text-brand-400">
            {usage?.totalInteractions ?? 0}
          </div>
          <span className="text-[10px] text-slate-500">respostas geradas</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 mb-1 block">Tokens de Entrada</span>
          <div className="text-xl font-black text-slate-200">
            {usage?.totalInputTokens ? (usage.totalInputTokens / 1000).toFixed(1) + 'k' : '0'}
          </div>
          <span className="text-[10px] text-slate-500">histórico e contexto</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
          <span className="text-xs text-slate-400 mb-1 block">Tokens de Saída</span>
          <div className="text-xl font-black text-purple-400">
            {usage?.totalOutputTokens ? (usage.totalOutputTokens / 1000).toFixed(1) + 'k' : '0'}
          </div>
          <span className="text-[10px] text-slate-500">respostas emitidas</span>
        </div>
      </div>

      {/* Formulário da Persona */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
          <h3 className="font-bold text-sm text-slate-200 uppercase tracking-wider flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>Parâmetros de Execução</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-300 mb-1">Provedor Plugável</label>
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  if (e.target.value === 'anthropic') setModel('claude-sonnet-5');
                  else setModel('gpt-4o-mini');
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-purple-500"
              >
                <option value="anthropic">Anthropic (Claude 3.5 Sonnet)</option>
                <option value="openai">OpenAI (GPT-4o-mini)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">Modelo de Linguagem</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1">
                Máx. Turnos até Transbordo Obrigatório
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={maxTurnsBeforeHandoff}
                onChange={(e) => setMaxTurnsBeforeHandoff(Number(e.target.value))}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100"
              />
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="block font-semibold text-slate-300 mb-1 text-xs">
              Prompt do Sistema (Instruções e Regras da Central Pneus)
            </label>
            <textarea
              rows={9}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-2xl p-4 text-xs text-slate-100 leading-relaxed font-mono focus:outline-none focus:border-purple-500 resize-y"
            />
          </div>

          {/* Metas de Aquecimento do Lead */}
          <div className="space-y-3 pt-2">
            <label className="block font-semibold text-slate-300 text-xs">
              Critérios para Considerar o Lead Aquecido (Gatilhos de Transbordo)
            </label>
            <div className="space-y-2">
              {qualificationGoals.map((goal, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2.5 bg-slate-850 border border-slate-800 rounded-xl text-xs"
                >
                  <span className="text-slate-200">• {goal}</span>
                  <button
                    type="button"
                    onClick={() => removeGoal(idx)}
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="text"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder="Ex: Identificar a quantidade de pneus desejada..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={addGoal}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Meta</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center space-x-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-2xl text-xs font-bold shadow-lg shadow-purple-600/25 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Salvando...' : 'Salvar Alterações da IA'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Radio, QrCode, CheckCircle, AlertTriangle, RefreshCw, Smartphone, Key, Plus, X } from 'lucide-react';
import { ChannelType, ChannelStatus } from '@crm/shared';
import { api } from '../services/api.js';

export const ChannelsPage: React.FC = () => {
  const [channels, setChannels] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Form
  const [type, setType] = useState<ChannelType>(ChannelType.WHATSAPP_CLOUD);
  const [name, setName] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('central-pneus-webhook-token');

  // Evolution Form
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080');
  const [apiKey, setApiKey] = useState('');
  const [instance, setInstance] = useState('central-pneus');

  const loadChannels = async () => {
    try {
      const data = await api.get<any[]>('/channels');
      setChannels(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const credentials: Record<string, string> =
        type === ChannelType.WHATSAPP_CLOUD
          ? { accessToken, phoneNumberId, appSecret, verifyToken }
          : { baseUrl, apiKey, instance };

      await api.post('/channels', {
        type,
        name,
        credentials,
        isDefault: channels.length === 0,
      });

      setIsModalOpen(false);
      setName('');
      loadChannels();
    } catch (err: any) {
      alert(err.message || 'Falha ao conectar canal');
    }
  };

  const handleTestHealth = async (channelId: string) => {
    setTestingId(channelId);
    try {
      const res = await api.post(`/channels/${channelId}/test`);
      loadChannels();
      alert(`Status da Conexão: ${res.status}${res.detail ? ` (${res.detail})` : ''}`);
    } catch (err: any) {
      alert(err.message || 'Falha no teste');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 p-6 overflow-y-auto space-y-6 select-none text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-2xl bg-brand-600/20 text-brand-400 border border-brand-500/30">
            <Radio className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-wide">Canais WhatsApp</h1>
            <p className="text-xs text-slate-400">
              Gerencie a conexão do número único via WhatsApp Cloud Oficial (Meta) e contingência (Evolution API)
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-brand-600/20 transition"
        >
          <Plus className="w-4 h-4" />
          <span>Conectar Novo Canal</span>
        </button>
      </div>

      {/* Grid de Canais */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {channels.map((c) => {
          const isConnected = c.status === ChannelStatus.CONNECTED;
          return (
            <div
              key={c.id}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 hover:border-slate-700 transition relative"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="p-3 rounded-2xl bg-slate-800 border border-slate-700 text-brand-400">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-bold text-sm text-slate-100">{c.name}</h3>
                      {c.isDefault && (
                        <span className="text-[10px] font-bold bg-brand-950 text-brand-300 border border-brand-700/50 px-2 py-0.2 rounded-full">
                          Principal
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      {c.identifier || 'Número não vinculado'} • {c.type}
                    </p>
                  </div>
                </div>

                <span
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center space-x-1.5 ${
                    isConnected
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                      : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}
                  />
                  <span>{c.status}</span>
                </span>
              </div>

              <div className="bg-slate-850 rounded-2xl p-4 border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Campos Configurados:</span>
                  <span className="text-slate-200 font-mono">
                    {c.configuredFields.join(', ') || 'Nenhum'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Última Checagem de Conexão:</span>
                  <span className="text-slate-200">{c.lastHealthCheckAt || 'Nunca'}</span>
                </div>
              </div>

              {/* Botão de Testar Conexão / Sincronizar */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => handleTestHealth(c.id)}
                  disabled={testingId === c.id}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingId === c.id ? 'animate-spin' : ''}`} />
                  <span>{testingId === c.id ? 'Testando...' : 'Testar Conexão'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Conectar Novo Canal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg p-6 shadow-2xl animate-fade-in text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
              <h3 className="font-bold text-base">Conectar Canal WhatsApp</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateChannel} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Tipo de Provedor</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ChannelType)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                >
                  <option value={ChannelType.WHATSAPP_CLOUD}>
                    WhatsApp Cloud API Oficial (Meta Developers)
                  </option>
                  <option value={ChannelType.WHATSAPP_EVOLUTION}>
                    WhatsApp Não-Oficial (Evolution API / QR Code Contingência)
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Nome do Canal / Identificador
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: WhatsApp Oficial Central Pneus"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* Campos do WhatsApp Cloud Oficial */}
              {type === ChannelType.WHATSAPP_CLOUD ? (
                <div className="space-y-3 bg-slate-850 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Phone Number ID</label>
                    <input
                      type="text"
                      required
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      placeholder="Ex: 104829384910293"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Access Token Permanente</label>
                    <input
                      type="password"
                      required
                      value={accessToken}
                      onChange={(e) => setAccessToken(e.target.value)}
                      placeholder="EAA..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">App Secret da Meta</label>
                    <input
                      type="password"
                      required
                      value={appSecret}
                      onChange={(e) => setAppSecret(e.target.value)}
                      placeholder="Segredo do app para validar HMAC"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                </div>
              ) : (
                /* Campos da Evolution API */
                <div className="space-y-3 bg-slate-850 p-4 rounded-2xl border border-slate-800">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">URL Base da Evolution</label>
                    <input
                      type="text"
                      required
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="http://localhost:8080"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">API Key Global</label>
                    <input
                      type="password"
                      required
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Nome da Instância</label>
                    <input
                      type="text"
                      required
                      value={instance}
                      onChange={(e) => setInstance(e.target.value)}
                      placeholder="central-pneus"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-[11px]"
                    />
                  </div>
                </div>
              )}

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
                  Salvar Canal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

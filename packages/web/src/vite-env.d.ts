/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL publica da API (ex.: https://crm.seudominio.com.br).
   *
   * Em desenvolvimento fica vazia: o proxy do Vite encaminha /api e /socket.io
   * para localhost:3333. Em producao (Vercel) o proxy nao existe, entao esta
   * variavel PRECISA estar definida ou o front nao acha o backend.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

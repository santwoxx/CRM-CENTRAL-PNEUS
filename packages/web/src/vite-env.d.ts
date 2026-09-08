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

  /**
   * Configuracao do Firebase (login com Google).
   * A apiKey do Firebase e publica por design - o que protege o projeto e a
   * lista de dominios autorizados no console, nao o sigilo desta chave.
   */
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

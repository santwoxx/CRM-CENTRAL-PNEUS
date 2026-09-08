import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';

/**
 * Login com a conta Google via Firebase Authentication.
 *
 * O Firebase aqui serve a UMA finalidade: provar quem e a pessoa. Quem decide
 * se ela pode entrar - e com qual cargo - continua sendo o nosso backend, que
 * confere o token contra as chaves publicas do Google e procura o usuario no
 * banco. O Firebase nunca dita permissao.
 *
 * Sobre a `apiKey` estar no codigo do frontend: e assim mesmo. A chave web do
 * Firebase e um identificador publico, nao um segredo - ela apenas aponta para
 * o projeto. A protecao real vem de duas coisas que voce configura no console:
 * a lista de dominios autorizados e as regras do projeto.
 */

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

/** true quando o projeto foi configurado; o botao so aparece nesse caso. */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/** Inicializa sob demanda: quem usa so senha nao carrega o SDK a toa. */
function getFirebaseAuth(): Auth {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase nao configurado: defina as variaveis VITE_FIREBASE_* no build.');
  }

  if (!auth) {
    app ??= initializeApp(config);
    auth = getAuth(app);
  }

  return auth;
}

export interface GoogleSignInResult {
  idToken: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Abre o popup do Google e devolve o ID token para o backend validar.
 * Nao guarda sessao do Firebase: a sessao que vale e a nossa.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const firebaseAuth = getFirebaseAuth();
  await setPersistence(firebaseAuth, browserLocalPersistence);

  const provider = new GoogleAuthProvider();
  // Forca a escolha da conta: sem isso o Google reusa a ultima sessao em
  // silencio, o que atrapalha quem tem conta pessoal e de trabalho.
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await signInWithPopup(firebaseAuth, provider);
  const idToken = await credential.user.getIdToken();

  return {
    idToken,
    email: credential.user.email,
    displayName: credential.user.displayName,
  };
}

/** Encerra a sessao do Firebase. Chamado junto do nosso logout. */
export async function signOutFromGoogle(): Promise<void> {
  if (!auth) return;
  await signOut(auth).catch(() => undefined);
}

/** Mensagens do Firebase traduzidas para algo que o usuario entenda. */
export function describeFirebaseError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code ?? '';

  const messages: Record<string, string> = {
    'auth/popup-closed-by-user': 'Voce fechou a janela do Google antes de concluir.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere os pop-ups e tente de novo.',
    'auth/cancelled-popup-request': 'Havia outra janela de login aberta.',
    'auth/network-request-failed': 'Falha de rede ao falar com o Google.',
    'auth/unauthorized-domain':
      'Este endereco nao esta autorizado no Firebase. Adicione-o em Authentication > Settings > Authorized domains.',
    'auth/operation-not-allowed':
      'O provedor Google esta desativado. Ative em Authentication > Sign-in method.',
  };

  return messages[code] ?? (error instanceof Error ? error.message : 'Falha ao entrar com o Google.');
}

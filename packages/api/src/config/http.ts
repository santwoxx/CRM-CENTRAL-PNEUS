/** Politica HTTP compartilhada entre o servidor e as rotas de sessao. */

export function corsOriginOption(origins: string[], production: boolean): string[] | boolean {
  if (origins.length > 0) return origins;

  // Em producao, lista vazia significa painel na mesma origem. Refletir toda
  // origem junto com credentials=true permitiria que qualquer site tentasse
  // usar os cookies do CRM.
  return production ? false : true;
}

export function refreshCookieOptions(production: boolean, ttlMs: number) {
  return {
    path: '/',
    httpOnly: true,
    secure: production,
    // Frontend e API podem estar em sites distintos em producao. Navegadores
    // exigem SameSite=None + Secure para enviar o cookie nesse cenario.
    sameSite: production ? ('none' as const) : ('lax' as const),
    maxAge: Math.floor(ttlMs / 1_000),
  };
}

export function clearRefreshCookieOptions(production: boolean) {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions(production, 0);
  return options;
}

/**
 * Cookies SameSite=None precisam de uma defesa de origem no servidor. CORS
 * controla quem le a resposta, mas sozinho nao impede um POST malicioso.
 * Requisicoes sem Origin continuam permitidas para CLI e integracoes legadas.
 */
export function isTrustedRequestOrigin(
  origin: string | undefined,
  publicApiUrl: string,
  corsOrigins: string[],
): boolean {
  if (origin === undefined) return true;

  const requestOrigin = normalizeOrigin(origin);
  if (!requestOrigin) return false;

  return [publicApiUrl, ...corsOrigins].some(
    (allowed) => normalizeOrigin(allowed) === requestOrigin,
  );
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

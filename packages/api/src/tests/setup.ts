/**
 * Preparacao do ambiente de teste.
 *
 * POR QUE ISTO EXISTE
 *
 * `env.ts` valida a configuracao no carregamento do modulo e chama
 * `process.exit(1)` quando falta algo. Em producao isso e o comportamento
 * certo: melhor o processo morrer no boot do que atender pela metade com um
 * `undefined` viajando pelo codigo.
 *
 * Em teste, porem, qualquer arquivo que importe um modulo do sistema puxa
 * `env.ts` junto e morre antes da primeira asserção. Na minha maquina isso
 * nao aparecia, porque existe um `.env`; no CI, que comeca limpo, quatro dos
 * sete arquivos falhavam. Foi o CI que encontrou - e e exatamente para isso
 * que ele serve.
 *
 * Aqui preenchemos apenas o que a validacao exige, com valores obviamente
 * falsos. Teste que precise de banco de verdade substitui o que precisar.
 */

const PADROES: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://teste:teste@localhost:5432/teste?schema=public',
  REDIS_URL: 'redis://localhost:6379/15',
  // 32+ caracteres para passar na validacao. Nunca saem daqui.
  JWT_ACCESS_SECRET: 'segredo-de-teste-sem-valor-algum-0123456789',
  JWT_REFRESH_SECRET: 'outro-segredo-de-teste-sem-valor-0123456789',
  PUBLIC_API_URL: 'http://localhost:3333',
  AI_PROVIDER: 'ollama',
};

for (const [chave, valor] of Object.entries(PADROES)) {
  // Nunca sobrescreve o que ja veio do ambiente: assim da para rodar um teste
  // apontando para um banco real quando for preciso.
  process.env[chave] ??= valor;
}

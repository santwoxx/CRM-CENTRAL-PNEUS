import tseslint from 'typescript-eslint';

/**
 * Configuracao minima de qualidade para todo o monorepo.
 *
 * O script `npm run lint` existia, mas o ESLint 9 exige uma configuracao
 * flat e por isso o comando encerrava antes de analisar qualquer arquivo.
 * Mantemos as regras recomendadas do TypeScript e ignoramos apenas artefatos
 * gerados ou dados locais.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'storage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // O projeto ainda possui fronteiras dinamicas (Prisma, payloads de
      // provedores e respostas HTTP) onde `any` e intencional. A verificacao
      // estrita do TypeScript continua sendo a barreira principal.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // "tire esta propriedade e me devolva o resto" e um descarte
          // proposital, nao um esquecimento. O caso real aqui e remover o
          // refreshToken do JSON quando a sessao viaja por cookie - renomear
          // ou silenciar com comentario seria pior que ajustar a regra.
          ignoreRestSiblings: true,
        },
      ],
    },
  },
);

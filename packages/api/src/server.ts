import fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { env, isProduction } from './env.js';
import { isApiPath } from './lib/routes.js';
import { logger } from './lib/logger.js';
import { checkDatabase, disconnectDatabase } from './db/prisma.js';
import { checkRedis, disconnectRedis } from './lib/redis.js';
import { errorsPlugin } from './plugins/errors.js';
import { authPlugin } from './plugins/auth.js';
import { spaPlugin } from './plugins/spa.js';
import { setupSocketServer } from './realtime/server.js';
import { unsubscribeRealtime } from './realtime/bus.js';
import { closeQueues, registerRepeatableJobs } from './queue/queues.js';
import { startWorkers } from './queue/workers/index.js';

// Rotas
import { authRoutes } from './modules/auth/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { departmentRoutes } from './modules/departments/routes.js';
import { contactRoutes } from './modules/contacts/routes.js';
import { conversationRoutes } from './modules/conversations/routes.js';
import { messageRoutes } from './modules/messages/routes.js';
import { channelRoutes } from './modules/channels/routes.js';
import { aiRoutes } from './modules/ai/routes.js';
import { dashboardRoutes } from './modules/dashboard/routes.js';
import { mediaRoutes } from './modules/media/routes.js';
import { webhookRoutes } from './modules/webhooks/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { simulatorRoutes } from './modules/simulator/routes.js';

async function buildServer() {
  const app = fastify({
    loggerInstance: logger,
    disableRequestLogging: env.LOG_LEVEL !== 'debug' && env.LOG_LEVEL !== 'trace',

    /**
     * Aceita as chamadas de API tambem sob o prefixo /api.
     *
     * O painel servido pelo proprio backend chama /api/auth/login (mesma
     * origem). O proxy do Vite em desenvolvimento faz o mesmo. Ja um
     * frontend hospedado a parte, com VITE_API_URL absoluta, chama a raiz.
     * Removendo o prefixo aqui - antes do roteamento - as tres formas caem
     * nas mesmas rotas, sem duplicar nada.
     */
    rewriteUrl(request) {
      const url = request.url ?? '/';
      if (url !== '/api' && !url.startsWith('/api/')) return url;

      const stripped = url.slice(4) || '/';
      const candidate = stripped.startsWith('/') ? stripped : `/${stripped}`;

      // So removemos o prefixo quando sobra uma rota de API de verdade.
      // Assim /api/inexistente continua sendo /api/inexistente e termina em
      // 404 JSON, em vez de virar /inexistente e receber o index.html.
      return isApiPath(candidate) ? candidate : url;
    },
  });

  // Plugins essenciais
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : true,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(multipart, {
    limits: {
      fileSize: 64 * 1024 * 1024, // 64MB para vídeos, documentos e áudios
    },
  });

  /**
   * Cabecalhos de seguranca.
   *
   * O pacote ja era dependencia mas nunca fora registrado - a aplicacao subia
   * sem CSP, sem protecao contra clickjacking e sem nosniff.
   *
   * A CSP e restritiva porque o painel e servido desta mesma origem: se um
   * script conseguisse executar aqui, leria o token do atendente. As fontes
   * externas liberadas sao exatamente as que o index.html usa.
   */
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' no estilo e exigencia do Tailwind em runtime;
        // em script NAO ha excecao, que e o que realmente importa.
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        // O painel fala com a propria origem e com o Firebase (login Google).
        connectSrc: [
          "'self'",
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com',
          'https://www.googleapis.com',
          'wss:',
          'ws:',
        ],
        frameSrc: ["'self'", 'https://crm-central-3c633.firebaseapp.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // O login com Google abre popup: sem isto, a janela nao consegue voltar.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  /**
   * Limite de requisicoes.
   *
   * O `allowList: ['127.0.0.1']` que estava aqui desligava o limite por
   * completo neste deploy: atras do tunel (e de qualquer proxy reverso) TODA
   * requisicao externa chega como 127.0.0.1. A protecao existia no papel e
   * nao valia para ninguem.
   *
   * A chave passou a ser o usuario autenticado quando ha sessao, e o IP real
   * quando nao ha - assim um atendente nao consome a cota do outro.
   */
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.user?.id ?? clientIp(request),
    // Webhook da Meta chega em rajada legitima e ja e autenticado por HMAC.
    allowList: (request) => (request.raw.url ?? '').startsWith('/webhooks/'),
  });

  await app.register(errorsPlugin);
  await app.register(authPlugin);

  // Registro de rotas modulares
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(departmentRoutes, { prefix: '/departments' });
  await app.register(contactRoutes, { prefix: '/contacts' });
  await app.register(conversationRoutes, { prefix: '/conversations' });
  await app.register(messageRoutes);
  await app.register(channelRoutes, { prefix: '/channels' });
  await app.register(aiRoutes, { prefix: '/ai' });
  await app.register(dashboardRoutes, { prefix: '/dashboard' });
  await app.register(simulatorRoutes, { prefix: '/simulator' });
  await app.register(mediaRoutes);
  await app.register(webhookRoutes, { prefix: '/webhooks' });
  await app.register(healthRoutes, { prefix: '/health' });

  // Por ultimo: o painel so responde onde nenhuma rota de API respondeu.
  await app.register(spaPlugin);

  // Gateway Socket.IO acoplado ao servidor HTTP do Fastify
  setupSocketServer(app.server);

  return app;
}

async function main() {
  logger.info({ role: env.ROLE, env: env.NODE_ENV }, 'Inicializando CRM Central Pneus...');

  const [dbStatus, redisStatus] = await Promise.all([checkDatabase(), checkRedis()]);

  if (!dbStatus.ok) {
    logger.warn({ error: dbStatus.error }, 'Banco de dados nao respondeu no boot (continuando...');
  }

  if (!redisStatus.ok) {
    logger.warn({ error: redisStatus.error }, 'Redis nao respondeu no boot (continuando...');
  }

  const app = await buildServer();

  // Se o container rodar com ROLE=all, sobe também workers e cron
  let workerInstance: ReturnType<typeof startWorkers> | null = null;
  if (env.ROLE === 'all' || env.ROLE === 'worker') {
    await registerRepeatableJobs().catch((err) =>
      logger.warn({ err }, 'Nao foi possivel registrar repeatable jobs (Redis pode estar desligado)'),
    );
    workerInstance = startWorkers();
  }

  const port = env.API_PORT;
  const host = env.API_HOST;

  await app.listen({ port, host });
  logger.info({ url: `http://${host}:${port}` }, '🚀 Servidor CRM Central Pneus pronto');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Encerrando servidor...');
    if (workerInstance) await workerInstance.close();
    await app.close();
    await unsubscribeRealtime();
    await closeQueues();
    await disconnectDatabase();
    await disconnectRedis();
    logger.info('Servidor finalizado');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao iniciar servidor');
  process.exit(1);
});


/**
 * IP real do cliente.
 *
 * Atras do Cloudflare Tunnel, `request.ip` e sempre 127.0.0.1. O endereco de
 * verdade vem no cabecalho do proxy. So confiamos nele quando a conexao
 * chega mesmo do loopback - se aceitassemos de qualquer origem, qualquer um
 * forjaria o cabecalho e escaparia do limite.
 */
function clientIp(request: { ip: string; headers: Record<string, unknown> }): string {
  const doLoopback = request.ip === '127.0.0.1' || request.ip === '::1';
  if (!doLoopback) return request.ip;

  const cabecalho =
    (request.headers['cf-connecting-ip'] as string | undefined) ??
    (request.headers['x-forwarded-for'] as string | undefined);

  const primeiro = cabecalho?.split(',')[0]?.trim();
  return primeiro || request.ip;
}

# =============================================================================
# CRM Central Pneus - imagem unica (API + workers + painel)
#
# Uma imagem so porque o backend SERVE o painel: nao ha servidor web separado,
# nao ha CORS entre dominios e existe um unico endereco para publicar.
#
# A construcao e em estagios para a imagem final nao carregar compilador,
# codigo-fonte nem dependencia de desenvolvimento - menos peso e menos
# superficie de ataque.
# =============================================================================

# --- Estagio 1: dependencias -------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Apenas os manifestos primeiro: enquanto eles nao mudam, o Docker reaproveita
# a camada de instalacao e a construcao seguinte leva segundos em vez de
# minutos.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/

RUN npm ci --include=dev

# --- Estagio 2: construcao ---------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

# O cliente do Prisma e gerado a partir do schema e precisa existir antes de
# compilar a API, que importa os tipos dele.
RUN npx prisma generate --schema packages/api/prisma/schema.prisma

# Ordem obrigatoria: o painel e a API importam os tipos de @crm/shared.
RUN npm run build -w @crm/shared \
 && npm run build -w @crm/web \
 && npm run build -w @crm/api

# Reinstala sem as dependencias de desenvolvimento: o que vai para producao
# nao precisa de TypeScript, Vite nem Vitest.
RUN npm ci --omit=dev

# --- Estagio 3: execucao -----------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo

# `tini` como PID 1 repassa SIGTERM aos processos filhos. Sem ele, o
# encerramento gracioso do servidor nunca e acionado e o container morre no
# meio de um envio.
RUN apk add --no-cache tini

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/api/dist ./packages/api/dist
COPY --from=build /app/packages/api/package.json ./packages/api/
COPY --from=build /app/packages/api/prisma ./packages/api/prisma
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/package.json ./

# O painel compilado fica fora do pacote da API; a variavel aponta o caminho.
ENV WEB_DIST_PATH=/app/packages/web/dist

# Roda como usuario sem privilegio: se alguem escapar da aplicacao, nao cai
# como root dentro do container.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3333/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "packages/api/dist/server.js"]

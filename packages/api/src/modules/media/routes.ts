import type { FastifyPluginAsync } from 'fastify';
import '@fastify/multipart';
import { getMediaAsset, saveMediaAsset } from './service.js';
import { storage } from './storage.js';
import { disposicaoSegura } from './seguranca.js';
import { UnauthorizedError } from '../../lib/errors.js';

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Visualizacao e download de midia.
   *
   * EXIGE AUTENTICACAO. Antes esta rota era publica: qualquer pessoa com o id
   * baixava audio, foto ou documento de qualquer cliente. Id de banco nao e
   * senha - ele vaza em historico de navegador, em link compartilhado e no
   * cabecalho Referer.
   */
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>(
    '/media/:id',
    async (req, reply) => {
      // Duas formas de provar acesso: a sessao (chamadas da API) ou a
      // assinatura (tags <img>, <audio> e <video>, que nao mandam cabecalho).
      const orgId = req.user?.orgId ?? req.mediaOrgId;
      if (!orgId) throw new UnauthorizedError('Acesso a midia nao autorizado');

      const asset = await getMediaAsset(req.params.id, orgId);

    // O tipo ja foi validado no upload, mas reafirmamos os cabecalhos aqui:
    // `nosniff` impede o navegador de adivinhar um tipo diferente do
    // declarado, e a disposicao manda baixar o que nao for seguro exibir.
    reply.header('Content-Type', asset.mimeType);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Content-Disposition', disposicaoSegura(asset.mimeType, asset.fileName));
    // Cache privado: e conteudo de um cliente, nao pode ficar em proxy
    // compartilhado.
    reply.header('Cache-Control', 'private, max-age=86400');

      return reply.send(storage.read(asset.storageKey));
    },
  );

  // Rota de upload de arquivos (requer autenticação)
  app.post('/uploads', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: { message: 'Formato esperado: multipart/form-data' } });
    }

    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: { message: 'Nenhum arquivo enviado' } });
    }

    const asset = await saveMediaAsset({
      orgId: req.user.orgId,
      stream: data.file,
      mimeType: data.mimetype,
      fileName: data.filename,
    });

    return reply.code(201).send({
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      url: `/media/${asset.id}`,
    });
  });
};

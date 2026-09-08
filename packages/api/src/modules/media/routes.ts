import type { FastifyPluginAsync } from 'fastify';
import '@fastify/multipart';
import { getMediaAsset, saveMediaAsset } from './service.js';
import { storage } from './storage.js';

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  // Rota de visualização/download de mídia
  app.get<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
    const asset = await getMediaAsset(req.params.id);

    reply.header('Content-Type', asset.mimeType);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    if (asset.fileName) {
      reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(asset.fileName)}"`);
    }

    const stream = storage.read(asset.storageKey);
    return reply.send(stream);
  });

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

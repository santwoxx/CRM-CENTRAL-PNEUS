import { ChannelType } from '@crm/shared';
import { prisma } from '../db/prisma.js';

/**
 * Apaga as conversas criadas pelo simulador.
 *
 *     npm run limpar-simulador
 *
 * POR QUE ISTO E UM SCRIPT SEPARADO E NAO UM "APAGAR TUDO"
 *
 * O criterio e o CANAL: so mexe no canal interno (WEBCHAT), usado pelo
 * simulador e pelo widget do site. Conversa de WhatsApp - oficial ou de
 * contingencia - nunca e tocada, nem por engano, nem se alguem rodar isso
 * com o sistema em producao.
 *
 * Contatos: removidos apenas quando existiam SO no simulador. Quem tambem
 * conversou pelo WhatsApp fica, porque o cadastro e o historico dele sao
 * reais.
 */

async function main() {
  const canais = await prisma.channel.findMany({
    where: { type: ChannelType.WEBCHAT },
    select: { id: true, name: true },
  });

  if (canais.length === 0) {
    console.log('\nNenhum canal de simulacao encontrado. Nada a fazer.\n');
    await prisma.$disconnect();
    return;
  }

  const canalIds = canais.map((c) => c.id);

  const conversas = await prisma.conversation.count({ where: { channelId: { in: canalIds } } });
  const mensagens = await prisma.message.count({ where: { channelId: { in: canalIds } } });

  if (conversas === 0) {
    console.log('\nNenhuma conversa de simulacao. Nada a fazer.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`\nEncontrado no canal de simulacao:`);
  console.log(`  ${conversas} conversa(s)`);
  console.log(`  ${mensagens} mensagem(ns)`);

  // Contatos que aparecem no simulador...
  const identidades = await prisma.contactIdentity.findMany({
    where: { channelId: { in: canalIds } },
    select: { contactId: true },
  });
  const contatoIds = [...new Set(identidades.map((i) => i.contactId))];

  // ...e que NAO existem em nenhum outro canal.
  const somenteSimulador: string[] = [];
  for (const contatoId of contatoIds) {
    const outras = await prisma.contactIdentity.count({
      where: { contactId: contatoId, channelId: { notIn: canalIds } },
    });
    const conversasReais = await prisma.conversation.count({
      where: { contactId: contatoId, channelId: { notIn: canalIds } },
    });
    if (outras === 0 && conversasReais === 0) somenteSimulador.push(contatoId);
  }

  console.log(`  ${somenteSimulador.length} contato(s) que so existem no simulador`);

  // As mensagens e eventos saem em cascata com a conversa.
  const conversasRemovidas = await prisma.conversation.deleteMany({
    where: { channelId: { in: canalIds } },
  });

  const contatosRemovidos = somenteSimulador.length
    ? await prisma.contact.deleteMany({ where: { id: { in: somenteSimulador } } })
    : { count: 0 };

  console.log(`\nRemovido:`);
  console.log(`  ${conversasRemovidas.count} conversa(s)`);
  console.log(`  ${contatosRemovidos.count} contato(s)`);
  console.log(`\nCanais de WhatsApp nao foram tocados.\n`);

  await prisma.$disconnect();
}

main().catch(async (erro) => {
  console.error('Falha ao limpar:', erro);
  await prisma.$disconnect();
  process.exit(1);
});

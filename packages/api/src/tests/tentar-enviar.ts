import { prisma } from '../db/prisma.js';
import { createOutboundMessage } from '../modules/messages/outbox.js';
import { MessageSenderType } from '@crm/shared';

const c = await prisma.conversation.findFirst({
  where: { contact: { phone: { contains: '31900008888' } } },
  orderBy: { createdAt: 'desc' },
  select: { id: true, contact: { select: { optedOutAt: true } } },
});

if (!c) {
  console.log('conversa nao encontrada');
} else {
  console.log('   descadastrado em:', c.contact.optedOutAt?.toISOString() ?? 'NAO');
  try {
    await createOutboundMessage({
      conversationId: c.id,
      content: 'promoção de pneus imperdível!',
      senderType: MessageSenderType.AGENT,
    });
    console.log('   FALHA DE SEGURANCA: a mensagem foi aceita');
  } catch (e: any) {
    console.log('   RECUSADO:', e?.code, '-', e?.message?.slice(0, 70));
  }
}
await prisma.$disconnect();

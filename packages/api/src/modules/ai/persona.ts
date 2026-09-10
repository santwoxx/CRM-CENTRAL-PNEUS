import { prisma } from '../../db/prisma.js';
import { env } from '../../env.js';
import { describeActiveProvider } from './provider.js';

/**
 * Persona da IA para a Central Pneus.
 *
 * Responsável por receber o lead, ser cordial, coletar as informações essenciais
 * (modelo do carro, medida do pneu ou serviço desejado) e preparar o lead aquecido
 * para a equipe de vendas e oficina.
 */

/**
 * Prompt do atendente.
 *
 * REGRA AO EDITAR ESTE TEXTO: nada de frases prontas entre aspas.
 *
 * Modelos pequenos - os que rodam de graca na maquina da loja - COPIAM
 * exemplos literais em vez de se inspirar neles. Uma frase de exemplo que
 * estava aqui ("da pra tirar uma foto da lateral do pneu?") passou a ser
 * respondida ao cliente mesmo quando ele acabara de informar a medida, o que
 * deixava a conversa sem pe nem cabeca. Descreva o COMPORTAMENTO esperado;
 * deixe as palavras por conta do modelo.
 */
export const DEFAULT_CENTRAL_PNEUS_PROMPT = `Você é atendente da Central Pneus e conversa pelo WhatsApp.

Fale como um vendedor de loja de pneus fala: direto, gentil, sem formalidade.

## Formato
- No máximo 2 frases curtas por mensagem. Nunca mais que 3.
- UMA pergunta por mensagem.
- Sem listas nem passo a passo, exceto para mostrar preços.
- Sem saudação nem despedida em toda mensagem. É conversa, não e-mail.

## Antes de responder
Leia a última mensagem do cliente e responda ao que ELE escreveu.
Se ele mandou números, trate-os como tentativa de informar a medida — nunca ignore.
Nunca responda como se ele não tivesse dito nada.

## Nunca
- Nunca complete uma medida que o cliente não informou por inteiro.
- Nunca cite preço, marca, estoque ou prazo que não esteja em DADOS REAIS DA LOJA.
- Nunca insista no modelo do carro. Se ele não lembra, siga sem isso.
- Nunca repita pergunta já respondida.
- Nunca use frases de preenchimento sobre aguardar informações para poder prosseguir.

## Quando faltar dado
Peça só o que falta, em uma frase, dizendo onde ele acha isso no próprio pneu.
Se ele não souber, ofereça que mande a foto da lateral do pneu.

## Quando tiver preço
No máximo 2 opções com valor. Sem tabela.

## Quando encerrar
Se já tem a medida, ou o cliente demonstrou interesse claro, ou pediu uma pessoa:
avise em uma frase que vai chamar um consultor e pare de perguntar.

Pergunte-se: qual o jeito mais simples de ajudar essa pessoa a avançar?`;

/**
 * O minimo para um vendedor assumir com contexto.
 *
 * Curto de proposito: cada item a mais e uma pergunta a mais antes de o
 * cliente falar com gente, e quem procura pneu no WhatsApp nao espera.
 * O modelo do veiculo saiu da lista - e a informacao que mais trava a
 * conversa e a que o vendedor descobre em dez segundos.
 */
export const DEFAULT_QUALIFICATION_GOALS = [
  'Sabe se o cliente quer pneu, serviço de oficina ou financeiro',
  'Tem a medida do pneu (ou o aro, quando for serviço)',
];

export async function getActivePersona(orgId: string) {
  const persona = await prisma.aiPersona.findFirst({
    where: { orgId, isActive: true },
    orderBy: { isDefault: 'desc' },
  });

  if (persona) return persona;

  // Fallback padrão se não houver no banco
  const active = describeActiveProvider();

  return {
    id: 'default',
    orgId,
    name: 'Atendente Virtual Central Pneus',
    systemPrompt: DEFAULT_CENTRAL_PNEUS_PROMPT,
    greeting: 'Olá! Seja bem-vindo(a) à Central Pneus. Como podemos ajudar seu veículo hoje?',
    // Segue o provedor ativo no .env, seja ele local (ollama) ou de nuvem.
    provider: active.provider,
    model: active.chatModel,
    temperature: env.AI_TEMPERATURE,
    maxTokens: env.AI_MAX_OUTPUT_TOKENS,
    maxTurnsBeforeHandoff: env.AI_MAX_TURNS_BEFORE_HANDOFF,
    qualificationGoals: DEFAULT_QUALIFICATION_GOALS,
    isActive: true,
    isDefault: true,
  };
}

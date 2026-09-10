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
 * estava aqui passou a ser respondida ao cliente mesmo quando ele acabara de
 * informar a medida, deixando a conversa sem pe nem cabeca. Descreva o
 * COMPORTAMENTO esperado; deixe as palavras por conta do modelo.
 *
 * Este texto tambem e editavel pelo painel, em Inteligencia Artificial. O que
 * esta aqui e o padrao aplicado por `npm run db:seed`.
 */
export const DEFAULT_CENTRAL_PNEUS_PROMPT = `Você é vendedor da Central Pneus e atende pelo WhatsApp.

Você VENDE. Não preenche formulário. Cada resposta sua deve deixar o cliente
mais perto de fechar, não mais perto de desistir.

## Formato
- No máximo 2 frases curtas. Nunca mais que 3.
- UMA pergunta por mensagem.
- Sem listas nem passo a passo, exceto para mostrar preços.
- Sem saudação nem despedida em toda mensagem.

## Como vender
- Ao dar preço, diga por que vale: pronta entrega, garantia, promoção, montagem na hora.
- Sempre termine com um próximo passo concreto, não com uma pergunta vaga.
- Trate pneu como segurança da família dele, sem dramatizar.
- Se houver promoção nos dados da loja, cite. É o argumento mais forte que você tem.

## Antes de responder
Leia a última mensagem e responda ao que ELE escreveu.
Se ele mandou números, são tentativa de informar a medida — nunca ignore.

## Nunca
- Nunca peça foto. Você não consegue ver imagem.
- Nunca complete uma medida que ele não informou por inteiro.
- Nunca cite preço, marca, estoque ou prazo fora de DADOS REAIS DA LOJA.
- Nunca insista no modelo do carro.
- Nunca repita pergunta já respondida.
- Nunca fale em aguardar informações para poder prosseguir.

## Se ele não souber a medida
Não insista e não fique dando instrução. Diga em uma frase que um consultor
identifica isso rapidinho e que você já vai chamar. Encerre por aí.

## Quando tiver preço
No máximo 2 opções com valor, e diga qual você recomenda e por quê.

## Quando encerrar
Se já tem a medida, ou ele demonstrou interesse, ou pediu uma pessoa:
avise em uma frase que vai chamar um consultor e pare de perguntar.

Pergunte-se: o que faz essa pessoa avançar agora?`;

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

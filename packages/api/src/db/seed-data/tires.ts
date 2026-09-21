import { TireCategory } from '@prisma/client';

/**
 * Catálogo inicial de pneus.
 *
 * É desta tabela que a IA tira TODO preço que informa ao cliente. Sem
 * catálogo, ela é instruída a não citar valores e transferir para o vendedor.
 *
 * Preços em CENTAVOS: dinheiro nunca em ponto flutuante.
 * Substitua por dados reais da sua loja antes de colocar em produção.
 */
export interface SeedTire {
  brand: string;
  model: string;
  sizeKey: string;
  width: number;
  aspectRatio: number;
  rim: number;
  loadIndex: number;
  speedRating: string;
  category: TireCategory;
  priceCents: number;
  promoPriceCents?: number;
  stockQuantity: number;
  warrantyMonths: number;
}

export const SEED_TIRES: SeedTire[] = [
  // --- Aro 13: populares de entrada ---
  { brand: 'Pirelli', model: 'Formula Energy', sizeKey: '175/70R13', width: 175, aspectRatio: 70, rim: 13, loadIndex: 82, speedRating: 'T', category: TireCategory.PASSEIO, priceCents: 27900, stockQuantity: 16, warrantyMonths: 60 },
  { brand: 'Goodyear', model: 'Kelly Edge Touring', sizeKey: '175/70R13', width: 175, aspectRatio: 70, rim: 13, loadIndex: 82, speedRating: 'T', category: TireCategory.PASSEIO, priceCents: 25900, promoPriceCents: 23900, stockQuantity: 8, warrantyMonths: 60 },

  // --- Aro 14 ---
  { brand: 'Michelin', model: 'Energy XM2', sizeKey: '185/65R14', width: 185, aspectRatio: 65, rim: 14, loadIndex: 86, speedRating: 'H', category: TireCategory.PASSEIO, priceCents: 39900, stockQuantity: 12, warrantyMonths: 60 },
  { brand: 'Firestone', model: 'F-600', sizeKey: '185/65R14', width: 185, aspectRatio: 65, rim: 14, loadIndex: 86, speedRating: 'T', category: TireCategory.PASSEIO, priceCents: 31900, stockQuantity: 20, warrantyMonths: 60 },

  // --- Aro 15: a medida mais vendida no Brasil ---
  { brand: 'Pirelli', model: 'Cinturato P1', sizeKey: '195/65R15', width: 195, aspectRatio: 65, rim: 15, loadIndex: 91, speedRating: 'H', category: TireCategory.PASSEIO, priceCents: 45900, promoPriceCents: 41900, stockQuantity: 24, warrantyMonths: 60 },
  { brand: 'Bridgestone', model: 'Turanza T005', sizeKey: '195/65R15', width: 195, aspectRatio: 65, rim: 15, loadIndex: 91, speedRating: 'H', category: TireCategory.PASSEIO, priceCents: 52900, stockQuantity: 10, warrantyMonths: 60 },
  { brand: 'Continental', model: 'PowerContact 2', sizeKey: '195/55R15', width: 195, aspectRatio: 55, rim: 15, loadIndex: 85, speedRating: 'V', category: TireCategory.PASSEIO, priceCents: 48900, stockQuantity: 6, warrantyMonths: 60 },

  // --- Aro 16 ---
  { brand: 'Pirelli', model: 'Cinturato P7', sizeKey: '205/55R16', width: 205, aspectRatio: 55, rim: 16, loadIndex: 91, speedRating: 'V', category: TireCategory.PASSEIO, priceCents: 62900, promoPriceCents: 57900, stockQuantity: 18, warrantyMonths: 60 },
  { brand: 'Michelin', model: 'Primacy 4', sizeKey: '205/55R16', width: 205, aspectRatio: 55, rim: 16, loadIndex: 91, speedRating: 'V', category: TireCategory.PASSEIO, priceCents: 74900, stockQuantity: 9, warrantyMonths: 60 },
  // Estoque zerado de proposito: exercita o caminho "sem estoque, ofereca alternativa".
  { brand: 'Goodyear', model: 'EfficientGrip Performance', sizeKey: '205/55R16', width: 205, aspectRatio: 55, rim: 16, loadIndex: 91, speedRating: 'V', category: TireCategory.PASSEIO, priceCents: 59900, stockQuantity: 0, warrantyMonths: 60 },
  { brand: 'Bridgestone', model: 'Dueler H/T', sizeKey: '215/65R16', width: 215, aspectRatio: 65, rim: 16, loadIndex: 98, speedRating: 'H', category: TireCategory.SUV, priceCents: 78900, stockQuantity: 14, warrantyMonths: 60 },

  // --- Aro 17 e 18: SUV e esportivo ---
  { brand: 'Pirelli', model: 'Scorpion HT', sizeKey: '225/65R17', width: 225, aspectRatio: 65, rim: 17, loadIndex: 102, speedRating: 'H', category: TireCategory.SUV, priceCents: 89900, stockQuantity: 11, warrantyMonths: 60 },
  { brand: 'Michelin', model: 'Pilot Sport 4', sizeKey: '225/45R17', width: 225, aspectRatio: 45, rim: 17, loadIndex: 94, speedRating: 'Y', category: TireCategory.PASSEIO, priceCents: 98900, stockQuantity: 4, warrantyMonths: 60 },
  { brand: 'Continental', model: 'CrossContact LX2', sizeKey: '235/60R18', width: 235, aspectRatio: 60, rim: 18, loadIndex: 107, speedRating: 'V', category: TireCategory.SUV, priceCents: 119900, stockQuantity: 6, warrantyMonths: 60 },

  // --- Caminhonete e carga ---
  { brand: 'Goodyear', model: 'Wrangler Armortrac', sizeKey: '265/65R17', width: 265, aspectRatio: 65, rim: 17, loadIndex: 112, speedRating: 'S', category: TireCategory.CAMINHONETE, priceCents: 134900, stockQuantity: 8, warrantyMonths: 60 },
  { brand: 'Pirelli', model: 'FR01', sizeKey: '275/80R22.5', width: 275, aspectRatio: 80, rim: 22.5, loadIndex: 149, speedRating: 'M', category: TireCategory.CARGA, priceCents: 289900, stockQuantity: 12, warrantyMonths: 24 },
];

export interface SeedService {
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  durationMinutes: number;
}

export const SEED_SERVICES: SeedService[] = [
  { slug: 'alinhamento-3d', name: 'Alinhamento computadorizado 3D', description: 'Alinhamento de direção com equipamento 3D de alta precisão', priceCents: 9900, durationMinutes: 40 },
  { slug: 'balanceamento', name: 'Balanceamento (4 rodas)', description: 'Balanceamento eletrônico das quatro rodas', priceCents: 8000, durationMinutes: 30 },
  { slug: 'alinhamento-balanceamento', name: 'Combo alinhamento + balanceamento', description: 'Pacote completo com revisão visual da suspensão', priceCents: 15900, durationMinutes: 60 },
  { slug: 'cambagem', name: 'Cambagem', description: 'Ajuste de cambagem por roda', priceCents: 12000, durationMinutes: 45 },
  { slug: 'troca-oleo', name: 'Troca de óleo e filtro', description: 'Óleo sintético 5W30 mais filtro de óleo', priceCents: 24900, durationMinutes: 30 },
  { slug: 'montagem-pneu', name: 'Montagem de pneu (por unidade)', description: 'Desmontagem, montagem e calibragem', priceCents: 2500, durationMinutes: 15 },
  { slug: 'revisao-freios', name: 'Revisão de freios', description: 'Inspeção de pastilhas, discos e fluido', priceCents: 8900, durationMinutes: 45 },
];

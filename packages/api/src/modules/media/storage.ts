import { existsSync, mkdirSync, createReadStream, createWriteStream } from 'node:fs';
import { sep } from 'node:path';
import { AppError } from '../../lib/errors.js';
import { stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { env } from '../../env.js';
import { logger } from '../../lib/logger.js';

export interface StorageDriver {
  write(key: string, stream: Readable): Promise<{ size: number }>;
  read(key: string): NodeJS.ReadableStream;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

class LocalStorageDriver implements StorageDriver {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = resolve(process.cwd(), basePath);
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Resolve a chave para um caminho absoluto, recusando qualquer coisa que
   * escape da pasta de armazenamento.
   *
   * O nome do arquivo enviado pelo cliente entra na composicao da chave. Sem
   * esta checagem, um upload chamado "../../../../etc/cron.d/x" escreveria
   * fora do storage - execucao remota em alguns cenarios. `resolve` normaliza
   * o ".." e a comparacao com a raiz derruba o que sair dela.
   */
  private getPath(key: string): string {
    const target = resolve(this.basePath, key);
    const root = resolve(this.basePath);

    if (target !== root && !target.startsWith(root + sep)) {
      throw new AppError('Caminho de arquivo invalido', {
        statusCode: 400,
        code: 'INVALID_STORAGE_KEY',
      });
    }

    return target;
  }

  async write(key: string, stream: Readable): Promise<{ size: number }> {
    const target = this.getPath(key);
    const dir = resolve(target, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const out = createWriteStream(target);
    await pipeline(stream, out);
    const s = await stat(target);
    return { size: s.size };
  }

  read(key: string): NodeJS.ReadableStream {
    return createReadStream(this.getPath(key));
  }

  async delete(key: string): Promise<void> {
    const target = this.getPath(key);
    if (existsSync(target)) {
      await unlink(target);
    }
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.getPath(key));
  }
}

export const storage: StorageDriver = new LocalStorageDriver(env.STORAGE_LOCAL_PATH);

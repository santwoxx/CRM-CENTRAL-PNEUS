import { existsSync, mkdirSync, createReadStream, createWriteStream } from 'node:fs';
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

  private getPath(key: string): string {
    return join(this.basePath, key);
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

import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/** Reads administrator-configurable settings with a short in-process cache. */
@Injectable()
export class SettingsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 15_000;

  constructor(private readonly db: DbService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
    const row = await this.db.client.systemSetting.findUnique({ where: { key } });
    const value = row ? (row.value as T) : fallback;
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}

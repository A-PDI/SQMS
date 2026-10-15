import { Inject, Injectable } from "@nestjs/common";
import type IORedis from "ioredis";
import { REDIS } from "../../infra/tokens";

/** Fixed-window counter in Redis (shared across API instances). */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  /** Returns true when the action is allowed (count within limit for the window). */
  async hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const k = `ratelimit:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count <= limit;
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`ratelimit:${key}`);
  }
}

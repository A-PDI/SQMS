import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { ObjectStorage } from "@sqms/server-core";
import type IORedis from "ioredis";
import { Public } from "../../common/auth/decorators";
import { DbService } from "../../common/db/db.service";
import { REDIS, STORAGE } from "../../infra/tokens";

@ApiTags("health")
@Controller("health")
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly db: DbService,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness probe" })
  live() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe (database, Redis, object storage)" })
  async ready() {
    const checks: Record<string, boolean> = {};
    checks.database = await this.db.client.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    checks.redis = await this.redis.ping().then((r) => r === "PONG").catch(() => false);
    checks.storage = await this.storage.ping().then(() => true).catch(() => false);
    if (Object.values(checks).some((ok) => !ok)) throw new ServiceUnavailableException({ status: "unavailable", checks });
    return { status: "ready", checks };
  }
}

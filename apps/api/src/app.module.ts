import { DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { AppEnv } from "@sqms/server-core";
import { CommonModule } from "./common/common.module";
import { CsrfGuard, PermissionsGuard, SessionGuard } from "./common/auth/guards";
import { InfraModule } from "./infra/infra.module";
import { FEATURE_MODULES } from "./modules";

@Module({})
export class AppModule {
  static forRoot(env: AppEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule.forRoot(env),
        CommonModule,
        // Per-instance general API rate limit (login uses a Redis-backed limiter shared across instances).
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: env.API_RATE_LIMIT_PER_MINUTE }]),
        ...FEATURE_MODULES,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    };
  }
}

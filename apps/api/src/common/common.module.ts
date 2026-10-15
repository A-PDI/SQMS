import { Global, Module } from "@nestjs/common";
import { ActivityService } from "./audit/activity.service";
import { AuditService } from "./audit/audit.service";
import { RateLimiter } from "./auth/rate-limiter";
import { SessionService } from "./auth/session.service";
import { DbService } from "./db/db.service";
import { NotificationService } from "./services/notification.service";
import { NumberingService } from "./services/numbering.service";
import { OutboxService } from "./services/outbox.service";
import { SettingsService } from "./services/settings.service";

const providers = [DbService, AuditService, ActivityService, SessionService, RateLimiter, NumberingService, SettingsService, OutboxService, NotificationService];

@Global()
@Module({ providers, exports: providers })
export class CommonModule {}

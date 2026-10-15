import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { createPrismaClient, type PrismaClient } from "@sqms/db";
import { createRedisConnection, ObjectStorage, QueueRegistry, type AppEnv } from "@sqms/server-core";
import type IORedis from "ioredis";
import { APP_ENV, PRISMA, QUEUES, REDIS, STORAGE } from "./tokens";

/** Global infrastructure providers: configuration, database, Redis, object storage and job queues. */
@Global()
@Module({})
export class InfraModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("Infra");

  static forRoot(env: AppEnv) {
    return {
      module: InfraModule,
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: PRISMA, useFactory: () => createPrismaClient(env.DATABASE_URL, { connectionLimit: env.DATABASE_CONNECTION_LIMIT }) },
        { provide: REDIS, useFactory: () => createRedisConnection(env.REDIS_URL) },
        {
          provide: STORAGE,
          useFactory: () =>
            new ObjectStorage({
              endpoint: env.S3_ENDPOINT,
              region: env.S3_REGION,
              bucket: env.S3_BUCKET,
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
              forcePathStyle: env.S3_FORCE_PATH_STYLE,
            }),
        },
        { provide: QUEUES, useFactory: (redis: IORedis) => new QueueRegistry(redis), inject: [REDIS] },
      ],
      exports: [APP_ENV, PRISMA, REDIS, STORAGE, QUEUES],
    };
  }

  constructor(
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(QUEUES) private readonly queues: QueueRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    await this.storage.ensureBucket(this.env.S3_AUTO_CREATE_BUCKET);
    this.logger.log(`Connected to database and object storage bucket "${this.env.S3_BUCKET}"`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queues.close().catch(() => undefined);
    await this.prisma.$disconnect().catch(() => undefined);
    this.redis.disconnect();
  }
}

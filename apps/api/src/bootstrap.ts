import { ConsoleLogger, type LogLevel, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { AppEnv } from "@sqms/server-core";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { requestContextMiddleware } from "./common/context/request-context";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter";

const LEVELS: LogLevel[] = ["error", "warn", "log", "debug", "verbose"];

export function buildOpenApiConfig(env: AppEnv) {
  return new DocumentBuilder()
    .setTitle("SQMS API")
    .setDescription("Supplier Quality Management System REST API (v1). Cookie session authentication; unsafe methods require the X-CSRF-Token header.")
    .setVersion("1.0")
    .addCookieAuth(env.SESSION_COOKIE_NAME)
    .addApiKey({ type: "apiKey", in: "header", name: "X-CSRF-Token" }, "csrf")
    .build();
}

export async function createApp(env: AppEnv): Promise<NestExpressApplication> {
  const logger = new ConsoleLogger({ json: env.LOG_JSON, logLevels: LEVELS.slice(0, LEVELS.indexOf(env.LOG_LEVEL) + 1) });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), { logger, bodyParser: false });
  app.set("trust proxy", env.TRUST_PROXY ? 1 : false);
  app.disable("x-powered-by");
  app.useBodyParser("json", { limit: "2mb" });
  app.useBodyParser("urlencoded", { limit: "256kb", extended: false });

  const strictHelmet = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'self'"] } }, crossOriginResourcePolicy: { policy: "same-origin" } });
  const docsHelmet = helmet({ contentSecurityPolicy: false });
  app.use((req: Request, res: Response, next: NextFunction) => (req.path.startsWith("/api/docs") ? docsHelmet(req, res, next) : strictHelmet(req, res, next)));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (/^\/api\/(?:attachments|drawings)\//.test(req.url)) req.url = "/api/v1/qms" + req.url.slice(4);
    next();
  });
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter(env.NODE_ENV !== "production"));
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const document = SwaggerModule.createDocument(app, buildOpenApiConfig(env));
    SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "api/docs-json" });
  }
  return app;
}

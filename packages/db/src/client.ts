import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client";

export interface CreatePrismaClientOptions {
  /** Maximum pool size (defaults to the `connection_limit` URL parameter or 10). */
  connectionLimit?: number;
  /** Log queries (development diagnostics only). */
  logQueries?: boolean;
}

/**
 * Parses a mysql:// connection URL into mariadb driver pool settings.
 * Supported query parameters: connection_limit, ssl ("true" | "false"), ssl_reject_unauthorized ("true" | "false").
 */
export function parseDatabaseUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "mysql:" && parsed.protocol !== "mariadb:") {
    throw new Error("DATABASE_URL must use the mysql:// scheme");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name");
  const params = parsed.searchParams;
  const ssl = params.get("ssl") === "true" ? { rejectUnauthorized: params.get("ssl_reject_unauthorized") !== "false" } : undefined;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    connectionLimit: params.get("connection_limit") ? Number(params.get("connection_limit")) : undefined,
    ssl,
  };
}

export function createPrismaClient(databaseUrl: string, options: CreatePrismaClientOptions = {}): PrismaClient {
  const cfg = parseDatabaseUrl(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectionLimit: options.connectionLimit ?? cfg.connectionLimit ?? 10,
    // MySQL 8 caching_sha2_password over non-TLS connections needs the server RSA key; use TLS in production.
    allowPublicKeyRetrieval: !cfg.ssl,
    ssl: cfg.ssl,
    timezone: "Z",
  });
  return new PrismaClient({ adapter, log: options.logQueries ? ["query", "warn", "error"] : ["warn", "error"] });
}

/**
 * Environment configuration shared by the API and worker. Validated at startup; the process refuses to start
 * with an unsafe production configuration.
 */
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? def : v === "true" || v === "1"));

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    /** Public origin(s) of the web application, e.g. https://sqms.example.com (comma separated). */
    APP_ORIGINS: csv,
    /** Base URL used in emails, e.g. https://sqms.example.com */
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    TRUST_PROXY: bool(false),
    DATABASE_URL: z.string().min(1),
    DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
    REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),

    SESSION_COOKIE_NAME: z.string().default("sqms_session"),
    CSRF_COOKIE_NAME: z.string().default("sqms_csrf"),
    /** Secret used to derive CSRF tokens (min 32 chars). */
    CSRF_SECRET: z.string().min(32),
    COOKIE_SECURE: bool(true),
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(480),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(72),
    LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
    LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
    /** Live bench reads remain disabled during this project. Test-safe mode rejects the operational endpoint. */
    CARBONZAPP_MODE: z.enum(["disabled", "recorded", "test-safe", "live"]).default("disabled"),
    CARBONZAPP_TEST_URL: z.string().url().optional(),
    CARBONZAPP_API_KEY: z.string().optional(),
    CARBONZAPP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(30000),
    INJECTOR_SHEET_MODE: z.enum(["disabled", "test-sink", "google"]).default("disabled"),
    INJECTOR_SHEET_TIMEZONE: z.string().default("America/Denver").refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Use an IANA time zone"),
    INJECTOR_SHEET_DAILY_TIME: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("00:05"),
    GOOGLE_SHEET_ID: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
    GOOGLE_SHEET_TAB: z.string().max(100).default("Sheet1"),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),

    /** Phase 1 hard gate: external (supplier) logins and portal APIs are disabled unless explicitly enabled. */
    SUPPLIER_PORTAL_ENABLED: bool(false),
    /** MFA provider for external users. "none" is rejected in production when the portal is enabled. */
    EXTERNAL_MFA_PROVIDER: z.enum(["none"]).default("none"),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool(true),
    /** Create the bucket on startup if missing (development convenience; production buckets are provisioned by infra). */
    S3_AUTO_CREATE_BUCKET: bool(false),

    /** "clamav" (required in production) or "eicar-test" (deterministic test scanner, test environment only). */
    SCANNER_MODE: z.enum(["clamav", "eicar-test"]).default("clamav"),
    CLAMAV_HOST: z.string().default("127.0.0.1"),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

    MAIL_TRANSPORT: z.enum(["smtp", "disabled"]).default("smtp"),
    SMTP_HOST: z.string().default("127.0.0.1"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_SECURE: bool(false),
    SMTP_REQUIRE_TLS: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    MAIL_FROM: z.string().default("SQMS <no-reply@sqms.local>"),

    LOG_LEVEL: z.enum(["error", "warn", "log", "debug", "verbose"]).default("log"),
    LOG_JSON: bool(false),
    SWAGGER_ENABLED: bool(true),
  })
  .superRefine((env, ctx) => {
    if (env.INJECTOR_SHEET_MODE === "google" && (env.NODE_ENV !== "production" || !env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)) ctx.addIssue({ code: "custom", path: ["INJECTOR_SHEET_MODE"], message: "Google delivery requires an explicitly configured production service account and spreadsheet; development/test use test-sink" });
    if (env.CARBONZAPP_MODE === "live" && env.NODE_ENV !== "production") ctx.addIssue({ code: "custom", path: ["CARBONZAPP_MODE"], message: "Live CarbonZapp access is not permitted in development/test" });
    if (env.CARBONZAPP_MODE === "test-safe" && (!env.CARBONZAPP_TEST_URL || new URL(env.CARBONZAPP_TEST_URL).hostname === "cloudx.carbonzapp.com")) ctx.addIssue({ code: "custom", path: ["CARBONZAPP_TEST_URL"], message: "Test-safe mode requires a separately configured non-operational recording endpoint" });
    if (env.NODE_ENV === "production") {
      if (!env.COOKIE_SECURE) ctx.addIssue({ code: "custom", path: ["COOKIE_SECURE"], message: "COOKIE_SECURE must be true in production" });
      if (env.SCANNER_MODE !== "clamav") ctx.addIssue({ code: "custom", path: ["SCANNER_MODE"], message: "SCANNER_MODE must be clamav in production" });
      if (env.APP_ORIGINS.length === 0) ctx.addIssue({ code: "custom", path: ["APP_ORIGINS"], message: "APP_ORIGINS is required in production" });
      if (env.SUPPLIER_PORTAL_ENABLED && env.EXTERNAL_MFA_PROVIDER === "none") {
        ctx.addIssue({ code: "custom", path: ["SUPPLIER_PORTAL_ENABLED"], message: "External supplier access requires an MFA provider before production rollout" });
      }
      if (env.S3_AUTO_CREATE_BUCKET) ctx.addIssue({ code: "custom", path: ["S3_AUTO_CREATE_BUCKET"], message: "Buckets must be provisioned by infrastructure in production" });
    }
    if (env.SCANNER_MODE === "eicar-test" && env.NODE_ENV !== "test") {
      ctx.addIssue({ code: "custom", path: ["SCANNER_MODE"], message: "The eicar-test scanner is only permitted when NODE_ENV=test" });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export class ConfigError extends Error {}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ConfigError(`Invalid configuration: ${details}`);
  }
  return result.data;
}

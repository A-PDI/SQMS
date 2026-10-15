/**
 * CLI: node dist/seed/run.js reference
 * Environment: DATABASE_URL (required), SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME (optional),
 * SEED_INTERNAL_ORG_NAME (optional).
 * Demo data is seeded by the API package (`pnpm --filter @sqms/api run seed:demo`) through the service layer.
 */
import { createPrismaClient } from "../client";
import { seedReferenceData } from "./reference";

async function main() {
  const mode = process.argv[2] ?? "reference";
  if (mode !== "reference") {
    throw new Error(`Unknown seed mode "${mode}". Use "reference" (demo data: pnpm --filter @sqms/api run seed:demo).`);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const prisma = createPrismaClient(url, { connectionLimit: 2 });
  try {
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if ((adminEmail && !adminPassword) || (!adminEmail && adminPassword)) {
      throw new Error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be provided together");
    }
    await seedReferenceData(prisma, {
      internalOrganizationName: process.env.SEED_INTERNAL_ORG_NAME,
      admin: adminEmail && adminPassword ? { email: adminEmail, password: adminPassword, displayName: process.env.SEED_ADMIN_NAME } : undefined,
      log: (m) => console.log(`[seed] ${m}`),
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/** Writes the OpenAPI document to a file (default: openapi.json) without starting the HTTP listener. */
import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SwaggerModule } from "@nestjs/swagger";
import { loadEnv } from "@sqms/server-core";
import { buildOpenApiConfig, createApp } from "./bootstrap";

async function main() {
  const env = loadEnv();
  const app = await createApp({ ...env, LOG_LEVEL: "error" });
  try {
    const doc = SwaggerModule.createDocument(app, buildOpenApiConfig(env));
    const out = resolve(process.argv[2] ?? "openapi.json");
    writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`OpenAPI document with ${Object.keys(doc.paths).length} paths written to ${out}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export default async function globalTeardown(): Promise<void> {
  const pidFile = path.resolve(__dirname, "../.worker-test.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already exited */
  }
  rmSync(pidFile, { force: true });
}

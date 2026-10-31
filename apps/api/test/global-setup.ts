import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

/** Creates (once) and migrates the integration-test database. Never touches the dev database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://personalos:personalos_dev@127.0.0.1:55433/personalos_test?schema=public";

export default async function setup() {
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL.replace("/personalos_test", "/personalos") });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'personalos_test'");
  if (exists.rowCount === 0) await admin.query("CREATE DATABASE personalos_test");
  await admin.end();

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}

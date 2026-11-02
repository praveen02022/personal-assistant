import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

/** Creates (once) and migrates the integration-test database. Never touches the dev database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://personalos:personalos_dev@127.0.0.1:55433/personalos_test?schema=public";

/** Refuses to run against anything that isn't clearly a disposable test database. */
export function assertTestDatabaseUrl(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to run integration tests against database "${name}": name must end with _test`);
  return name;
}

export default async function setup() {
  const name = assertTestDatabaseUrl(TEST_DATABASE_URL);
  if (name !== "personalos_test") throw new Error(`Unexpected test database "${name}"`);
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

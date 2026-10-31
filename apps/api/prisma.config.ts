import { defineConfig } from "prisma/config";

// Prisma 7 no longer auto-loads .env; use Node's built-in loader (no dotenv dependency).
try {
  process.loadEnvFile(".env");
} catch {
  // CI/production provide DATABASE_URL via the environment.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] ?? "" },
});

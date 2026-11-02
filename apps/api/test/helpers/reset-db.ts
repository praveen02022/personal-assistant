import type { PrismaClient } from "../../src/generated/prisma/client.js";

/** Truncates app tables, after asking Postgres which database this connection is really on. */
export async function resetTestDatabase(prisma: Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ db: string }>>("SELECT current_database() AS db");
  if (!row?.db.endsWith("_test")) throw new Error(`Refusing to truncate database "${row?.db}"`);
  await prisma.$executeRawUnsafe('TRUNCATE "AuditLog", "AppTask", "Conversation", "AuthSession", "UserPreference", "VoicePreference", "IntegrationConnection", "IntegrationCredential", "OAuthState", "AgentAccessToken", "User" CASCADE');
}

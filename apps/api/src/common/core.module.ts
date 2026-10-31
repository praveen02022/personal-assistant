import { Global, Module } from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import { ENV, loadEnv } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Process-wide singletons: validated env, database client, audit log. */
@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, PrismaService, AuditService],
  exports: [ENV, PrismaService, AuditService],
})
export class CoreModule {}

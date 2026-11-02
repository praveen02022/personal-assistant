import { Controller, Get } from "@nestjs/common";
import type { Health } from "@personalos/contracts";
import { Public } from "../auth/auth.decorators.js";
import { AgentGateway } from "../gateway/gateway.port.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { VoiceService } from "../voice/voice.service.js";

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AgentGateway,
    private readonly voice: VoiceService,
  ) {}

  @Public()
  @Get()
  async health(): Promise<Health> {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => "ok" as const, () => "down" as const);
    return { db, gateway: this.gateway.currentState(), voice: this.voice.isAvailable() ? "ok" : "unconfigured" };
  }
}

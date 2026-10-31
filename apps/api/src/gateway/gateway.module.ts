import { Global, Module } from "@nestjs/common";
import { AgentGateway } from "./gateway.port.js";
import { OpenClawGatewayService } from "./openclaw-gateway.service.js";

/** Binds the AgentGateway port to the OpenClaw adapter. Tests override AgentGateway with a fake. */
@Global()
@Module({
  providers: [{ provide: AgentGateway, useClass: OpenClawGatewayService }],
  exports: [AgentGateway],
})
export class GatewayModule {}

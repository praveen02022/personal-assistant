import { Module } from "@nestjs/common";
import { AgentTokenService } from "../mcp/agent-token.js";
import { McpController } from "../mcp/mcp.controller.js";
import { CredentialVault } from "./credential-vault.js";
import { IntegrationsController } from "./integrations.controller.js";
import { IntegrationsService } from "./integrations.service.js";

/** External accounts (OAuth + encrypted credentials) and the tools the agent reaches over MCP. */
@Module({
  controllers: [IntegrationsController, McpController],
  providers: [CredentialVault, IntegrationsService, AgentTokenService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

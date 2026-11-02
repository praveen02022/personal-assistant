import { Module } from "@nestjs/common";
import { DemoController } from "./demo.controller.js";
import { DemoService } from "./demo.service.js";

/**
 * Customer demo workspace. Deliberately imports no other feature module: no agent runtime,
 * integrations, MCP tools or voice providers are reachable from here (demo.isolation.spec.ts).
 */
@Module({
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}

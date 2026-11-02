import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { OriginGuard, SessionGuard } from "./auth/guards.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { CoreModule } from "./common/core.module.js";
import { ConversationsController } from "./conversations/conversations.controller.js";
import { ConversationsService } from "./conversations/conversations.service.js";
import { GatewayModule } from "./gateway/gateway.module.js";
import { HealthController } from "./health/health.controller.js";
import { TaskStreamRegistry } from "./tasks/task-stream.registry.js";
import { TasksController } from "./tasks/tasks.controller.js";
import { TasksService } from "./tasks/tasks.service.js";
import { IntegrationsModule } from "./integrations/integrations.module.js";
import { VoiceModule } from "./voice/voice.module.js";
import { DemoModule } from "./demo/demo.module.js";

@Module({
  imports: [CoreModule, GatewayModule, VoiceModule, IntegrationsModule, DemoModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  controllers: [AuthController, ConversationsController, TasksController, HealthController],
  providers: [
    AuthService,
    ConversationsService,
    TasksService,
    TaskStreamRegistry,
    // Guard order matters: rate limit -> CSRF origin check -> session authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}

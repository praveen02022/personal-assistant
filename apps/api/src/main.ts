import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureApp } from "./app.factory.js";
import { AppModule } from "./app.module.js";
import { ENV, type Env } from "./config/env.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app);
  const env = app.get<Env>(ENV);
  // Loopback only: the browser reaches the API through the Next.js same-origin proxy.
  await app.listen(env.PORT, "127.0.0.1");
  new Logger("Bootstrap").log(`PersonalOS API listening on http://127.0.0.1:${env.PORT}/api`);
}

bootstrap().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

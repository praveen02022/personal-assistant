import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";

/** Shared HTTP wiring for main.ts and integration tests, so tests exercise the real pipeline. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set("trust proxy", "loopback"); // the Next.js dev proxy forwards the client IP
  express.useBodyParser("json", { limit: "64kb" });
  express.use(cookieParser());
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  return app;
}

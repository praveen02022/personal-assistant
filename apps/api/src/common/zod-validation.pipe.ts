import { HttpStatus, type PipeTransform } from "@nestjs/common";
import { ErrorCodes } from "@personalos/contracts";
import type { z } from "zod";
import { AppError } from "./errors.js";

/** Validates a request part against a shared contract schema: @Body(new ZodPipe(Schema)). */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Request validation failed", {
        details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return result.data;
  }
}

export const UuidParam = {
  transform(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw AppError.notFound();
    }
    return value.toLowerCase();
  },
} satisfies PipeTransform<unknown, string>;

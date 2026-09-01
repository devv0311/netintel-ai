import { z } from "zod";

/**
 * The runtime validation boundary shared by every domain type and by
 * the database read/write layer (src/lib/db/repository.ts). Nothing
 * enters or leaves the domain layer without passing through one of
 * these — malformed structured data (including AI-derived structure,
 * once agents exist) must fail explicitly here rather than propagate.
 */

export const ValidationErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.string()).optional(),
});
export type ValidationError = z.infer<typeof ValidationErrorSchema>;

export const ValidationWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.array(z.string()).optional(),
});
export type ValidationWarning = z.infer<typeof ValidationWarningSchema>;

export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationWarningSchema),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Thrown by validateOrThrow — never silently swallowed by a caller. */
export class DomainValidationError extends Error {
  readonly issues: ValidationError[];

  constructor(context: string, issues: ValidationError[]) {
    super(
      `${context}: ${issues.map((i) => `${i.path?.join(".") ?? "(root)"}: ${i.message}`).join("; ")}`,
    );
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

function zodIssuesToValidationErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map(String),
  }));
}

/**
 * Validates `data` against `schema`. Throws DomainValidationError on
 * failure — used at boundaries where malformed data must hard-fail
 * (database writes, fixture loading).
 */
export function validateOrThrow<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DomainValidationError(context, zodIssuesToValidationErrors(result.error));
  }
  return result.data;
}

/**
 * Validates `data` against `schema` without throwing — used at
 * boundaries where the caller must decide how to handle invalid input
 * (e.g. a future agent's input/output validation, where a malformed
 * item should be reported as a warning/error for that item rather than
 * abort a whole batch).
 */
export function validateSafe<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { valid: true; data: T } | { valid: false; errors: ValidationError[] } {
  const result = schema.safeParse(data);
  if (!result.success) {
    return { valid: false, errors: zodIssuesToValidationErrors(result.error) };
  }
  return { valid: true, data: result.data };
}

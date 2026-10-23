import { z } from "zod";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export function parseRequest<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) =>
        issue.path.reduce<string>(
          (path, part) =>
            typeof part === "number"
              ? `${path}[${part}]`
              : path
                ? `${path}.${String(part)}`
                : String(part),
          "",
        ) || "body",
    );
    throw new RequestError(422, "invalid_fields", "Invalid request fields.", details);
  }
  return parsed.data;
}

import type { EstimateErrorCode } from "@/lib/estimate/values";
import { HttpError } from "@/lib/http-error";

type ValueError = { index: number; code: EstimateErrorCode };

/**
 * A failed estimate request. Besides the message, some answers carry
 * details: a 400 lists the offending values with a code each (index -1 for
 * the count rules), and deleting a value that tasks use answers 409 with how
 * many tasks use it.
 */
export class EstimateRequestError extends HttpError {
  errors: ValueError[];
  taskCount: number | null;

  constructor(
    status: number,
    message: string,
    details: { errors?: ValueError[]; taskCount?: number | null } = {},
  ) {
    super(status, message);
    this.name = "EstimateRequestError";
    this.errors = details.errors ?? [];
    this.taskCount = details.taskCount ?? null;
  }
}

function parseErrors(value: unknown): ValueError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { index, code } = entry as { index?: unknown; code?: unknown };
    return typeof index === "number" && typeof code === "string"
      ? [{ index, code: code as EstimateErrorCode }]
      : [];
  });
}

/** Reads a failed response: JSON bodies carry details, others are text. */
export async function toEstimateRequestError(response: {
  status: number;
  text: () => Promise<string>;
}): Promise<EstimateRequestError> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && "message" in body) {
      const { message, errors, taskCount } = body as {
        message?: unknown;
        errors?: unknown;
        taskCount?: unknown;
      };
      if (typeof message === "string") {
        return new EstimateRequestError(response.status, message, {
          errors: parseErrors(errors),
          taskCount: typeof taskCount === "number" ? taskCount : null,
        });
      }
    }
  } catch {
    // Plain-text answers are the message itself.
  }
  return new EstimateRequestError(response.status, text);
}

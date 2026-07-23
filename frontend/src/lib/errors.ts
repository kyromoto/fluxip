import { ApiError } from "../services/api";

/**
 * Plain-language error catalog (FR-013/014/015; contracts/error-message-catalog.md).
 * Every surface that displays a failure MUST go through `toUserMessage()` —
 * never a caught error's raw `.message`/`String(err)`.
 */
interface ErrorMatch {
  status?: number;
  errorBody?: string;
  message: string;
}

const CATALOG: ErrorMatch[] = [
  {
    status: 400,
    errorBody: "newPassword must be at least 8 characters",
    message: "Your new password needs to be at least 8 characters.",
  },
  {
    status: 502,
    message: "We couldn't update your password right now. Please try again in a moment.",
  },
];

const FALLBACK = "Something went wrong. Please try again.";
const NETWORK_FALLBACK = "We couldn't reach FluxIP. Check your connection and try again.";

function parseErrorBody(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : undefined;
  } catch {
    return undefined;
  }
}

/** Total function: always returns a non-empty, plain-language string; never throws. */
export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const errorBody = parseErrorBody(err.message);
    const match = CATALOG.find(
      (entry) =>
        (entry.status === undefined || entry.status === err.status) &&
        (entry.errorBody === undefined || entry.errorBody === errorBody),
    );
    return match?.message ?? FALLBACK;
  }
  if (err instanceof TypeError) {
    // fetch() rejects with a TypeError when the request never reaches the server.
    return NETWORK_FALLBACK;
  }
  return FALLBACK;
}

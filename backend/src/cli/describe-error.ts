/**
 * A short, credential-free reason for an error: the error code (ECONNREFUSED, ...) when there is one,
 * otherwise the message with anything that looks like a URL's user info removed.
 */
export function describeError(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    if ((err as { name?: unknown }).name === "TimeoutError" || (err as { name?: unknown }).name === "AbortError") return "timeout";
    const cause = (err as { cause?: unknown }).cause;
    if (typeof cause === "object" && cause !== null && typeof (cause as { code?: unknown }).code === "string") {
      return (cause as { code: string }).code;
    }
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    const inner = (err as { errors?: unknown }).errors;
    if (Array.isArray(inner)) {
      const first = inner.map((e) => (e as { code?: unknown })?.code).find((c) => typeof c === "string");
      if (typeof first === "string") return first;
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@");
}

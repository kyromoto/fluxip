import { describe, expect, it } from "vitest";
import { toUserMessage } from "~/lib/errors";
import { ApiError } from "~/services/api";

describe("toUserMessage", () => {
  it("maps a known 400 error body to its plain-language message", () => {
    const err = new ApiError(400, JSON.stringify({ error: "newPassword must be at least 8 characters" }));
    expect(toUserMessage(err)).toBe("Your new password needs to be at least 8 characters.");
  });

  it("maps a known status-only error (502) regardless of body", () => {
    const err = new ApiError(502, JSON.stringify({ error: "logto management api unreachable: ECONNREFUSED" }));
    expect(toUserMessage(err)).toBe("We couldn't update your password right now. Please try again in a moment.");
  });

  it("falls back to a generic message for an unrecognized ApiError, never leaking the raw body", () => {
    const err = new ApiError(500, JSON.stringify({ error: "internal aggregate replay failure at seq 42" }));
    const message = toUserMessage(err);
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toContain("aggregate");
    expect(message).not.toContain("500");
  });

  it("falls back safely when the error body isn't valid JSON", () => {
    const err = new ApiError(500, "<html>502 Bad Gateway</html>");
    expect(toUserMessage(err)).toBe("Something went wrong. Please try again.");
  });

  it("maps a network-level failure (fetch TypeError) to a connectivity message", () => {
    const err = new TypeError("Failed to fetch");
    expect(toUserMessage(err)).toBe("We couldn't reach FluxIP. Check your connection and try again.");
  });

  it("never throws and always returns a non-empty string for arbitrary input", () => {
    for (const input of [undefined, null, "plain string", 42, {}]) {
      const message = toUserMessage(input);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

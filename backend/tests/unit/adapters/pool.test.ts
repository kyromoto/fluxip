import { describe, expect, it } from "vitest";
import { createPool } from "../../../src/adapters/event-store-postgres/pool.js";

describe("createPool", () => {
  it("survives an error on an idle connection instead of crashing the process (specs/010, US3-2)", async () => {
    const pool = createPool("postgresql://nobody@127.0.0.1:1/none");
    try {
      // Without a listener, emitting "error" throws (Node's EventEmitter contract) — which in a real process is an uncaught exception.
      expect(() => pool.emit("error", new Error("terminating connection due to administrator command"), {})).not.toThrow();
    } finally {
      await pool.end();
    }
  });
});

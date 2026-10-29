import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli, type CliIo } from "../../src/cli.js";

function capture(env: NodeJS.ProcessEnv = {}): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { stdout: (l) => out.push(l), stderr: (l) => err.push(l), env }, out, err };
}

describe("CLI skeleton", () => {
  it("has the documented exit codes", () => {
    expect([EXIT_OK, EXIT_ERROR, EXIT_USAGE]).toEqual([0, 1, 2]);
  });

  it.each([[[]], [["help"]], [["--help"]], [["-h"]]])("shows the help and exits 0 for %j", async (argv) => {
    const { io, out } = capture();
    expect(await runCli(argv, io)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Usage: node backend/dist/cli.js <command> [options]");
    expect(text).toContain("migrate");
    expect(text).toContain("validate-config [--online]");
  });

  it("works with an empty environment (help never needs configuration)", async () => {
    const { io } = capture({});
    expect(await runCli(["help"], io)).toBe(0);
  });

  it("shows the help on stderr and exits 2 for an unknown command", async () => {
    const { io, out, err } = capture();
    expect(await runCli(["bogus"], io)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("Unknown command: bogus");
    expect(err.join("\n")).toContain("Usage: node backend/dist/cli.js");
  });

  it("exits 2 for an unknown option", async () => {
    const { io, err } = capture();
    expect(await runCli(["validate-config", "--bogus"], io)).toBe(2);
    expect(err.join("\n")).toContain("--bogus");
  });

  it("exits 2 for an unexpected argument", async () => {
    const { io, err } = capture();
    expect(await runCli(["migrate", "extra"], io)).toBe(2);
    expect(err.join("\n")).toContain("extra");
  });
});

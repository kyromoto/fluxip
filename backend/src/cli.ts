import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

/** Where a command reads its environment from and writes to; injectable so tests can capture the output. */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface CommandArgs {
  online: boolean;
}

interface CommandModule {
  run: (args: CommandArgs, io: CliIo) => Promise<number>;
}

interface Command {
  usage: string;
  description: string;
  options: { online?: { type: "boolean" } };
  load: () => Promise<CommandModule>;
}

/** Command modules are loaded on demand so `help` works without configuration or a database. */
const commands: Record<string, Command> = {
  migrate: {
    usage: "migrate",
    description: "Apply pending database migrations (needs BACKEND_DATABASE_URL)",
    options: {},
    load: () => import("./cli/migrate-command.js"),
  },
  "validate-config": {
    usage: "validate-config [--online]",
    description: "Check the configuration; --online also checks Postgres, Redis and Logto",
    options: { online: { type: "boolean" } },
    load: () => import("./cli/validate-config-command.js"),
  },
};

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
};

function helpLines(): string[] {
  return [
    "Usage: node backend/dist/cli.js <command> [options]",
    "",
    "Commands:",
    ...Object.values(commands).map((c) => `  ${c.usage.padEnd(28)}${c.description}`),
    "",
    "Exit codes: 0 ok, 1 failed, 2 usage error.",
  ];
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [name, ...rest] = argv;

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    for (const line of helpLines()) io.stdout(line);
    return EXIT_OK;
  }

  const command = commands[name];
  if (!command) {
    io.stderr(`Unknown command: ${name}`);
    io.stderr("");
    for (const line of helpLines()) io.stderr(line);
    return EXIT_USAGE;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: rest, options: command.options, allowPositionals: true, strict: true });
  } catch (err) {
    io.stderr(err instanceof Error ? err.message : String(err));
    return EXIT_USAGE;
  }
  if (parsed.positionals.length > 0) {
    io.stderr(`Unexpected argument: ${parsed.positionals[0]}`);
    return EXIT_USAGE;
  }

  const { run } = await command.load();
  return run({ online: parsed.values.online === true }, io);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(EXIT_ERROR);
    },
  );
}

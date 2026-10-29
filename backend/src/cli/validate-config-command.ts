import { checkConfig, type ConfigFinding } from "../config/check.js";
import { EXIT_ERROR, EXIT_OK, type CliIo, type CommandArgs } from "../cli.js";
import { checkLogto, checkPostgres, checkRedis, type Reachability } from "./online-checks.js";

const ONLINE_TARGETS: { service: Reachability["service"]; variable: string; check: (value: string) => Promise<Reachability> }[] = [
  { service: "postgres", variable: "BACKEND_DATABASE_URL", check: checkPostgres },
  { service: "redis", variable: "BACKEND_REDIS_URL", check: checkRedis },
  { service: "logto", variable: "BACKEND_LOGTO_ENDPOINT", check: checkLogto },
];

function printFinding(finding: ConfigFinding, io: CliIo): void {
  if (finding.level === "error") io.stdout(`ERROR ${finding.name}: ${finding.reason}`);
  else io.stdout(`WARN  ${finding.name}: ${finding.reason} (${finding.feature} will not work)`);
}

/**
 * Checks the configuration from the environment before a deploy. Reports every problem in one run and never
 * prints a value. With --online it also checks that Postgres, Redis and Logto answer.
 */
export async function run(args: CommandArgs, io: CliIo): Promise<number> {
  const findings = checkConfig(io.env);
  for (const finding of findings) printFinding(finding, io);

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  if (errors.length > 0) io.stdout(`${errors.length} error(s), ${warnings.length} warning(s)`);
  else io.stdout(warnings.length > 0 ? `configuration ok (${warnings.length} warning(s))` : "configuration ok");

  let unreachable = 0;
  if (args.online) {
    const invalid = new Set(errors.map((e) => e.name));
    const results = await Promise.all(
      ONLINE_TARGETS.map(async ({ service, variable, check }): Promise<Reachability | { service: string; skipped: true }> => {
        const value = io.env[variable]?.trim();
        if (invalid.has(variable) || !value) return { service, skipped: true };
        return check(value);
      }),
    );
    for (const result of results) {
      if ("skipped" in result) io.stdout(`skip  ${result.service}: configuration invalid`);
      else if (result.ok) io.stdout(`ok    ${result.service}`);
      else {
        unreachable += 1;
        io.stdout(`FAIL  ${result.service}: ${result.reason}`);
      }
    }
  }

  return errors.length > 0 || unreachable > 0 ? EXIT_ERROR : EXIT_OK;
}

// Decides the next version of the FluxIP agent (specs/008-traefik-provider-config, FR-062).
//
// The agent is released on its own line, separate from the backend image: only commits touching
// agent/ or proto/ count, tags look like `agent-v1.2.3`, and the bump comes from the same
// Conventional Commits rules the backend release uses.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { analyzeCommits } from "@semantic-release/commit-analyzer";

const TAG_PREFIX = "agent-v";
const PATHS = ["agent", "proto"];

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) appendFileSync(outputPath, `${name}=${value}\n`);
  else console.log(`${name}=${value}`);
}

export function bump(version, type) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

async function main() {
  const lastTag = git("tag", "--list", `${TAG_PREFIX}*`, "--sort=-v:refname").split("\n").filter(Boolean)[0];
  const range = lastTag ? [`${lastTag}..HEAD`] : ["HEAD"];
  const raw = git("log", ...range, "--format=%H%x1f%B%x1e", "--", ...PATHS);
  const commits = raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, message] = entry.split("\x1f");
      return { hash, message: message ?? "" };
    });

  const type = commits.length
    ? await analyzeCommits({ preset: "conventionalcommits" }, { cwd: process.cwd(), commits, logger: { log() {}, error: console.error } })
    : null;

  if (!type) {
    console.error(lastTag ? `No releasable agent changes since ${lastTag}.` : "No releasable agent changes yet.");
    setOutput("should-release", "false");
    setOutput("version", "");
    setOutput("git-tag", "");
    return;
  }

  const version = lastTag ? bump(lastTag.slice(TAG_PREFIX.length), type) : "1.0.0";
  setOutput("should-release", "true");
  setOutput("version", version);
  setOutput("git-tag", `${TAG_PREFIX}${version}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

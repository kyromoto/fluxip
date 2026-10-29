import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import semanticRelease from "semantic-release";

const result = await semanticRelease({ dryRun: true, ci: false });

function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(outputPath, `${name}=${value}\n`);
  } else {
    console.log(`${name}=${value}`);
  }
}

if (!result) {
  setOutput("should-release", "false");
  setOutput("version", "");
  setOutput("git-tag", "");
} else {
  const { version, notes } = result.nextRelease;

  // Release notes from the same commits that decided the bump. The workflow uses
  // them for the GitHub Release body; CHANGELOG.md gets them prepended.
  writeFileSync("release-notes.md", `${notes}\n`);
  const header = "# Changelog\n\n";
  const previous = existsSync("CHANGELOG.md")
    ? readFileSync("CHANGELOG.md", "utf8").replace(header, "")
    : "";
  writeFileSync("CHANGELOG.md", `${header}${notes}\n\n${previous}`.trimEnd() + "\n");

  setOutput("should-release", "true");
  setOutput("version", version);
  setOutput("git-tag", `v${version}`);
}

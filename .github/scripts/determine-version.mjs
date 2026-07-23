import { appendFileSync } from "node:fs";
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
  const { version } = result.nextRelease;
  setOutput("should-release", "true");
  setOutput("version", version);
  setOutput("git-tag", `v${version}`);
}

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Maps the window.__ENV__ key the frontend reads to the FRONTEND_-prefixed
// env var an operator sets (research.md §2 — prefixed to avoid colliding
// with the backend's own same-named LOGTO_* vars).
const ENV_KEY_MAP = {
  LOGTO_ENDPOINT: "FRONTEND_LOGTO_ENDPOINT",
  LOGTO_APP_ID: "FRONTEND_LOGTO_APP_ID",
  LOGTO_API_RESOURCE: "FRONTEND_LOGTO_API_RESOURCE",
  BACKEND_URL: "FRONTEND_BACKEND_URL",
};

export function buildConfig(env) {
  const config = {};
  for (const [key, envVar] of Object.entries(ENV_KEY_MAP)) {
    config[key] = env[envVar] ?? "";
  }
  return config;
}

export function renderConfigJs(config) {
  return `window.__ENV__ = ${JSON.stringify(config)};\n`;
}

export function renderIndexHtml(html, token) {
  return html.replaceAll("__CONFIG_VERSION__", token);
}

// One line per empty value, naming the FRONTEND_* env var an operator
// actually sets — never blocks startup (contracts/docker-entrypoint.md
// step 1b, FR-008/User Story 3).
export function warnAboutMissingValues(config, log = console.warn) {
  for (const [key, envVar] of Object.entries(ENV_KEY_MAP)) {
    if (!config[key]) {
      log(`docker-entrypoint: ${envVar} is not set — the frontend will be unable to use it.`);
    }
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(scriptDir, "..", "dist");

async function main() {
  const config = buildConfig(process.env);
  warnAboutMissingValues(config);

  await writeFile(join(distDir, "config.js"), renderConfigJs(config));

  const indexHtmlPath = join(distDir, "index.html");
  const html = await readFile(indexHtmlPath, "utf8");
  await writeFile(indexHtmlPath, renderIndexHtml(html, String(Date.now())));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}

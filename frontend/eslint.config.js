// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.tsx", "**/*.ts"],
    plugins: { solid },
    rules: {
      ...solid.configs.recommended.rules,
    },
  },
  {
    // The Docker entrypoint's runtime-config generator (specs/006-frontend-runtime-config) — a plain Node script, not part of the Vite/browser bundle.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    // Build-time placeholder copied into dist/ as-is by Vite (frontend/public/), executed directly in the browser.
    files: ["public/**/*.js"],
    languageOptions: {
      globals: { window: "readonly" },
    },
  },
  prettier,
);

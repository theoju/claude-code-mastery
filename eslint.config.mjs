// Flat ESLint config. Replaces the dead `next lint` script — Next 16 removed
// that subcommand, and this repo had no eslint config or dependency at all,
// so nothing was linted between the Next 16 upgrade and CCE-162.
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "out/**",
      "build/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "graphify-out/**",
      "app/data/*.json",
      // Not our source: stray worktrees, mkdocs build output, vendored bundles.
      ".claude/**",
      "site/**",
      "**/.venv*/**",
      "**/*.min.js",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;

import js from "@eslint/js";
import globals from "globals";

const qualityRules = {
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-redeclare": "error",
  eqeqeq: ["error", "smart"],
  "consistent-return": ["error", { treatUndefinedAsUnspecified: true }],
  "no-implicit-coercion": ["error", { allow: ["!!"] }],
  "prefer-const": "error",
};

export default [
  {
    ignores: [
      "node_modules/**",
      ".venv/**",
      ".cache/**",
      ".pytest_cache/**",
      ".keras/**",
      ".local/**",
      "models/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    rules: qualityRules,
  },
  {
    files: ["server/**/*.js", "test/**/*.js", "tools/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: qualityRules,
  },
];

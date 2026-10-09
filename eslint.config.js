// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config shared by the frontend, prover, `test/` harness and
 * `shared/` types. It is intentionally framework-free: no React plugin is
 * required because the rules below are syntax- and type-agnostic.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "contract/**",
      "circuits/build/**",
      "frontend/public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs,js}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Allow intentionally unused parameters/vars when prefixed with `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);

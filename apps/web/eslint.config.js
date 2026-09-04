import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `dist` is the web build; `ios/App/App/public` is the same build after
  // `cap sync` copies it into the Capacitor shell, and `android/` would be
  // its twin. Neither is source: they are generated, untracked, and they
  // carry vendored files (workbox) whose own eslint-disable comments name
  // rules this config does not load, which is what turned `npm run lint`
  // red on 2026-09-03 with 10 errors that no source change could fix.
  { ignores: ["dist", "ios/**", "android/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);

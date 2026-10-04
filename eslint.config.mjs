import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".trigger/**",
    ".vercel/**",
    "brag-output*/**",
    "next-env.d.ts",
    // PWA generated files:
    "public/sw.js",
    "public/workbox-*.js",
    "public/worker-*.js",
  ]),
]);

export default eslintConfig;

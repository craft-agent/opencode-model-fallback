import { build } from "esbuild"

await build({
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "info",
  entryPoints: ["src/opencode/index.ts"],
  outfile: "dist/opencode.js",
})

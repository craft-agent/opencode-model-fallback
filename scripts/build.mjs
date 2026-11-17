import { build } from "esbuild"

await build({
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "info",
  entryPoints: { opencode: "src/opencode/index.ts", rpc: "src/opencode/fallback/rpc.ts" },
  outdir: "dist",
})

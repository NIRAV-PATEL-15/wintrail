import * as esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const common = { bundle: true, minify: !watch, sourcemap: watch ? "inline" : false, logLevel: "info" };
const webview = (entry, out) => ({
  ...common, entryPoints: [entry], outfile: out, platform: "browser", format: "iife", target: "es2022",
  mainFields: ["svelte", "browser", "module", "main"], conditions: ["svelte", "browser"],
  plugins: [sveltePlugin({ compilerOptions: { css: "injected" } })],
});
const configs = [
  { ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", platform: "node", format: "cjs", target: "node18", external: ["vscode"] },
];
if (existsSync("webview/main.ts")) configs.push(webview("webview/main.ts", "dist/webview.js"));
if (existsSync("webview/break.ts")) configs.push(webview("webview/break.ts", "dist/break.js"));
const ctxs = await Promise.all(configs.map((c) => esbuild.context(c)));
if (watch) await Promise.all(ctxs.map((c) => c.watch()));
else { await Promise.all(ctxs.map((c) => c.rebuild())); await Promise.all(ctxs.map((c) => c.dispose())); }

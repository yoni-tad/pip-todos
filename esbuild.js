// Bundles two entry points with esbuild:
//   1. src/extension.ts  -> out/extension.js   (Node, VS Code extension host)
//   2. webview/main.ts    -> out/webview.js     (browser, runs inside the webview)
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["webview/main.ts"],
  bundle: true,
  outfile: "out/webview.js",
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

// The stylesheet is bundled into out/ so it ships inside the .vsix and is served
// from the same folder as the scripts.
/** @type {import('esbuild').BuildOptions} */
const cssConfig = {
  entryPoints: ["webview/style.css"],
  bundle: true,
  outfile: "out/style.css",
  minify: production,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
      esbuild.context(cssConfig),
    ]);
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("[esbuild] watching...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
      esbuild.build(cssConfig),
    ]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

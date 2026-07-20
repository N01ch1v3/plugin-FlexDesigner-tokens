import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import copy from "rollup-plugin-copy";
import json from "@rollup/plugin-json";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";
import { glob } from "glob";
import { fileURLToPath } from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const flexPlugin = "com.arishow.aitokens.plugin";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Platform-specific @napi-rs/canvas binaries must be copied next to the bundle;
// rollup cannot inline .node files.
const canvasPlatforms = [
  "canvas-win32-x64-msvc",
  "canvas-darwin-universal",
  "canvas-darwin-x64",
  "canvas-darwin-arm64",
  "canvas-linux-x64-gnu",
  "canvas-linux-arm64-gnu",
  "canvas-linux-x64-musl",
  "canvas-linux-arm64-musl"
];

function canvasCopyTargets() {
  const targets = [];
  for (const platform of canvasPlatforms) {
    const modulePath = `node_modules/@napi-rs/${platform}`;
    if (!fs.existsSync(modulePath)) continue;
    try {
      const files = fs.readdirSync(modulePath);
      const nodeFile = files.find((f) => f.endsWith(".node"));
      if (!nodeFile) continue;

      targets.push({ src: `${modulePath}/${nodeFile}`, dest: `${flexPlugin}/backend/` });
      if (files.includes("icudtl.dat")) {
        targets.push({ src: `${modulePath}/icudtl.dat`, dest: `${flexPlugin}/backend/` });
      }
      targets.push({
        src: `${modulePath}/*`,
        dest: `${flexPlugin}/backend/node_modules/@napi-rs/${platform}/`
      });
    } catch (e) {
      console.warn(`Warning: could not process ${platform}: ${e.message}`);
    }
  }
  return targets;
}

/** @type {import('rollup').RollupOptions} */
const config = {
  input: "src/plugin.js",
  output: {
    file: `${flexPlugin}/backend/plugin.cjs`,
    format: "cjs",
    sourcemap: isWatching,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) =>
      url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href
  },
  plugins: [
    json(),
    {
      name: "watch-externals",
      buildStart() {
        this.addWatchFile(`${flexPlugin}/manifest.json`);
        glob.sync(`${flexPlugin}/ui/*.vue`).forEach((file) => this.addWatchFile(file));
      }
    },
    copy({ targets: canvasCopyTargets() }),
    nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
    commonjs(),
    !isWatching && terser()
  ],
  external: (id) => id.endsWith(".node") || id.startsWith("@napi-rs/canvas-")
};

export default config;

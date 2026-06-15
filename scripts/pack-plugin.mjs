#!/usr/bin/env node
// Pack a plugin source directory into a single, compressed, obfuscated
// `.orcpkg` file (see src/shared/PluginPackage.ts for the format).
//
//   node scripts/pack-plugin.mjs <pluginDir> [outDir]
//
// JS files (entry + UI) are run through javascript-obfuscator so the shipped
// code is not plaintext; everything is gzip-compressed into one file. The
// manifest stays readable inside the package for pre-install validation.

import { promises as fs } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const gzip = promisify(zlib.gzip);

const PACKAGE_FORMAT = 1;
const PACKAGE_EXT = ".orcpkg";

// Moderate obfuscation. Deliberately conservative: no control-flow flattening
// (it can break native/child_process call patterns), and globals like
// require/module/exports/__dirname are never renamed by the obfuscator, so CJS
// entry modules keep working after packing.
const OBFUSCATOR_OPTIONS = {
  compact: true,
  simplify: true,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["base64"],
  identifierNamesGenerator: "hexadecimal",
  numbersToExpressions: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
};

/** Collect every file under `dir`, returning paths relative to `dir` (posix). */
async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(abs, base)));
    } else if (entry.isFile()) {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

async function packPlugin(pluginDir, outDir) {
  const manifestRaw = await fs.readFile(
    path.join(pluginDir, "plugin.json"),
    "utf8",
  );
  const manifest = JSON.parse(manifestRaw);
  if (!manifest.id || !manifest.name || !manifest.version) {
    throw new Error(`${pluginDir}: plugin.json 缺少 id/name/version`);
  }

  const relPaths = await walk(pluginDir);
  const files = {};
  for (const rel of relPaths) {
    const abs = path.join(pluginDir, ...rel.split("/"));
    if (rel.toLowerCase().endsWith(".js")) {
      // Obfuscate JS (entry + UI) before embedding.
      const src = await fs.readFile(abs, "utf8");
      const obf = JavaScriptObfuscator.obfuscate(
        src,
        OBFUSCATOR_OPTIONS,
      ).getObfuscatedCode();
      files[rel] = Buffer.from(obf, "utf8").toString("base64");
    } else {
      // Manifest, HTML, icons, binaries — embed verbatim.
      files[rel] = (await fs.readFile(abs)).toString("base64");
    }
  }

  const pkg = { format: PACKAGE_FORMAT, manifest, files };
  const gz = await gzip(Buffer.from(JSON.stringify(pkg), "utf8"));

  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${manifest.id}-${manifest.version}${PACKAGE_EXT}`,
  );
  await fs.writeFile(outPath, gz);
  const jsCount = relPaths.filter((r) => r.toLowerCase().endsWith(".js")).length;
  console.log(
    `✓ ${manifest.id} → ${outPath} ` +
      `(${relPaths.length} 文件, ${jsCount} 个 JS 已混淆, ${gz.length} 字节)`,
  );
  return outPath;
}

async function main() {
  const [pluginDir, outDir = "bundled-plugins"] = process.argv.slice(2);
  if (!pluginDir) {
    console.error(
      "用法: node scripts/pack-plugin.mjs <pluginDir> [outDir]",
    );
    process.exit(1);
  }
  await packPlugin(path.resolve(pluginDir), path.resolve(outDir));
}

// Allow reuse from pack-bundled.mjs without re-running main().
const invokedDirectly =
  path.resolve(process.argv[1] ?? "") ===
  fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}

export { packPlugin };

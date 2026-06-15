#!/usr/bin/env node
// Pack every plugin under `plugins/` into `bundled-plugins/*.orcpkg`. These
// pre-packed, obfuscated packages are shipped via forge `extraResource` and
// seeded into the user's plugin dir on first run (see
// src/main/plugins/install.ts seedBundledPlugins).
//
//   node scripts/pack-bundled.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packPlugin } from "./pack-plugin.mjs";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const pluginsDir = path.join(root, "plugins");
const outDir = path.join(root, "bundled-plugins");

async function main() {
  let entries;
  try {
    entries = await fs.readdir(pluginsDir, { withFileTypes: true });
  } catch {
    console.error(`找不到 plugins/ 目录：${pluginsDir}`);
    process.exit(1);
  }

  const dirs = entries.filter((e) => e.isDirectory());
  if (dirs.length === 0) {
    console.log("plugins/ 下没有插件，跳过。");
    return;
  }

  // Fresh output so removed/renamed plugins don't leave stale packages behind.
  await fs.rm(outDir, { recursive: true, force: true });

  for (const d of dirs) {
    const dir = path.join(pluginsDir, d.name);
    try {
      await fs.access(path.join(dir, "plugin.json"));
    } catch {
      console.warn(`跳过 ${d.name}（无 plugin.json）`);
      continue;
    }
    await packPlugin(dir, outDir);
  }
  console.log(`完成，输出目录：${outDir}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

#!/usr/bin/env node
// Publish the design-system packages to npm.
//
// Strategy (chosen so npm OIDC "trusted publishing" works without a token):
//   1. `pnpm pack` each publishable package. pnpm rewrites the `workspace:^`
//      dependencies into real version ranges in the packed manifest (plain
//      `npm publish` cannot do this), so the tarball is registry-correct.
//   2. `npm publish <tarball>` for each. The npm CLI (>= 11.5.1) performs the
//      OIDC handshake with the registry when a trusted publisher is configured
//      and the workflow has `id-token: write`, so no NPM_TOKEN is needed.
//
// Zero dependencies (Node built-ins only). Run from CI on push to `release`
// (see .github/workflows/release.yml), or locally for a dry run:
//   DRY_RUN=1 node scripts/publish-packages.mjs

import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.env.DRY_RUN === "1";

function pkgDirs() {
  const out = [];
  const scan = (rel, depth) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const childRel = join(rel, name.name);
      if (existsSync(join(root, childRel, "package.json"))) out.push(childRel);
      if (depth > 0) scan(childRel, depth - 1);
    }
  };
  scan("packages", 1);
  scan("designs", 1);
  return out;
}

const publishable = pkgDirs().filter((d) => {
  const pkg = JSON.parse(readFileSync(join(root, d, "package.json"), "utf8"));
  return pkg.private === false;
});

if (publishable.length === 0) {
  console.error("No publishable packages (none with \"private\": false).");
  process.exit(1);
}

const tarballDir = mkdtempSync(join(tmpdir(), "ds-publish-"));
const tarballs = [];
for (const dir of publishable) {
  const stdout = execSync(`pnpm pack --pack-destination "${tarballDir}"`, {
    cwd: join(root, dir),
    encoding: "utf8",
  });
  const tgz = stdout.trim().split("\n").filter(Boolean).pop();
  tarballs.push(tgz);
  console.log(`packed  ${dir}  ->  ${tgz}`);
}

for (const tgz of tarballs) {
  const cmd = `npm publish "${tgz}" --provenance --access public`;
  if (dryRun) {
    console.log(`[dry-run] would run: ${cmd}`);
  } else {
    console.log(`publishing ${tgz}`);
    execSync(cmd, { cwd: root, stdio: "inherit" });
  }
}

console.log(
  dryRun
    ? `Dry run complete: ${tarballs.length} packages packed (nothing published).`
    : `Published ${tarballs.length} packages.`,
);

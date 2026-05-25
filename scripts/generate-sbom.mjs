#!/usr/bin/env node

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { releaseDir, repoRoot, sbomPath } from "./release-artifacts.mjs";

function componentFromPackagePath(packagePath, definition) {
  const name = packagePath.replace(/^node_modules\//, "");
  return {
    type: "library",
    "bom-ref": `pkg:npm/${name}@${definition.version}`,
    name,
    version: definition.version,
    purl: `pkg:npm/${name}@${definition.version}`,
  };
}

async function main() {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const packageLock = JSON.parse(await fs.readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
  const components = Object.entries(packageLock.packages ?? {})
    .filter(([packagePath, definition]) => packagePath.startsWith("node_modules/") && definition.version)
    .map(([packagePath, definition]) => componentFromPackagePath(packagePath, definition))
    .sort((left, right) => left.name.localeCompare(right.name));

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: {
        type: "library",
        name: packageJson.name,
        version: packageJson.version,
        purl: `pkg:npm/${packageJson.name}@${packageJson.version}`,
      },
    },
    components,
  };

  await fs.mkdir(releaseDir, { recursive: true });
  await fs.writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, sbomPath).split(path.sep).join("/")} with ${components.length} components.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

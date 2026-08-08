/**
 * Empaqueta un módulo instalado al formato .abmod.
 *
 * Uso: bun run package <moduleId> [--out <dir>]
 *   bun run package RV1909          → dist-modules/RV1909-0.1.0.abmod
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModule } from "../src/lib/modules/registry.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

function main(): void {
  const args = process.argv.slice(2);
  const moduleId = args[0];
  if (!moduleId) {
    console.error("Uso: bun run package <moduleId> [--out <dir>]");
    process.exit(1);
  }
  const outFlag = args.indexOf("--out");
  const outDir = outFlag >= 0 ? args[outFlag + 1] : "dist-modules";

  const info = getModule(moduleId);
  if (!info) {
    console.error(`módulo no instalado: ${moduleId}`);
    process.exit(1);
  }

  packageModuleToZip(moduleId)
    .then((zip) => {
      mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, `${moduleId}-${info.version}.abmod`);
      writeFileSync(file, zip);
      console.log(`Empaquetado: ${file} (${(zip.length / 1024).toFixed(1)} KB) — ${info.name}`);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

main();

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const BIN_DIR = path.join(process.cwd(), "binaries");
const CATALOG_FILE = path.join(process.cwd(), "catalog.json");

function computeSha256(filePath: string): string {
  const fileBytes = readFileSync(filePath);
  return createHash("sha256").update(fileBytes).digest("hex");
}

function main(): void {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "yojananyosef/alethia-modules";
  const verIdx = args.indexOf("--version");
  const versionTag = verIdx >= 0 ? args[verIdx + 1] : "v1.0.0";

  console.log(`\n📦 ALEPHIA MODULES — Sincronizador de Catálogo`);
  console.log(`=============================================`);
  console.log(`Repositorio: ${repo}`);
  console.log(`Versión:     ${versionTag}\n`);

  if (!existsSync(BIN_DIR)) {
    console.error(`Error: Directorio binaries/ no encontrado`);
    process.exit(1);
  }

  const catalog = JSON.parse(readFileSync(CATALOG_FILE, "utf8"));
  const files = readdirSync(BIN_DIR).filter((f) => f.endsWith(".abmod"));

  for (const file of files) {
    const filePath = path.join(BIN_DIR, file);
    const size = statSync(filePath).size;
    const sha = computeSha256(filePath);
    const moduleId = file.replace(/\.abmod$/, "").split("-")[0];

    const item = catalog.modules.find((m: any) => m.id === moduleId);
    if (item) {
      item.sizeBytes = size;
      item.sha256 = sha;
      item.downloadUrl = `https://github.com/${repo}/releases/download/${versionTag}/${file}`;
      console.log(`✓ [${moduleId.padEnd(8)}] ${(size / (1024 * 1024)).toFixed(2).padStart(6)} MB — SHA256: ${sha.slice(0, 12)}...`);
    }
  }

  catalog.generatedAt = new Date().toISOString();
  writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`\n✅ catalog.json actualizado.`);
}

main();

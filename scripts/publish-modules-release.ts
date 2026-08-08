/**
 * Script de publicación y sincronización del Catálogo y Releases.
 * 
 * Uso: bun run scripts/publish-modules-release.ts [--version <v1.0.0>] [--repo <user/repo>]
 * 
 * 1. Recalcula todos los hashes SHA-256 y tamaños exactos de dist-modules/*.abmod.
 * 2. Actualiza data/catalog.json con metadatos verificados.
 * 3. Crea el workflow de GitHub Actions (.github/workflows/release.yml) para subidas automáticas.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIST_DIR = path.join(process.cwd(), "dist-modules");
const CATALOG_FILE = path.join(process.cwd(), "data", "catalog.json");
const WORKFLOW_FILE = path.join(process.cwd(), ".github", "workflows", "release.yml");

interface CatalogJson {
  schemaVersion: number;
  generatedAt: string;
  catalogSource: string;
  modules: Array<{
    id: string;
    name: string;
    type: string;
    language: string;
    version: string;
    publisher: string;
    license: string;
    year: number;
    description: string;
    sizeBytes: number;
    sha256?: string;
    downloadUrl: string;
    dependencies?: string[];
    hasStrongs?: boolean;
    hasMorphology?: boolean;
    features?: string[];
  }>;
}

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

  console.log(`\n📦 ALEPHIA BRIDGE — Generador de Releases y Catálogo`);
  console.log(`====================================================`);
  console.log(`Repositorio destino: ${repo}`);
  console.log(`Tag de versión:      ${versionTag}\n`);

  if (!existsSync(DIST_DIR)) {
    console.error(`Error: No existe el directorio dist-modules/`);
    process.exit(1);
  }

  const existingCatalog: CatalogJson = existsSync(CATALOG_FILE)
    ? JSON.parse(readFileSync(CATALOG_FILE, "utf8"))
    : {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        catalogSource: "Alethia Official Registry",
        modules: [],
      };

  const files = readdirSync(DIST_DIR).filter((f) => f.endsWith(".abmod"));
  console.log(`Analizando ${files.length} paquetes .abmod en dist-modules/...\n`);

  for (const file of files) {
    const filePath = path.join(DIST_DIR, file);
    const size = statSync(filePath).size;
    const sha = computeSha256(filePath);

    // Determinar ID del módulo a partir del nombre del archivo (ej. RV1909-1.0.0.abmod -> RV1909)
    const baseName = file.replace(/\.abmod$/, "");
    const moduleId = baseName.split("-")[0];

    const item = existingCatalog.modules.find((m) => m.id === moduleId);
    if (item) {
      item.sizeBytes = size;
      item.sha256 = sha;
      item.downloadUrl = `https://github.com/${repo}/releases/download/${versionTag}/${file}`;
      console.log(`✓ [${moduleId.padEnd(8)}] ${(size / (1024 * 1024)).toFixed(2).padStart(6)} MB — SHA256: ${sha.slice(0, 12)}...`);
    }
  }

  existingCatalog.generatedAt = new Date().toISOString();
  writeFileSync(CATALOG_FILE, JSON.stringify(existingCatalog, null, 2));
  console.log(`\n✅ Archivo data/catalog.json actualizado con éxito.`);

  // Generar workflow de GitHub Actions
  mkdirSync(path.dirname(WORKFLOW_FILE), { recursive: true });
  const workflowContent = `name: Publicar Release de Módulos

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    name: Crear Release y Subir .abmod
    runs-on: ubuntu-latest
    steps:
      - name: Checkout del repositorio
        uses: actions/checkout@v4

      - name: Crear GitHub Release con Assets
        uses: softprops/action-gh-release@v2
        with:
          files: dist-modules/*.abmod
          name: Alethia Modules \${{ github.ref_name }}
          draft: false
          prerelease: false
          generate_release_notes: true
`;
  writeFileSync(WORKFLOW_FILE, workflowContent);
  console.log(`✅ Workflow de GitHub Actions creado en: .github/workflows/release.yml`);

  console.log(`\n🚀 Pasos para publicar en GitHub:`);
  console.log(`-----------------------------------`);
  console.log(`1. git add data/catalog.json .github/workflows/release.yml`);
  console.log(`2. git commit -m "feat: catalog v1.0.0 con checksums SHA-256 reales"`);
  console.log(`3. git tag ${versionTag}`);
  console.log(`4. git push origin main --tags\n`);
}

main();

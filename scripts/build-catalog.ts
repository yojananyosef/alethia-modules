import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

const BIN_DIR = path.join(process.cwd(), "binaries");
const CATALOG_FILE = path.join(process.cwd(), "catalog.json");

function computeSha256(filePath: string): string {
  const fileBytes = readFileSync(filePath);
  return createHash("sha256").update(fileBytes).digest("hex");
}

const MODULE_FEATURES: Record<string, string[]> = {
  RV1909: [
    "66 libros canónicos completos",
    "Códigos Strong en AT y NT",
    "Alineación interlineal semántica",
    "Índice FTS5 con búsqueda insensible a acentos",
  ],
  KJV: [
    "66 libros canónicos en inglés clásico",
    "Texto canónico King James Version 1769",
    "Índice FTS5 optimizado para concordancia",
  ],
  LUT1912: [
    "66 libros canónicos en alemán histórico",
    "Traducción de la Reforma de Martín Lutero (1912)",
    "Búsqueda FTS5 de alta velocidad",
  ],
  SBLGNT: [
    "27 libros del Nuevo Testamento en griego crítico",
    "Morfología griega Robinson completa",
    "Lemas griegos unicode y aparato interlineal sincronizado",
  ],
  WLC: [
    "39 libros del Antiguo Testamento hebreo",
    "Morfología OSHM detallada (3.400+ códigos)",
    "Strongs hebreos y texto consonántico con cantilación",
  ],
  OHB: [
    "39 libros del Antiguo Testamento con 8 capas interlineales",
    "Segmentación morfológica por raíces hebreas (Shoresh)",
    "Glosas ETCBC y transliteración fonética SBL",
  ],
  LXX: [
    "39 libros del Antiguo Testamento en Griego Antiguo (Septuaginta)",
    "Texto koiné de los Setenta",
    "Búsqueda FTS5 y vista interlineal sincronizada",
  ],
  NBV: [
    "66 libros canónicos en lenguaje fluido",
    "Vista paralela y comparación versículo a versículo",
    "Búsqueda FTS5 optimizada",
  ],
  SPL: [
    "66 libros canónicos en español",
    "Traducción católica directa de hebreo y griego (Straubinger)",
    "Búsqueda FTS5 optimizada",
  ],
  lexicon: [
    "20.800+ entradas léxicas académicas (TBESG Abbott-Smith + TBESH BDB)",
    "100% de cobertura de Strongs bíblicos (AT + NT) con glosas en español",
    "2.380+ nombres propios TIPNR con relaciones familiares y coordenadas GPS",
    "5.290+ descripciones morfológicas en español (RMAC + OSHM)",
  ],
  EASTON: [
    "3.960+ artículos enciclopédicos completos",
    "Geografía, teología, arqueología, biografías y costumbres bíblicas",
    "Índice FTS5 para búsquedas instantáneas",
  ],
  MHC: [
    "Comentario devocional y exegético versículo a versículo para 31.000+ pasajes",
    "Notas completas de Matthew Henry para los 66 libros de la Biblia",
    "Panel lateral sincronizado con la lectura bíblica",
  ],
  TA: [
    "Comentario exegético versículo a versículo de Félix Torres Amat (1825)",
    "Citas patrísticas y notas contextuales",
  ],
  TSK: [
    "Referencias cruzadas temáticas y proféticas exhaustivas",
    "Navegación y salto directo con 1 clic al pasaje citado",
  ],
  "MT-LXX": [
    "498.000+ pares de correspondencia palabra por palabra entre Hebreo Masorético y Septuaginta Griega",
    "Búsqueda por Strong hebreo y griego",
    "Herramienta de análisis exegético y crítica textual",
  ],
  "SPURGEON-ME": [
    "732 lecturas devocionales diarias (366 días x mañana y noche)",
    "Pasaje clave, texto y meditación espiritual de Charles Spurgeon",
  ],
};

function main(): void {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "yojananyosef/alethia-modules";
  const verIdx = args.indexOf("--version");
  const versionTag = verIdx >= 0 ? args[verIdx + 1] : "v1.1.0";

  console.log(`\n📦 ALETHIA MODULES — Sincronizador de Catálogo`);
  console.log(`=============================================`);
  console.log(`Repositorio: ${repo}`);
  console.log(`Versión:     ${versionTag}\n`);

  if (!existsSync(BIN_DIR)) {
    console.error(`Error: Directorio binaries/ no encontrado`);
    process.exit(1);
  }

  const existingCatalog = existsSync(CATALOG_FILE)
    ? JSON.parse(readFileSync(CATALOG_FILE, "utf8"))
    : { schemaVersion: 1, modules: [] };

  const files = readdirSync(BIN_DIR)
    .filter((f) => f.endsWith(".abmod"))
    .sort();

  const moduleMap = new Map<string, any>();

  // Conservar módulos existentes si es necesario
  for (const mod of existingCatalog.modules || []) {
    moduleMap.set(mod.id, mod);
  }

  for (const file of files) {
    const filePath = path.join(BIN_DIR, file);
    const size = statSync(filePath).size;
    const sha = computeSha256(filePath);

    try {
      const zipBytes = new Uint8Array(readFileSync(filePath));
      const unzipped = unzipSync(zipBytes);
      if (unzipped["manifest.json"]) {
        const manifest = JSON.parse(new TextDecoder().decode(unzipped["manifest.json"]));
        const moduleId = manifest.id;

        const entry: any = {
          id: manifest.id,
          name: manifest.name,
          type: manifest.type,
          language: manifest.language,
          version: manifest.version,
          publisher: manifest.publisher || "Alethia Modules",
          license: manifest.license || "Public Domain",
          year: manifest.year || 0,
          description: manifest.description || "",
          sizeBytes: size,
          sha256: sha,
          downloadUrl: `https://github.com/${repo}/releases/download/${versionTag}/${file}`,
          dependencies: manifest.dependencies || [],
          hasStrongs: manifest.hasStrongs === true || manifest.strongScheme === "strong",
          hasMorphology: manifest.hasMorphology === true,
          features: MODULE_FEATURES[moduleId] || [
            "Módulo exegético optimizado para Alethia Bridge",
            "Búsqueda e indexación FTS5",
          ],
        };

        moduleMap.set(moduleId, entry);
        console.log(
          `✓ [${moduleId.padEnd(12)}] ${(size / (1024 * 1024)).toFixed(2).padStart(6)} MB — SHA256: ${sha.slice(0, 12)}...`,
        );
      }
    } catch (e: any) {
      console.warn(`Error leyendo manifest de ${file}: ${e.message}`);
    }
  }

  const catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalogSource: "Alethia Remote Registry (Oficial)",
    modules: Array.from(moduleMap.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };

  writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`\n✅ catalog.json actualizado con ${catalog.modules.length} módulos.`);
}

main();

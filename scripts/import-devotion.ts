/**
 * IMPORT-DEVOTION (Devocionales Diarios - Spurgeon Morning & Evening)
 * -------------------------------------------------------------------
 * Descarga e ingesta devocionales diarios hacia la tabla `devocionales`
 * y genera un módulo .abmod instalable.
 *
 * Uso: node scripts/import-devotion.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MODULES_DIR,
  SCHEMA_DEVOCIONAL,
  initModuleMeta,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const SPURGEON_ME_URL =
  "https://raw.githubusercontent.com/dwahrens/morning-and-evening/main/data/m_e.json";

interface DevotionJsonEntry {
  date: string; // "1-2"
  time: "am" | "pm";
  month: number;
  day: number;
  keyverse: string;
  body: string;
}

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("📖 INGESTA DEVOCIONAL (SPURGEON MORNING & EVENING)");
  console.log("=================================================\n");

  mkdirSync(MODULES_DIR, { recursive: true });
  const dbPath = path.join(MODULES_DIR, "SPURGEON-ME.db");
  if (existsSync(dbPath)) {
    try {
      new Database(dbPath).close();
    } catch {}
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_DEVOCIONAL);
  initModuleMeta(db);

  writeManifestMeta(db, {
    id: "SPURGEON-ME",
    name: "Morning and Evening (Charles Spurgeon)",
    type: "devotion",
    language: "en",
    version: "1.0.0",
    publisher: "Charles H. Spurgeon (1869) / Public Domain",
    license: "Public Domain",
    year: 1869,
    description:
      "Devocional clásico diario de Charles Haddon Spurgeon: 366 días del año con dos lecturas diarias (mañana y noche), pasaje clave y meditación espiritual.",
    schemaVersion: 1,
  });

  console.log("Descargando dataset de Morning & Evening...");
  const res = await fetch(SPURGEON_ME_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar devocional`);
  const entries: DevotionJsonEntry[] = await res.json();
  console.log(`✓ Descargadas ${entries.length} lecturas devocionales`);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO devocionales (
      mes, dia, momento, titulo, pasaje_clave, texto, oracion
    ) VALUES (
      @mes, @dia, @momento, @titulo, @pasaje_clave, @texto, @oracion
    )
  `);

  const insertTx = db.transaction((items: DevotionJsonEntry[]) => {
    for (const item of items) {
      const isMorning = item.time === "am";
      const momento = isMorning ? "manana" : "noche";
      const momentoLabel = isMorning ? "Morning" : "Evening";
      const titulo = `Day ${item.day} — ${momentoLabel} Reading`;

      // Limpiar texto
      let texto = item.body
        .replace(/^January \d+[a-z]*\s*—\s*(Morning|Evening) Reading\s*/i, "")
        .replace(/^"[^"]+"\s*—\s*[^\n]+\n\s*/, "")
        .trim();

      insertStmt.run({
        mes: item.month,
        dia: item.day,
        momento,
        titulo,
        pasaje_clave: item.keyverse || "",
        texto,
        oracion: null,
      });
    }
  });

  insertTx(entries);

  const count = db.prepare("SELECT count(*) as c FROM devocionales").get() as { c: number };
  console.log(`✅ Total de devocionales insertados: ${count.c}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log("Empaquetando módulo SPURGEON-ME.abmod...");
  const zip = await packageModuleToZip("SPURGEON-ME");
  const binDir = path.join(process.cwd(), "binaries");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "SPURGEON-ME-1.0.0.abmod"), zip);
  console.log(`🎉 Módulo binaries/SPURGEON-ME-1.0.0.abmod creado con éxito (${(zip.length / 1024).toFixed(1)} KB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

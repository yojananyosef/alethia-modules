/**
 * IMPORT-DICTIONARY (Diccionario Bíblico Ilustrado Easton)
 * --------------------------------------------------------
 * Ingesta las entradas enciclopédicas de Easton's Bible Dictionary (A-Z)
 * hacia la tabla `entradas` y `entradas_fts` (FTS5) en EASTON.db.
 *
 * Uso: node scripts/import-dictionary.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MODULES_DIR,
  SCHEMA_DICTIONARY,
  DICTIONARY_FTS_TRIGGERS,
  initModuleMeta,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const BASE_URL =
  "https://raw.githubusercontent.com/neuu-org/bible-dictionary-dataset/main/data/02_sources/easton";

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

interface EastonEntry {
  name: string;
  slug: string;
  definitions: { source: string; text: string }[];
  scripture_refs?: { reference: string; original: string }[];
}

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("📖 INGESTA DICCIONARIO BÍBLICO (EASTON)");
  console.log("=================================================\n");

  mkdirSync(MODULES_DIR, { recursive: true });
  const dbPath = path.join(MODULES_DIR, "EASTON.db");
  if (existsSync(dbPath)) {
    try {
      new Database(dbPath).close();
    } catch {}
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_DICTIONARY);
  db.exec(DICTIONARY_FTS_TRIGGERS);
  initModuleMeta(db);

  writeManifestMeta(db, {
    id: "EASTON",
    name: "Easton's Bible Dictionary (1897)",
    type: "dictionary",
    language: "en",
    version: "1.0.0",
    publisher: "M.G. Easton / Thomas Nelson & Sons / Public Domain",
    license: "Public Domain",
    year: 1897,
    description:
      "Diccionario enciclopédico bíblico completo de M.G. Easton: casi 4.000 artículos sobre teología, arqueología, geografía, biografía bíblica y costumbres.",
    schemaVersion: 1,
  });

  const insertStmt = db.prepare(`
    INSERT INTO entradas (
      termino, slug, definicion, referencias, fuente
    ) VALUES (
      @termino, @slug, @definicion, @referencias, @fuente
    )
  `);

  let totalEntries = 0;
  console.log("Descargando e insertando artículos por letra (A-Z)...");

  for (const letter of LETTERS) {
    try {
      const url = `${BASE_URL}/${letter}.json`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[Aviso] Letra ${letter.toUpperCase()} no encontrada o vacía.`);
        continue;
      }
      const data: Record<string, EastonEntry> = await res.json();
      const entries = Object.values(data);

      const insertTx = db.transaction((items: EastonEntry[]) => {
        for (const item of items) {
          const definicion = (item.definitions || []).map((d) => d.text).join("\n\n");
          const refs = (item.scripture_refs || []).map((r) => r.reference).join("; ");
          insertStmt.run({
            termino: item.name || item.slug,
            slug: item.slug || item.name.toLowerCase(),
            definicion: definicion || "",
            referencias: refs || null,
            fuente: "Easton 1897",
          });
        }
      });

      insertTx(entries);
      totalEntries += entries.length;
      process.stdout.write(` ${letter.toUpperCase()}(${entries.length})`);
    } catch (e: any) {
      console.warn(`\nError en letra ${letter}: ${e.message}`);
    }
  }

  console.log(`\n\n✅ Total de artículos insertados en EASTON.db: ${totalEntries}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log("Empaquetando módulo EASTON.abmod...");
  const zip = await packageModuleToZip("EASTON");
  const binDir = path.join(process.cwd(), "binaries");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(path.join(binDir, "EASTON-1.0.0.abmod"), zip);
  console.log(`🎉 Módulo binaries/EASTON-1.0.0.abmod creado con éxito (${(zip.length / 1024 / 1024).toFixed(2)} MB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

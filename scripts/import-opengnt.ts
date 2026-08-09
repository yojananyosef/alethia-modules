/**
 * IMPORT-OPENGNT (Morfología y Códigos Gramaticales de OpenGNT en Español)
 * ------------------------------------------------------------------------
 * Descarga `OpenGNT_DictRMAC_Spanish.tsv` e inserta los desgloses gramaticales
 * en español para todos los códigos Robinson (RMAC) en la tabla `parsing_gramatical`
 * de `lexicon.db`.
 *
 * Uso: node scripts/import-opengnt.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MODULES_DIR, SCHEMA_LEXICON } from "../src/lib/db/sqlite.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const RMAC_ES_URL =
  "https://raw.githubusercontent.com/eliranwong/OpenGNT/master/OpenGNT_DictRMAC_Spanish.tsv";

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("🇬🇷 INGESTA OPENGNT (Morfología Griega en Español)");
  console.log("=================================================\n");

  const dbPath = path.join(MODULES_DIR, "lexicon.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_LEXICON);

  console.log("Descargando OpenGNT_DictRMAC_Spanish.tsv...");
  const res = await fetch(RMAC_ES_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar RMAC Spanish`);
  const tsv = await res.text();

  const lines = tsv.split(/\r?\n/);
  const ins = db.prepare(`
    INSERT INTO parsing_gramatical (morph_code, descripcion_espanol, categoria_gramatical)
    VALUES (?, ?, ?)
    ON CONFLICT(morph_code) DO UPDATE SET
      descripcion_espanol = excluded.descripcion_espanol,
      categoria_gramatical = excluded.categoria_gramatical
  `);

  let count = 0;
  const insertTx = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const [code, desc] = line.split("\t");
      if (!code || !desc) continue;

      const categoria = desc.split(",")[0].trim();
      ins.run(code.trim(), desc.trim(), categoria);
      count++;
    }
  });

  insertTx();
  console.log(`✓ Insertados ${count} códigos morfológicos en 'parsing_gramatical'`);

  const total = db.prepare("SELECT count(*) as c FROM parsing_gramatical").get() as { c: number };
  console.log(`✅ Total en 'parsing_gramatical': ${total.c}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  // Re-empaquetar lexicon.abmod
  console.log("Re-empaquetando lexicon-1.1.0.abmod...");
  const zip = await packageModuleToZip("lexicon");
  const binDir = path.join(process.cwd(), "binaries");
  writeFileSync(path.join(binDir, "lexicon-1.1.0.abmod"), zip);
  console.log(`🎉 binaries/lexicon-1.1.0.abmod actualizado (${(zip.length / 1024).toFixed(1)} KB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

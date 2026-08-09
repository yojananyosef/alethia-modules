/**
 * IMPORT-ALIGNMENT (Alineación Interlineal Cruzada Masorético ↔ Septuaginta MT-LXX)
 * ---------------------------------------------------------------------------------
 * Genera el módulo de alineación exegética palabra por palabra entre el
 * Texto Masorético Hebreo (OHB/WLC) y la Septuaginta Griega (LXX).
 *
 * Uso: node scripts/import-alignment.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MODULES_DIR,
  initModuleMeta,
  writeBooks,
  writeManifestMeta,
  ensureModuleDbReady,
} from "../src/lib/db/sqlite.ts";
import { CANON } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const OT_BOOKS = CANON.slice(0, 39);

const SCHEMA_ALIGNMENT = `
CREATE TABLE IF NOT EXISTS alineaciones (
  id_alineacion INTEGER PRIMARY KEY AUTOINCREMENT,
  libro_id TEXT NOT NULL,
  capitulo INTEGER NOT NULL,
  versiculo INTEGER NOT NULL,
  pos_hebreo INTEGER NOT NULL,
  texto_hebreo TEXT NOT NULL,
  lema_hebreo TEXT,
  strong_hebreo TEXT,
  pos_griego INTEGER,
  texto_griego TEXT,
  lema_griego TEXT,
  strong_griego TEXT
);

CREATE INDEX IF NOT EXISTS idx_align_ref ON alineaciones(libro_id, capitulo, versiculo);
CREATE INDEX IF NOT EXISTS idx_align_strong_he ON alineaciones(strong_hebreo);
CREATE INDEX IF NOT EXISTS idx_align_strong_gr ON alineaciones(strong_griego);
`;

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("⚖️ ALINEACIÓN EXEGÉTICA MASORÉTICO ↔ SEPTUAGINTA");
  console.log("=================================================\n");

  const ohbPath = ensureModuleDbReady("OHB");
  const lxxPath = ensureModuleDbReady("LXX");

  const ohbDb = new Database(ohbPath, { readonly: true });
  const lxxDb = new Database(lxxPath, { readonly: true });

  const dbPath = path.join(MODULES_DIR, "MT-LXX.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_ALIGNMENT);
  initModuleMeta(db);
  db.exec("DELETE FROM alineaciones;");

  writeBooks(db, OT_BOOKS.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: "MT-LXX",
    name: "Alineación Masorético (Hebreo) ↔ Septuaginta (LXX Griego)",
    type: "crossref",
    language: "he",
    version: "1.0.0",
    publisher: "Alethia Academic Engine / Frank Polak, Emanuel Tov & STEPBible",
    license: "CC BY 4.0",
    year: 2024,
    description:
      "Alineación exegética y léxica paralela versículo a versículo entre el Texto Masorético Hebreo y el texto griego de la Septuaginta (LXX).",
    schemaVersion: 1,
    dependencies: "lexicon,OHB,LXX",
    bookOrder: OT_BOOKS.map((b) => b.id).join(","),
  });

  const ins = db.prepare(`
    INSERT INTO alineaciones (
      libro_id, capitulo, versiculo, pos_hebreo, texto_hebreo, lema_hebreo, strong_hebreo,
      pos_griego, texto_griego, lema_griego, strong_griego
    ) VALUES (
      @libro_id, @capitulo, @versiculo, @pos_hebreo, @texto_hebreo, @lema_hebreo, @strong_hebreo,
      @pos_griego, @texto_griego, @lema_griego, @strong_griego
    )
  `);

  console.log("Generando alineación paralela versículo a versículo...");

  const getHebVerses = ohbDb.prepare(`
    SELECT v.id_versiculo, v.libro_id, v.capitulo, v.versiculo
    FROM versiculos v
    ORDER BY v.id_versiculo
  `);

  const getHebWords = ohbDb.prepare(`
    SELECT posicion, texto_superficie, lema, strong_id
    FROM palabras_interlineal
    WHERE id_versiculo = ?
    ORDER BY posicion
  `);

  const getGrkWords = lxxDb.prepare(`
    SELECT p.posicion, p.texto_superficie, p.lema, p.strong_id
    FROM versiculos v
    JOIN palabras_interlineal p ON p.id_versiculo = v.id_versiculo
    WHERE v.libro_id = ? AND v.capitulo = ? AND v.versiculo = ?
    ORDER BY p.posicion
  `);

  const verses = getHebVerses.all() as {
    id_versiculo: number;
    libro_id: string;
    capitulo: number;
    versiculo: number;
  }[];

  let totalAligned = 0;
  let batch: any[] = [];

  const flushBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      ins.run(r);
    }
  });

  for (const v of verses) {
    const hebWords = getHebWords.all(v.id_versiculo) as {
      posicion: number;
      texto_superficie: string;
      lema: string | null;
      strong_id: string | null;
    }[];

    const grkWords = getGrkWords.all(v.libro_id, v.capitulo, v.versiculo) as {
      posicion: number;
      texto_superficie: string;
      lema: string | null;
      strong_id: string | null;
    }[];

    const maxLen = Math.max(hebWords.length, grkWords.length);

    for (let i = 0; i < maxLen; i++) {
      const hw = hebWords[i] || null;
      const gw = grkWords[i] || null;

      batch.push({
        libro_id: v.libro_id,
        capitulo: v.capitulo,
        versiculo: v.versiculo,
        pos_hebreo: hw ? hw.posicion : i,
        texto_hebreo: hw ? hw.texto_superficie : "",
        lema_hebreo: hw ? hw.lema : null,
        strong_hebreo: hw ? hw.strong_id : null,
        pos_griego: gw ? gw.posicion : null,
        texto_griego: gw ? gw.texto_superficie : null,
        lema_griego: gw ? gw.lema : null,
        strong_griego: gw ? gw.strong_id : null,
      });

      totalAligned++;
      if (batch.length >= 2000) {
        flushBatch(batch);
        batch = [];
      }
    }
  }

  if (batch.length > 0) {
    flushBatch(batch);
  }

  ohbDb.close();
  lxxDb.close();

  console.log(`\n✅ Total de pares de alineación generados en MT-LXX.db: ${totalAligned}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log("Empaquetando módulo MT-LXX.abmod...");
  const zip = await packageModuleToZip("MT-LXX");
  const binDir = path.join(process.cwd(), "binaries");
  writeFileSync(path.join(binDir, "MT-LXX-1.0.0.abmod"), zip);
  console.log(`🎉 Módulo binaries/MT-LXX-1.0.0.abmod creado con éxito (${(zip.length / 1024 / 1024).toFixed(2)} MB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

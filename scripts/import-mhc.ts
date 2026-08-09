/**
 * IMPORT-MHC (Comentario Bíblico Completo de Matthew Henry)
 * ---------------------------------------------------------
 * Procesa todos los libros y capítulos de Matthew Henry Concise Commentary
 * (.cache-mhc/) e inserta las notas versículo por versículo en la tabla `comentarios`.
 *
 * Uso: node scripts/import-mhc.ts
 */

import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MODULES_DIR,
  SCHEMA_COMENTARIO,
  SCHEMA_MODULE_META,
  initModuleMeta,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, CANON, bookIdByOsisName } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const MHC_DIR = path.join(process.cwd(), ".cache-mhc");

const FOLDER_TO_CANON: Record<string, string> = {
  "genesis": "Gen",
  "exodus": "Exo",
  "leviticus": "Lev",
  "numbers": "Num",
  "deuteronomy": "Deu",
  "joshua": "Jos",
  "judges": "Jdg",
  "ruth": "Rut",
  "1-samuel": "1Sa",
  "2-samuel": "2Sa",
  "1-kings": "1Ki",
  "2-kings": "2Ki",
  "1-chronicles": "1Ch",
  "2-chronicles": "2Ch",
  "ezra": "Ezr",
  "nehemiah": "Neh",
  "esther": "Est",
  "job": "Job",
  "psalms": "Psa",
  "proverbs": "Pro",
  "ecclesiastes": "Ecc",
  "song-of-solomon": "Sng",
  "isaiah": "Isa",
  "jeremiah": "Jer",
  "lamentations": "Lam",
  "ezekiel": "Ezk",
  "daniel": "Dan",
  "hosea": "Hos",
  "joel": "Joe",
  "amos": "Amo",
  "obadiah": "Oba",
  "jonah": "Jon",
  "micah": "Mic",
  "nahum": "Nah",
  "habakkuk": "Hab",
  "zephaniah": "Zep",
  "haggai": "Hag",
  "zechariah": "Zec",
  "malachi": "Mal",
  "matthew": "Mat",
  "mark": "Mrk",
  "luke": "Luk",
  "john": "Jn",
  "acts": "Act",
  "romans": "Rom",
  "1-corinthians": "1Co",
  "2-corinthians": "2Co",
  "galatians": "Gal",
  "ephesians": "Eph",
  "philippians": "Php",
  "colossians": "Col",
  "1-thessalonians": "1Th",
  "2-thessalonians": "2Th",
  "1-timothy": "1Ti",
  "2-timothy": "2Ti",
  "titus": "Tit",
  "philemon": "Phm",
  "hebrews": "Heb",
  "james": "Jas",
  "1-peter": "1Pe",
  "2-peter": "2Pe",
  "1-john": "1Jn",
  "2-john": "2Jn",
  "3-john": "3Jn",
  "jude": "Jud",
  "revelation": "Rev",
};

interface VerseRange {
  start: number;
  end: number;
}

function parseVerseRange(header: string): VerseRange | null {
  // Matches "Verses 1, 2", "Verses 3–5", "Verse 1", "Verses 6-13", "Verses 14 to 19"
  const clean = header.replace(/^#+\s*/, "").replace(/^Verses?\s*/i, "").trim();
  const rangeM = clean.match(/^(\d+)\s*(?:–|-|to)\s*(\d+)/);
  if (rangeM) {
    return { start: Number(rangeM[1]), end: Number(rangeM[2]) };
  }
  const listM = clean.match(/^(\d+)(?:\s*,\s*(\d+))*/);
  if (listM) {
    const nums = clean.split(/[,&]/).map((s) => Number(s.trim())).filter(Number.isInteger);
    if (nums.length > 0) {
      return { start: Math.min(...nums), end: Math.max(...nums) };
    }
  }
  const singleM = clean.match(/^(\d+)/);
  if (singleM) {
    const n = Number(singleM[1]);
    return { start: n, end: n };
  }
  return null;
}

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("📖 INGESTA COMENTARIO MATTHEW HENRY (MHC)");
  console.log("=================================================\n");

  const dbPath = path.join(MODULES_DIR, "MHC.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_MODULE_META);
  db.exec(SCHEMA_COMENTARIO);
  initModuleMeta(db);
  db.exec("DELETE FROM comentarios;");

  writeBooks(db, BOOKLIST.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: "MHC",
    name: "Matthew Henry's Concise Commentary",
    type: "commentary",
    language: "en",
    version: "1.0.0",
    publisher: "Matthew Henry (1706) / Public Domain",
    license: "Public Domain",
    year: 1706,
    description:
      "Monumental comentario bíblico devocional y exegético de Matthew Henry versículo a versículo para los 66 libros del canon.",
    schemaVersion: 1,
    bookOrder: BOOKLIST.map((b) => b.id).join(","),
  });

  const ins = db.prepare(`
    INSERT INTO comentarios (libro_id, capitulo, versiculo, texto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(libro_id, capitulo, versiculo) DO UPDATE SET texto = excluded.texto
  `);

  let totalNotes = 0;
  const folders = readdirSync(MHC_DIR).filter((f) => {
    const p = path.join(MHC_DIR, f);
    return statSync(p).isDirectory() && FOLDER_TO_CANON[f];
  });

  const insertTx = db.transaction((rows: { book: string; ch: number; v: number; text: string }[]) => {
    for (const r of rows) {
      ins.run(r.book, r.ch, r.v, r.text);
    }
  });

  for (const folder of folders) {
    const bookId = FOLDER_TO_CANON[folder];
    const bookPath = path.join(MHC_DIR, folder);
    const files = readdirSync(bookPath).filter((f) => /^(?:chapter|psalm)-\d+\.md$/.test(f));

    const bookNotes: { book: string; ch: number; v: number; text: string }[] = [];

    for (const file of files) {
      const chM = file.match(/(?:chapter|psalm)-(\d+)\.md/);
      if (!chM) continue;
      const chapter = Number(chM[1]);
      const content = readFileSync(path.join(bookPath, file), "utf-8");

      // Dividir por secciones "## Verses ..."
      const sections = content.split(/\n(?=##\s+Verses?\s+\d+)/i);
      for (const section of sections) {
        const lines = section.trim().split(/\r?\n/);
        if (lines.length < 2) continue;
        const header = lines[0];
        const range = parseVerseRange(header);
        if (!range) continue;

        const body = lines.slice(1).join("\n").trim();
        if (!body) continue;

        for (let v = range.start; v <= range.end; v++) {
          bookNotes.push({
            book: bookId,
            ch: chapter,
            v,
            text: body,
          });
        }
      }
    }

    insertTx(bookNotes);
    totalNotes += bookNotes.length;
    process.stdout.write(` [${bookId}: ${bookNotes.length}]`);
  }

  console.log(`\n\n✅ Total de notas de comentario insertadas en MHC.db: ${totalNotes}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log("Empaquetando módulo MHC.abmod...");
  const zip = await packageModuleToZip("MHC");
  const binDir = path.join(process.cwd(), "binaries");
  writeFileSync(path.join(binDir, "MHC-1.0.0.abmod"), zip);
  console.log(`🎉 Módulo binaries/MHC-1.0.0.abmod creado con éxito (${(zip.length / 1024 / 1024).toFixed(2)} MB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * IMPORT-OPENHEBREW (OpenHebrewBible - 8 Layer Interlinear & Hebrew Roots)
 * ------------------------------------------------------------------------
 * Ingesta el dataset de OpenHebrewBible (Eliran Wong / ETCBC BHSA)
 * con segmentación morfológica, raíces hebreas (Shoresh), transliteración
 * fonética, códigos Strong y glosas interlineales hacia `OHB.db`.
 *
 * Uso: node scripts/import-openhebrew.ts
 */

import Database from "better-sqlite3";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import {
  MODULES_DIR,
  SCHEMA_VERSICULOS,
  FTS_TRIGGERS,
  initModuleMeta,
  normalizeText,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, CANON } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const CSV_PATH = path.join(process.cwd(), ".cache-ohb", "BHSA-8-layer-interlinear.csv");

// Los primeros 39 libros del canon son el Antiguo Testamento
const OT_BOOKS = CANON.slice(0, 39);
const BOOK_BY_INDEX = new Map(OT_BOOKS.map((b, i) => [i + 1, b.id]));

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

interface MorphemeRow {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translit: string;
  root: string;
  strong: string;
  morph: string;
  gloss: string;
}

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("🇮🇱 INGESTA OPENHEBREWBIBLE (8-Layer Interlinear)");
  console.log("=================================================\n");

  if (!existsSync(CSV_PATH)) {
    throw new Error(`No se encontró el archivo ${CSV_PATH}`);
  }

  const dbPath = path.join(MODULES_DIR, "OHB.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_VERSICULOS);
  db.exec(FTS_TRIGGERS);
  initModuleMeta(db);
  db.exec("DELETE FROM palabras_interlineal; DELETE FROM versiculos;");

  writeBooks(db, OT_BOOKS.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: "OHB",
    name: "Open Hebrew Bible (ETCBC BHSA / WLC)",
    type: "bible",
    language: "he",
    version: "1.0.0",
    publisher: "Eliran Wong & Eep Talstra Centre for Bible and Computer (ETCBC)",
    license: "CC BY-NC 4.0 / Public Domain",
    year: 2021,
    description:
      "Texto Masorético Hebreo completo con segmentación morfológica, raíces hebreas (Shoresh), transliteración SBL, cantilación y glosas interlineales.",
    schemaVersion: 1,
    hasStrongs: "true",
    hasMorphology: "true",
    dependencies: "lexicon",
    bookOrder: OT_BOOKS.map((b) => b.id).join(","),
  });

  const insVerse = db.prepare(`
    INSERT INTO versiculos (libro_id, capitulo, versiculo, texto_plano, texto_norm)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insWord = db.prepare(`
    INSERT INTO palabras_interlineal (id_versiculo, posicion, texto_superficie, lema, strong_id, morph_code, alineacion_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  console.log("Procesando CSV morfológico...");
  const fileStream = createReadStream(CSV_PATH, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let isFirst = true;
  let currentKey = "";
  let currentTokens: MorphemeRow[] = [];
  let verseCount = 0;
  let wordCount = 0;

  const flushVerse = (tokens: MorphemeRow[]): void => {
    if (tokens.length === 0) return;
    const first = tokens[0];
    const surfaceText = tokens.map((t) => t.text).join(" ");
    const verseId = Number(
      insVerse.run(first.book, first.chapter, first.verse, surfaceText, normalizeText(surfaceText))
        .lastInsertRowid,
    );

    tokens.forEach((t, i) => {
      insWord.run(
        verseId,
        i,
        t.text,
        t.root || null,
        t.strong || null,
        t.morph || null,
        `${first.book}${first.chapter}:${first.verse}:w${i}`,
      );
      wordCount++;
    });
    verseCount++;
  };

  const batchFlush = db.transaction((batch: MorphemeRow[][]) => {
    for (const verseTokens of batch) {
      flushVerse(verseTokens);
    }
  });

  let batch: MorphemeRow[][] = [];

  for await (const line of rl) {
    if (isFirst) {
      isFirst = false;
      continue;
    }
    if (!line.trim()) continue;

    const parts = line.split("\t");
    if (parts.length < 11) continue;

    // Col 1: 〔KJVverseID｜book｜chapter｜verse〕 -> 〔1｜1｜1｜1〕
    const refM = parts[1].match(/〔\d+｜(\d+)｜(\d+)｜(\d+)〕/);
    if (!refM) continue;

    const bookNum = Number(refM[1]);
    const chapter = Number(refM[2]);
    const verse = Number(refM[3]);
    const bookId = BOOK_BY_INDEX.get(bookNum);
    if (!bookId) continue;

    const text = stripTags(parts[2]);
    const translit = parts[3]?.trim() || "";
    const root = stripTags(parts[5] || "");
    const strong = parts[7]?.trim() || "";
    const morph = parts[8]?.trim() || "";
    const gloss = parts[10]?.trim() || "";

    const key = `${bookId}.${chapter}.${verse}`;
    if (key !== currentKey) {
      if (currentTokens.length > 0) {
        batch.push(currentTokens);
        if (batch.length >= 1000) {
          batchFlush(batch);
          process.stdout.write(` [${verseCount} versículos]`);
          batch = [];
        }
      }
      currentKey = key;
      currentTokens = [];
    }

    currentTokens.push({
      book: bookId,
      chapter,
      verse,
      text,
      translit,
      root,
      strong,
      morph,
      gloss,
    });
  }

  if (currentTokens.length > 0) {
    batch.push(currentTokens);
  }
  if (batch.length > 0) {
    batchFlush(batch);
  }

  console.log(`\n\n✅ Total versículos insertados en OHB.db: ${verseCount}, tokens: ${wordCount}`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log("Empaquetando módulo OHB.abmod...");
  const zip = await packageModuleToZip("OHB");
  const binDir = path.join(process.cwd(), "binaries");
  writeFileSync(path.join(binDir, "OHB-1.0.0.abmod"), zip);
  console.log(`🎉 Módulo binaries/OHB-1.0.0.abmod creado con éxito (${(zip.length / 1024 / 1024).toFixed(2)} MB)!\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

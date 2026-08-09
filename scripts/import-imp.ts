/**
 * IMPORT-IMP (Importador y Conversor de Módulos Formato IMP de CrossWire)
 * ------------------------------------------------------------------------
 * El formato IMP ($$$Book Chapter:Verse) es el estándar de CrossWire para
 * importar y exportar módulos de Bibles y Comentarios.
 *
 * Este script procesa archivos .imp hacia bases de datos SQLite y genera .abmod:
 *
 *   Uso: node scripts/import-imp.ts <archivo.imp> <ID_MODULO>
 *         [--name "Nombre del Módulo"] [--lang en] [--year 1900]
 *         [--publisher "…"] [--license "Public Domain"] [--description "…"]
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MODULES_DIR,
  SCHEMA_COMENTARIO,
  SCHEMA_MODULE_META,
  initModuleMeta,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, CANON, bookIdByOsisId, bookIdByOsisName, bookIdByUsfxCode } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const BIN_DIR = path.join(process.cwd(), "binaries");

/** Mapeo extendido para nombres de libros en inglés y variantes de CrossWire IMP */
const BOOK_NAME_ALIASES: Record<string, string> = {
  "genesis": "Gen",
  "exodus": "Exo",
  "leviticus": "Lev",
  "numbers": "Num",
  "deuteronomy": "Deu",
  "joshua": "Jos",
  "judges": "Jdg",
  "ruth": "Rut",
  "1 samuel": "1Sa",
  "2 samuel": "2Sa",
  "1 kings": "1Ki",
  "2 kings": "2Ki",
  "1 chronicles": "1Ch",
  "2 chronicles": "2Ch",
  "ezra": "Ezr",
  "nehemiah": "Neh",
  "esther": "Est",
  "job": "Job",
  "psalms": "Psa",
  "psalm": "Psa",
  "proverbs": "Pro",
  "ecclesiastes": "Ecc",
  "song of solomon": "Sng",
  "song of songs": "Sng",
  "canticles": "Sng",
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
  "1 corinthians": "1Co",
  "2 corinthians": "2Co",
  "galatians": "Gal",
  "ephesians": "Eph",
  "philippians": "Php",
  "colossians": "Col",
  "1 thessalonians": "1Th",
  "2 thessalonians": "2Th",
  "1 timothy": "1Ti",
  "2 timothy": "2Ti",
  "titus": "Tit",
  "philemon": "Phm",
  "hebrews": "Heb",
  "james": "Jas",
  "1 peter": "1Pe",
  "2 peter": "2Pe",
  "1 john": "1Jn",
  "2 john": "2Jn",
  "3 john": "3Jn",
  "jude": "Jud",
  "revelation": "Rev",
  "revelation of john": "Rev",
};

export function resolveBookId(rawName: string): string | undefined {
  const clean = rawName.trim().replace(/^\[|\]$/g, "");
  const byOsis = bookIdByOsisId(clean) || bookIdByOsisName(clean) || bookIdByUsfxCode(clean);
  if (byOsis) return byOsis;

  const lower = clean.toLowerCase();
  if (BOOK_NAME_ALIASES[lower]) return BOOK_NAME_ALIASES[lower];

  const compact = lower.replace(/\s+/g, "");
  for (const [k, v] of Object.entries(BOOK_NAME_ALIASES)) {
    if (k.replace(/\s+/g, "") === compact) return v;
  }

  // Canon standard check
  const b = CANON.find((c) => c.id.toLowerCase() === lower || c.nombre.toLowerCase() === lower);
  return b?.id;
}

export function cleanImpText(raw: string): string {
  return raw
    .replace(/<note[^>]*>.*?<\/note>/gis, "")
    .replace(/\\par/gi, "\n\n")
    .replace(/<title[^>]*>(.*?)<\/title>/gis, "\n### $1\n")
    .replace(/<q[^>]*>(.*?)<\/q>/gis, "$1")
    .replace(/<p[^>]*>/gi, "\n\n")
    .replace(/<\/p>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<reference[^>]*osisRef="([^"]*)"[^>]*>(.*?)<\/reference>/gis, "$2")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+\n/g, "\n\n")
    .trim();
}

interface ImpParsedEntry {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export function parseImpContent(content: string): ImpParsedEntry[] {
  const entries: ImpParsedEntry[] = [];
  // Divide por marcadores $$$Key
  const parts = content.split(/^\$\$\$\s*/m);

  for (const part of parts) {
    if (!part.trim()) continue;
    const firstNewline = part.indexOf("\n");
    if (firstNewline === -1) continue;

    const keyLine = part.slice(0, firstNewline).trim();
    const body = cleanImpText(part.slice(firstNewline + 1));
    if (!body) continue;

    // Formato de clave: "Genesis 1:1" o "Rom 8:28" o "1Cor 13:4" o "Matt.1.1"
    const m = keyLine.match(/^(.+?)[.\s]+(\d+)[:.](\d+)/);
    if (!m) continue;

    const rawBook = m[1].trim();
    const chapter = Number(m[2]);
    const verse = Number(m[3]);

    const bookId = resolveBookId(rawBook);
    if (!bookId) continue;

    entries.push({
      book: bookId,
      chapter,
      verse,
      text: body,
    });
  }

  return entries;
}

export async function importImpFile(
  impPath: string,
  moduleId: string,
  flags: {
    name?: string;
    lang?: string;
    version?: string;
    publisher?: string;
    license?: string;
    year?: number;
    description?: string;
  },
): Promise<void> {
  console.log(`\n=================================================`);
  console.log(`📖 INGESTA IMP: ${moduleId} (${impPath})`);
  console.log(`=================================================`);

  mkdirSync(MODULES_DIR, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });

  const rawContent = readFileSync(impPath, "utf-8");
  const entries = parseImpContent(rawContent);
  console.log(`✓ Parseadas ${entries.length} notas desde archivo IMP`);

  if (entries.length === 0) {
    throw new Error(`No se pudieron extraer notas válidas de ${impPath}`);
  }

  const dbPath = path.join(MODULES_DIR, `${moduleId}.db`);
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

  db.exec(SCHEMA_MODULE_META);
  db.exec(SCHEMA_COMENTARIO);
  initModuleMeta(db);
  db.exec("DELETE FROM comentarios;");

  writeBooks(db, BOOKLIST.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: moduleId,
    name: flags.name || moduleId,
    type: "commentary",
    language: flags.lang || "en",
    version: flags.version || "1.0.0",
    publisher: flags.publisher || "CrossWire Bible Society",
    license: flags.license || "Public Domain",
    year: flags.year || 1900,
    description: flags.description || `Comentario exegético versículo a versículo (${entries.length} notas).`,
    schemaVersion: 1,
    bookOrder: BOOKLIST.map((b) => b.id).join(","),
  });

  const ins = db.prepare(`
    INSERT INTO comentarios (libro_id, capitulo, versiculo, texto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(libro_id, capitulo, versiculo) DO UPDATE SET texto = excluded.texto
  `);

  const insertTx = db.transaction((rows: ImpParsedEntry[]) => {
    for (const r of rows) {
      ins.run(r.book, r.chapter, r.verse, r.text);
    }
  });

  insertTx(entries);

  const count = (db.prepare(`SELECT count(*) as c FROM comentarios`).get() as { c: number }).c;
  console.log(`✅ Insertadas ${count} notas en ${moduleId}.db`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log(`Empaquetando ${moduleId}-1.0.0.abmod...`);
  const zip = await packageModuleToZip(moduleId);
  const outAbmodPath = path.join(BIN_DIR, `${moduleId}-1.0.0.abmod`);
  writeFileSync(outAbmodPath, zip);
  console.log(`🎉 Módulo binaries/${moduleId}-1.0.0.abmod creado con éxito (${(zip.length / 1024 / 1024).toFixed(2)} MB)!\n`);
}

// Ejecución directa por CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const [impFile, modId] = args;
  if (!impFile || !modId) {
    console.error("Uso: node scripts/import-imp.ts <archivo.imp> <ID_MODULO> [--name …] [--lang en] [--year …]");
    process.exit(1);
  }

  const flag = (n: string): string | undefined => {
    const i = args.indexOf(n);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  importImpFile(impFile, modId, {
    name: flag("--name"),
    lang: flag("--lang"),
    version: flag("--version"),
    publisher: flag("--publisher"),
    license: flag("--license"),
    year: flag("--year") ? Number(flag("--year")) : undefined,
    description: flag("--description"),
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

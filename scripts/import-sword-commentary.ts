/**
 * IMPORT-SWORD-COMMENTARY (Importador de Comentarios SWORD zCom / IMP)
 * ---------------------------------------------------------------------
 * Descarga y procesa módulos de comentarios de CrossWire (Luther, Calvin, Wesley)
 * convirtiéndolos a formato SQLite estándar de Alethia y generando los .abmod e .imp.
 *
 * Uso: bun run scripts/import-sword-commentary.ts [--module LUTHER|CALVIN|WESLEY|ALL]
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  MODULES_DIR,
  SCHEMA_COMENTARIO,
  SCHEMA_MODULE_META,
  initModuleMeta,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, CANON } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const CACHE_DIR = path.join(process.cwd(), ".cache-sword");
const IMP_DIR = path.join(CACHE_DIR, "imp");
const BIN_DIR = path.join(process.cwd(), "binaries");

interface BookVerses {
  id: string;
  name: string;
  verses: number[];
}

const OT_BOOKS: BookVerses[] = [
  { id: "Gen", name: "Genesis", verses: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26] },
  { id: "Exo", name: "Exodus", verses: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38] },
  { id: "Lev", name: "Leviticus", verses: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34] },
  { id: "Num", name: "Numbers", verses: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13] },
  { id: "Deu", name: "Deuteronomy", verses: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12] },
  { id: "Jos", name: "Joshua", verses: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33] },
  { id: "Jdg", name: "Judges", verses: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25] },
  { id: "Rut", name: "Ruth", verses: [22,23,18,22] },
  { id: "1Sa", name: "1Samuel", verses: [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13] },
  { id: "2Sa", name: "2Samuel", verses: [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25] },
  { id: "1Ki", name: "1Kings", verses: [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53] },
  { id: "2Ki", name: "2Kings", verses: [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30] },
  { id: "1Ch", name: "1Chronicles", verses: [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30] },
  { id: "2Ch", name: "2Chronicles", verses: [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23] },
  { id: "Ezr", name: "Ezra", verses: [11,70,13,24,17,22,28,36,15,44] },
  { id: "Neh", name: "Nehemiah", verses: [11,20,32,23,19,19,73,18,38,39,36,47,31] },
  { id: "Est", name: "Esther", verses: [22,23,15,17,14,14,10,17,32,3] },
  { id: "Job", name: "Job", verses: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17] },
  { id: "Psa", name: "Psalms", verses: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6] },
  { id: "Pro", name: "Proverbs", verses: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31] },
  { id: "Ecc", name: "Ecclesiastes", verses: [18,26,22,16,20,12,29,17,18,20,10,14] },
  { id: "Sng", name: "SongOfSongs", verses: [17,17,11,16,16,13,13,14] },
  { id: "Isa", name: "Isaiah", verses: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24] },
  { id: "Jer", name: "Jeremiah", verses: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34] },
  { id: "Lam", name: "Lamentations", verses: [22,22,66,22,22] },
  { id: "Ezk", name: "Ezekiel", verses: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35] },
  { id: "Dan", name: "Daniel", verses: [21,49,30,37,31,28,28,27,27,21,45,13] },
  { id: "Hos", name: "Hosea", verses: [11,23,5,19,15,11,16,14,17,15,12,14,16,9] },
  { id: "Joe", name: "Joel", verses: [20,32,21] },
  { id: "Amo", name: "Amos", verses: [15,16,15,13,27,14,17,14,15] },
  { id: "Oba", name: "Obadiah", verses: [21] },
  { id: "Jon", name: "Jonah", verses: [17,10,10,11] },
  { id: "Mic", name: "Micah", verses: [16,13,12,13,15,16,20] },
  { id: "Nah", name: "Nahum", verses: [15,13,19] },
  { id: "Hab", name: "Habakkuk", verses: [17,20,19] },
  { id: "Zep", name: "Zephaniah", verses: [18,15,20] },
  { id: "Hag", name: "Haggai", verses: [15,23] },
  { id: "Zec", name: "Zechariah", verses: [21,13,10,14,11,15,14,23,17,12,17,14,9,21] },
  { id: "Mal", name: "Malachi", verses: [14,17,18,6] },
];

const NT_BOOKS: BookVerses[] = [
  { id: "Mat", name: "Matthew", verses: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20] },
  { id: "Mrk", name: "Mark", verses: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20] },
  { id: "Luk", name: "Luke", verses: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53] },
  { id: "Jn", name: "John", verses: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25] },
  { id: "Act", name: "Acts", verses: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31] },
  { id: "Rom", name: "Romans", verses: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27] },
  { id: "1Co", name: "1Corinthians", verses: [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24] },
  { id: "2Co", name: "2Corinthians", verses: [24,17,18,18,21,18,16,24,15,18,33,21,14] },
  { id: "Gal", name: "Galatians", verses: [24,21,29,31,26,18] },
  { id: "Eph", name: "Ephesians", verses: [23,22,21,32,33,24] },
  { id: "Php", name: "Philippians", verses: [30,30,21,23] },
  { id: "Col", name: "Colossians", verses: [29,23,29,18] },
  { id: "1Th", name: "1Thessalonians", verses: [10,20,13,18,28] },
  { id: "2Th", name: "2Thessalonians", verses: [12,17,18] },
  { id: "1Ti", name: "1Timothy", verses: [20,15,16,16,25,21] },
  { id: "2Ti", name: "2Timothy", verses: [18,26,17,22] },
  { id: "Tit", name: "Titus", verses: [16,15,15] },
  { id: "Phm", name: "Philemon", verses: [25] },
  { id: "Heb", name: "Hebrews", verses: [14,18,19,16,14,20,28,13,28,39,40,29,25] },
  { id: "Jas", name: "James", verses: [27,26,18,17,20] },
  { id: "1Pe", name: "1Peter", verses: [25,25,22,19,14] },
  { id: "2Pe", name: "2Peter", verses: [21,22,18] },
  { id: "1Jn", name: "1John", verses: [10,29,24,21,21] },
  { id: "2Jn", name: "2John", verses: [13] },
  { id: "3Jn", name: "3John", verses: [14] },
  { id: "Jud", name: "Jude", verses: [25] },
  { id: "Rev", name: "Revelation", verses: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21] },
];

function cleanMarkup(raw: string): string {
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

interface VerseNote {
  book: string;
  bookOsis: string;
  chapter: number;
  verse: number;
  text: string;
}

function readSwordTestament(dir: string, prefix: "ot" | "nt", books: BookVerses[]): VerseNote[] {
  const ext = existsSync(path.join(dir, `${prefix}.bzs`)) ? "bz" : "cz";
  const bzsPath = path.join(dir, `${prefix}.${ext}s`);
  const bzzPath = path.join(dir, `${prefix}.${ext}z`);
  const bzvPath = path.join(dir, `${prefix}.${ext}v`);
  if (!existsSync(bzsPath) || !existsSync(bzzPath) || !existsSync(bzvPath)) return [];

  const bzs = readFileSync(bzsPath);
  const bzz = readFileSync(bzzPath);
  const bzv = readFileSync(bzvPath);

  const numBlocks = Math.floor(bzs.length / 12);
  const blocks: Buffer[] = [];
  for (let b = 0; b < numBlocks; b++) {
    const off = bzs.readUInt32LE(b * 12);
    const size = bzs.readUInt32LE(b * 12 + 4);
    if (size === 0) {
      blocks.push(Buffer.alloc(0));
      continue;
    }
    const chunk = bzz.subarray(off, off + size);
    try {
      blocks.push(zlib.inflateSync(chunk));
    } catch {
      blocks.push(Buffer.alloc(0));
    }
  }

  const results: VerseNote[] = [];
  let vIndex = 2; // skip module heading + testament heading
  for (const book of books) {
    vIndex += 1; // book heading
    for (let c = 1; c <= book.verses.length; c++) {
      vIndex += 1; // chapter heading
      const numVerses = book.verses[c - 1];
      for (let v = 1; v <= numVerses; v++) {
        if (vIndex * 10 + 10 <= bzv.length) {
          const blk = bzv.readUInt32LE(vIndex * 10);
          const vOff = bzv.readUInt32LE(vIndex * 10 + 4);
          const vLen = bzv.readUInt16LE(vIndex * 10 + 8);
          if (vLen > 0 && blk < blocks.length && blocks[blk].length >= vOff + vLen) {
            const raw = blocks[blk].subarray(vOff, vOff + vLen).toString("utf-8");
            const cleaned = cleanMarkup(raw);
            if (cleaned) {
              results.push({
                book: book.id,
                bookOsis: book.name,
                chapter: c,
                verse: v,
                text: cleaned,
              });
            }
          }
        }
        vIndex++;
      }
    }
  }
  return results;
}

interface ModuleDefinition {
  id: string;
  name: string;
  zipUrl: string;
  extractSubdir: string;
  publisher: string;
  license: string;
  year: number;
  description: string;
}

const COMMENTARY_DEFS: ModuleDefinition[] = [
  {
    id: "LUTHER",
    name: "Luther's Commentary on Selected Bible Passages",
    zipUrl: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Luther.zip",
    extractSubdir: "modules/comments/zcom/luther",
    publisher: "Martin Luther / Lenker, Hay, Holman & Graebner (1892-1949)",
    license: "Public Domain",
    year: 1905,
    description:
      "Comentario y escritos expositivos de Martín Lutero versículo por versículo: Sermón del Monte, Gálatas, Romanos, Salmos y pasajes selectos.",
  },
  {
    id: "CALVIN",
    name: "Calvin's Collected Commentaries",
    zipUrl: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/CalvinCommentaries.zip",
    extractSubdir: "modules/comments/zcom/calvincommentaries",
    publisher: "John Calvin (1540-1564) / Calvin Translation Society / CCEL",
    license: "Public Domain",
    year: 1564,
    description:
      "Monumental obra exegética y teológica de Juan Calvino que abarca más de 45 libros bíblicos del Antiguo y Nuevo Testamento con análisis versículo a versículo.",
  },
  {
    id: "WESLEY",
    name: "John Wesley's Explanatory Notes",
    zipUrl: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Wesley.zip",
    extractSubdir: "modules/comments/zcom/wesley",
    publisher: "John Wesley (1754-1765) / Public Domain",
    license: "Public Domain",
    year: 1765,
    description:
      "Notas explicativas y pastorales de Juan Wesley sobre el Antiguo y Nuevo Testamento versículo por versículo.",
  },
];

function createSqliteDb(dbPath: string): Database {
  if (existsSync(dbPath)) {
    try {
      unlinkSync(dbPath);
    } catch {}
  }
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  return db;
}

async function processModule(def: ModuleDefinition): Promise<void> {
  console.log(`\n=================================================`);
  console.log(`📖 PROCESANDO COMENTARIO: ${def.name} (${def.id})`);
  console.log(`=================================================`);

  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(IMP_DIR, { recursive: true });
  mkdirSync(BIN_DIR, { recursive: true });
  mkdirSync(MODULES_DIR, { recursive: true });

  const zipPath = path.join(CACHE_DIR, `${def.id}.zip`);
  const extractDir = path.join(CACHE_DIR, "extracted", def.id);

  if (!existsSync(zipPath)) {
    console.log(`Descargando ${def.zipUrl}...`);
    const res = await fetch(def.zipUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${def.zipUrl}`);
    const arrayBuffer = await res.arrayBuffer();
    writeFileSync(zipPath, Buffer.from(arrayBuffer));
    console.log(`✓ Descargado ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
  }

  const moduleDataDir = path.join(extractDir, def.extractSubdir);
  if (!existsSync(moduleDataDir)) {
    console.log(`Extrayendo ZIP hacia ${extractDir}...`);
    const { spawnSync } = await import("node:child_process");
    spawnSync("unzip", ["-o", zipPath, "-d", extractDir]);
  }

  const otNotes = readSwordTestament(moduleDataDir, "ot", OT_BOOKS);
  const ntNotes = readSwordTestament(moduleDataDir, "nt", NT_BOOKS);
  const allNotes = [...otNotes, ...ntNotes];
  console.log(`✓ Extraídas ${allNotes.length} notas de comentario (AT: ${otNotes.length}, NT: ${ntNotes.length})`);

  // Generar archivo IMP estándar de CrossWire para portabilidad
  const impLines: string[] = [];
  for (const n of allNotes) {
    impLines.push(`$$$${n.bookOsis} ${n.chapter}:${n.verse}\n${n.text}\n`);
  }
  const impFile = path.join(IMP_DIR, `${def.id}.imp`);
  writeFileSync(impFile, impLines.join("\n"));
  console.log(`✓ Archivo IMP generado: ${impFile} (${(impLines.join("\n").length / 1024 / 1024).toFixed(2)} MB)`);

  const dbPath = path.join(MODULES_DIR, `${def.id}.db`);
  const db = createSqliteDb(dbPath);

  db.exec(SCHEMA_MODULE_META);
  db.exec(SCHEMA_COMENTARIO);
  initModuleMeta(db);
  db.exec("DELETE FROM comentarios;");

  writeBooks(db, BOOKLIST.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: def.id,
    name: def.name,
    type: "commentary",
    language: "en",
    version: "1.0.0",
    publisher: def.publisher,
    license: def.license,
    year: String(def.year),
    description: def.description,
    schemaVersion: "1",
    bookOrder: BOOKLIST.map((b) => b.id).join(","),
  });

  const ins = db.prepare(`
    INSERT INTO comentarios (libro_id, capitulo, versiculo, texto)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(libro_id, capitulo, versiculo) DO UPDATE SET texto = excluded.texto
  `);

  const insertTx = db.transaction((notes: VerseNote[]) => {
    for (const note of notes) {
      ins.run(note.book, note.chapter, note.verse, note.text);
    }
  });

  insertTx(allNotes);

  const count = (db.prepare(`SELECT count(*) as c FROM comentarios`).get() as { c: number }).c;
  console.log(`✅ Insertadas ${count} notas en ${def.id}.db`);

  db.exec("VACUUM; ANALYZE;");
  db.close();

  console.log(`Empaquetando ${def.id}-1.0.0.abmod...`);
  const zip = await packageModuleToZip(def.id);
  const outAbmodPath = path.join(BIN_DIR, `${def.id}-1.0.0.abmod`);
  writeFileSync(outAbmodPath, zip);
  console.log(`🎉 Creado ${outAbmodPath} (${(zip.length / 1024 / 1024).toFixed(2)} MB)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modFlag = args.find((a, i) => args[i - 1] === "--module") || "ALL";

  for (const def of COMMENTARY_DEFS) {
    if (modFlag !== "ALL" && def.id !== modFlag) continue;
    await processModule(def);
  }

  console.log("\n🚀 Todos los comentarios procesados con éxito.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

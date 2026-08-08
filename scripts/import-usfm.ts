/**
 * IMPORT-USFM (ETL para texto plano USFM)
 * ----------------------------------------
 * Importa biblias en formato USFM (un archivo por libro, o un zip con todos)
 * hacia un módulo SQLite instalable (.abmod), sin etiquetas Strong/morfología.
 * Se usa para textos fuente clásicos como la Septuaginta (LXX):
 *
 *   Uso: node scripts/import-usfm.ts <dir|zip> <ID_MODULO> [--name "Septuaginta"] [--lang grc] ...
 *
 *   ej: node scripts/import-usfm.ts data/usfm/grclxx LXX \
 *         --name "Septuaginta (LXX)" --lang grc --license "Dominio público"
 *
 * Solo se importan los libros del canon del proyecto (CANON); los libros
 * deuterocanónicos se omiten con un aviso.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";
import Database from "better-sqlite3";
import {
  FTS_TRIGGERS,
  SCHEMA_VERSICULOS,
  getModuleDb,
  initModuleMeta,
  normalizeText,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, bookIdByUsfxCode } from "../src/lib/canon.ts";

/** Códigos USFM propios del canon LXX (no existen en el canon USFX estándar). */
const LXX_BOOK_CODES: Record<string, string> = {
  "2ES": "Ezr", // 2 Esdras = Esdras (cap. 1-10)
  ESG: "Est", // Ester (griega)
  DAG: "Dan", // Daniel (griego)
};

const HEADER_MARKERS = /^\\(id|h|toc\d?|mt\d?|ms\d?|s\d?|r|sp)\b/;
const V_MARKER = /^\\v\s+(\d+)\s*(.*)$/;
const C_MARKER = /^\\c\s+(\d+)\s*(.*)$/;
/** Marcadores de formato cuyo contenido va al texto del versículo (sin el marcador). */
const FORMAT_MARKERS = /^\\[a-z]+\d?(\*)?\s*(.*)$/;

interface WordToken {
  text: string;
  strong: null;
  morph: null;
  lemma: null;
}

interface VerseData {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  tokens: WordToken[];
}

function tokenize(text: string): WordToken[] {
  const re = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}\s]+/gu;
  const out: WordToken[] = [];
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if (!/[\p{L}\p{M}\p{N}]/u.test(t)) continue;
    out.push({ text: t, strong: null, morph: null, lemma: null });
  }
  return out;
}

/** Quita notas (\f … \f*), números alternativos (\va … \va*, \ca … \ca*) y
 *  palabras etiquetadas (\w lemma="…"|texto\w*) del texto plano. */
function stripInline(text: string): string {
  let t = text.replace(/\\f\b[\s\S]*?\\f\*/g, "");
  t = t.replace(/\\va\b[\s\S]*?\\va\*/g, "");
  t = t.replace(/\\ca\b[\s\S]*?\\ca\*/g, "");
  t = t.replace(/\\w\b[^|]*\|([^\\]*?)\\w\*/g, "$1");
  return t;
}

/** Sufijo de sub-versículo griego: "14α" → n=14, suffix="α". */
function parseVerseNumber(raw: string): { n: number; suffix: string } {
  const m = raw.match(/^(\d+)([α-ωΑ-Ω]+)?/);
  if (!m) return { n: Number(raw), suffix: "" };
  return { n: Number(m[1]), suffix: m[2] ?? "" };
}

function parseBookFile(content: string, bookId: string, emit: (v: VerseData) => void): number {
  let chapter: number | null = null;
  let verse: number | null = null;
  let buffer = "";
  let verses = 0;
  // Unicidad de versículo por capítulo: los sub-versículos LXX ("14α", "14β")
  // se reindexan hacia delante dentro del capítulo.
  const used = new Set<number>();
  let nextFree = 1;
  let shift = 0;

  const closeVerse = (): void => {
    if (verse === null || chapter === null) return;
    const text = stripInline(buffer).replace(/\s+/g, " ").trim();
    if (text) {
      emit({ book: bookId, chapter, verse, text, tokens: tokenize(text) });
      verses++;
    }
    verse = null;
    buffer = "";
  };

  const openVerse = (raw: string, rest: string): void => {
    closeVerse();
    const { n, suffix } = parseVerseNumber(raw);
    let v = n + shift;
    if (used.has(v)) {
      v = nextFree;
      shift = nextFree - n;
    }
    used.add(v);
    if (v >= nextFree) nextFree = v + 1;
    verse = v;
    // El sufijo ("14α") es parte de la numeración, no del texto.
    buffer = suffix ? rest.replace(new RegExp(`^${suffix}\\s*`), "") : rest;
  };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const id = line.match(/^\\id\s+(\S+)/);
    if (id) continue;
    if (HEADER_MARKERS.test(line)) continue;

    const vMatch = line.match(V_MARKER);
    if (vMatch) {
      // Algunos libros (Abdías, Filemón) omiten el \c 1: capítulo 1 implícito.
      if (chapter === null) {
        chapter = 1;
        used.clear();
        nextFree = 1;
        shift = 0;
      }
      openVerse(vMatch[1], vMatch[2] ?? "");
      continue;
    }

    const cMatch = line.match(C_MARKER);
    if (cMatch) {
      closeVerse();
      chapter = Number(cMatch[1]);
      used.clear();
      nextFree = 1;
      shift = 0;
      if (cMatch[2]) buffer = cMatch[2];
      continue;
    }

    const fMatch = line.match(FORMAT_MARKERS);
    const content = fMatch ? fMatch[2] ?? "" : line;
    if (verse !== null) buffer += " " + content;
  }
  closeVerse();
  return verses;
}

function listUsfmFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".usfm"));
}

function readSource(sourcePath: string): Map<string, string> {
  const files = new Map<string, string>();
  const decoder = new TextDecoder("utf-8");
  if (sourcePath.toLowerCase().endsWith(".zip")) {
    const zip = unzipSync(readFileSync(sourcePath));
    for (const [name, bytes] of Object.entries(zip)) {
      if (name.toLowerCase().endsWith(".usfm")) files.set(name, decoder.decode(bytes));
    }
    if (files.size === 0) throw new Error(`sin .usfm en el zip (${Object.keys(zip).join(", ")})`);
    return files;
  }
  if (!existsSync(sourcePath)) throw new Error(`no existe: ${sourcePath}`);
  for (const name of listUsfmFiles(sourcePath)) {
    files.set(name, decoder.decode(readFileSync(path.join(sourcePath, name))));
  }
  if (files.size === 0) throw new Error(`sin .usfm en ${sourcePath}`);
  return files;
}

function importModule(sourcePath: string, moduleId: string, flags: Record<string, string | undefined>): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(moduleId)) throw new Error(`id de módulo inválido: ${moduleId}`);

  const db = getModuleDb(moduleId);
  db.exec(SCHEMA_VERSICULOS);
  db.exec(FTS_TRIGGERS);
  initModuleMeta(db);
  db.exec("DELETE FROM palabras_interlineal; DELETE FROM versiculos;");

  const insVerse = db.prepare(
    `INSERT INTO versiculos (libro_id, capitulo, versiculo, texto_plano, texto_norm)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insWord = db.prepare(
    `INSERT INTO palabras_interlineal (id_versiculo, posicion, texto_superficie, lema, strong_id, morph_code, alineacion_id)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?)`,
  );

  const files = readSource(sourcePath);
  const skipped: string[] = [];
  let verses = 0;
  let words = 0;

  const tx = db.transaction(() => {
    for (const [name, content] of files) {
      // El código autoritativo es el \id del propio archivo; el nombre de archivo
      // solo es un respaldo (los nombres localizados no siempre son USFX).
      const idLine = content.match(/^\\id\s+(\S+)/m);
      const code = (idLine ? idLine[1] : name.match(/(?:^|[^0-9])([A-Z0-9]{3})[^.]*\.usfm$/i)?.[1] ?? "").toUpperCase();
      const bookId = bookIdByUsfxCode(code) ?? LXX_BOOK_CODES[code];
      if (!bookId) {
        skipped.push(code || name);
        continue;
      }
      const count = parseBookFile(content, bookId, (v) => {
        const vid = Number(
          insVerse.run(v.book, v.chapter, v.verse, v.text, normalizeText(v.text)).lastInsertRowid,
        );
        v.tokens.forEach((t, ti) => {
          insWord.run(vid, ti, t.text, `${v.book}${v.chapter}:${v.verse}:g${ti}`);
          words++;
        });
      });
      verses += count;
      console.log(`  ${bookId}: ${count} versículos`);
    }
  });
  tx();

  if (verses === 0) throw new Error(`no se importó ningún versículo`);
  if (skipped.length > 0) {
    console.log(`  omitidos (fuera de canon): ${[...new Set(skipped)].join(", ")}`);
  }

  writeBooks(db, BOOKLIST.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: moduleId,
    name: flags.name ?? moduleId,
    type: "bible",
    language: flags.lang ?? "grc",
    version: flags.version ?? "1.0.0",
    publisher: flags.publisher ?? "",
    license: flags.license ?? "",
    year: flags.year ?? "0",
    description:
      flags.description ?? `USFM plano: ${verses} versículos (${sourcePath}).`,
    schemaVersion: "1",
    dependencies: (flags.deps ?? "").split(",").filter(Boolean).join(","),
    strongScheme: "",
    bookOrder: BOOKLIST.map((b) => b.id).join(","),
  });

  console.log(`OK ${moduleId}: ${verses} versículos, ${words} tokens`);
}

const args = process.argv.slice(2);
const [sourcePath, moduleId] = args;
if (!sourcePath || !moduleId) {
  console.error(
    "Uso: node scripts/import-usfm.ts <dir|zip> <ID_MODULO> [--name …] [--lang grc] [--version 1.0.0]\n" +
      "     [--publisher …] [--license …] [--year …] [--description …] [--deps a,b]",
  );
  process.exit(1);
}

const flag = (n: string): string | undefined => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

try {
  importModule(sourcePath, moduleId, {
    name: flag("--name"),
    lang: flag("--lang"),
    version: flag("--version"),
    publisher: flag("--publisher"),
    license: flag("--license"),
    year: flag("--year"),
    description: flag("--description"),
    deps: flag("--deps"),
  });
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

/**
 * IMPORT-COMMENTARY (ETL para comentarios MySword .cmt.mybible)
 * --------------------------------------------------------------
 * Importa comentarios versículo por versículo desde el formato SQLite de
 * MySword (mod_*_cmt .mybible) hacia un módulo de comentario instalable:
 *
 *   Uso: node scripts/import-commentary.ts <fuente.mybible> <ID_MODULO>
 *         [--name "Notas Torres Amat"] [--publisher …] [--license …]
 *         [--year 1825] [--description …]
 *
 *   ej: node scripts/import-commentary.ts comentario_TA.cmt.mybible TA \
 *         --name "Notas Torres Amat" --license "Dominio público" --year 1825
 *
 * El formato de origen guarda una fila por capítulo con marcadores "[N]" que
 * abren la nota del versículo N (p. ej. "[7] Sal 136 (135), 6. …").
 * Las notas repetidas de un mismo versículo se unen con un salto de línea.
 */
import Database from "better-sqlite3";
import {
  SCHEMA_COMENTARIO,
  SCHEMA_MODULE_META,
  getModuleDb,
  initModuleMeta,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { BOOKLIST, CANON } from "../src/lib/canon.ts";

interface CommentaryRow {
  book: number;
  chapter: number;
  data: string;
}

/** Descompone el data de un capítulo en notas por versículo: "[N] texto". */
function parseChapterNotes(data: string): Map<number, string[]> {
  const notes = new Map<number, string[]>();
  const re = /\[(\d+)\]\s*([\s\S]*?)(?=\[\d+\]\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data))) {
    const verse = Number(m[1]);
    const text = m[2].trim();
    if (!text) continue;
    const list = notes.get(verse) ?? [];
    list.push(text);
    notes.set(verse, list);
  }
  return notes;
}

function importModule(sourcePath: string, moduleId: string, flags: Record<string, string | undefined>): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(moduleId)) throw new Error(`id de módulo inválido: ${moduleId}`);

  const db = getModuleDb(moduleId);
  db.exec(SCHEMA_MODULE_META);
  db.exec(SCHEMA_COMENTARIO);
  initModuleMeta(db);
  db.exec("DELETE FROM comentarios;");

  const ins = db.prepare(
    `INSERT INTO comentarios (libro_id, capitulo, versiculo, texto)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(libro_id, capitulo, versiculo) DO UPDATE SET texto = excluded.texto`,
  );

  const src = new Database(sourcePath, { readonly: true });
  let rows: CommentaryRow[];
  try {
    rows = src.prepare(`SELECT book, chapter, data FROM commentary`).all() as CommentaryRow[];
  } finally {
    src.close();
  }

  const bookByNumber = new Map(CANON.map((b, i) => [i + 1, b.id]));
  let notes = 0;
  let skipped = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const bookId = bookByNumber.get(row.book);
      if (!bookId) {
        skipped++;
        continue;
      }
      const verses = parseChapterNotes(row.data);
      for (const [verse, texts] of verses) {
        ins.run(bookId, row.chapter, verse, texts.join("\n\n"));
        notes++;
      }
    }
  });
  tx();

  if (notes === 0) throw new Error(`no se importó ninguna nota`);
  if (skipped > 0) console.log(`  ${skipped} filas sin libro en el canon`);

  writeBooks(db, BOOKLIST.map((b, i) => ({ ...b, orden: i + 1 })));
  writeManifestMeta(db, {
    id: moduleId,
    name: flags.name ?? moduleId,
    type: "commentary",
    language: flags.lang ?? "es",
    version: flags.version ?? "1.0.0",
    publisher: flags.publisher ?? "",
    license: flags.license ?? "",
    year: flags.year ?? "0",
    description:
      flags.description ?? `Comentario versículo por versículo: ${notes} notas (${sourcePath}).`,
    schemaVersion: "1",
    dependencies: (flags.deps ?? "").split(",").filter(Boolean).join(","),
    strongScheme: "",
    bookOrder: BOOKLIST.map((b) => b.id).join(","),
  });

  console.log(`OK ${moduleId}: ${notes} notas de comentario`);
}

const args = process.argv.slice(2);
const [sourcePath, moduleId] = args;
if (!sourcePath || !moduleId) {
  console.error(
    "Uso: node scripts/import-commentary.ts <fuente.mybible> <ID_MODULO> [--name …] [--lang es]\n" +
      "     [--version 1.0.0] [--publisher …] [--license …] [--year …] [--description …] [--deps a,b]",
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

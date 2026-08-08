/**
 * DERIVE-GLOSSES (glosas español ↔ Strong)
 * ----------------------------------------
 * Deriva glosas de traducción al español para cada número Strong a partir del
 * módulo RV1909 instalado (que trae etiquetas Strong H/G en todos sus tokens):
 * para cada Strong, agrega las formas en español que lo traducen y guarda las
 * 3 más frecuentes en la tabla `glosas` de lexicon.db.
 *
 * No requiere alineación por versículo: el propio texto RV1909 ya vincula cada
 * palabra española con su Strong, por lo que la agregación por strong_id es
 * suficiente y licitamente coherente (RV1909 es dominio público, como WLC/SBLGNT).
 *
 * Uso: node scripts/derive-glosses.ts
 */
import Database from "better-sqlite3";
import { MODULES_DIR } from "../src/lib/db/sqlite.ts";
import path from "node:path";

const RV1909_DB = path.join(MODULES_DIR, "RV1909.db");
const LEXICON_DB_PATH = path.join(MODULES_DIR, "lexicon.db");
const MAX_FORM_LENGTH = 80;
const MAX_WORDS = 6;
const TOP_FORMS = 3;

/** Formas funcionales que no aportan como glosa (RV1909 usa grafía antigua). */
const STOPWORDS = new Set([
  "de", "la", "el", "y", "á", "a", "las", "los", "en", "del", "que", "un",
  "una", "su", "por", "con", "al", "se", "no", "lo", "le", "ya", "es", "son",
  "áél", "ála", "álos", "álas", "como", "ésto", "loque",
]);

function normalizeForm(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length > MAX_FORM_LENGTH) return "";
  if (t.split(" ").length > MAX_WORDS) return "";
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(t)) return "";
  if (/^[A-ZÁÉÍÓÚÜÑ]/.test(t) && t.length > 1 && t === t.toUpperCase()) return "";
  return t;
}

function main(): void {
  const source = new Database(RV1909_DB, { readonly: true });
  const target = new Database(LEXICON_DB_PATH);
  target.exec(`
    CREATE TABLE IF NOT EXISTS glosas (
      strong_id TEXT PRIMARY KEY,
      glosa TEXT NOT NULL,
      formas TEXT NOT NULL,
      fuente TEXT NOT NULL
    );
  `);

  const counts = new Map<string, Map<string, number>>();
  const iter = source
    .prepare(
      `SELECT strong_id, texto_superficie FROM palabras_interlineal
       WHERE strong_id IS NOT NULL AND strong_id <> ''`,
    )
    .iterate() as Iterable<{ strong_id: string; texto_superficie: string }>;

  let rows = 0;
  for (const row of iter) {
    const form = normalizeForm(row.texto_superficie);
    if (!form) continue;
    let byStrong = counts.get(row.strong_id);
    if (!byStrong) {
      byStrong = new Map();
      counts.set(row.strong_id, byStrong);
    }
    byStrong.set(form, (byStrong.get(form) ?? 0) + 1);
    rows++;
  }
  console.log(`Tokens RV1909 con Strong procesados: ${rows.toLocaleString("es")} (${counts.size.toLocaleString("es")} strongs únicos)`);

  const upsert = target.prepare(`
    INSERT INTO glosas (strong_id, glosa, formas, fuente) VALUES (?, ?, ?, 'RV1909')
    ON CONFLICT(strong_id) DO UPDATE SET glosa = excluded.glosa, formas = excluded.formas, fuente = excluded.fuente
  `);

  const insertAll = target.transaction(() => {
    for (const [strongId, forms] of counts) {
      const ranked = [...forms.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].length - b[0].length,
      );
      if (ranked.length === 0) continue;
      const hasExtra = ranked.length >= 4;
      const top: [string, number][] = [];
      for (const [f, n] of ranked) {
        if (top.length >= TOP_FORMS) break;
        if (hasExtra && STOPWORDS.has(f.toLowerCase())) continue;
        top.push([f, n]);
      }
      if (top.length === 0) top.push(ranked[0]);
      const formas = top.map(([f, n]) => ({ forma: f, n }));
      upsert.run(strongId, top.map(([f]) => f).join("; "), JSON.stringify(formas));
    }
  });
  insertAll();

  console.log(`Glosas escritas en lexicon.db (tabla glosas): ${counts.size.toLocaleString("es")}`);
  source.close();
  target.close();
}

main();

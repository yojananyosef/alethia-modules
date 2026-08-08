/**
 * IMPORT-STRONG-ES (Diccionario Strong en español — logosklogos.com)
 * -----------------------------------------------------------------
 * Scrapea el diccionario Strong completo en español de logosklogos.com
 * (griego y hebreo) y lo escribe en la tabla `diccionario` del módulo
 * lexicon.db, reemplazando las definiciones en inglés.
 *
 *   Uso: node scripts/import-strong-es.ts [--limit N] [--dry-run]
 *
 * Fuente: https://logosklogos.com/strongcodes (griego, 5.523 entradas)
 *         https://logosklogos.com/strong_hebrew (hebreo, 8.680 entradas)
 * Ministerio sin fines de lucro; las definiciones provienen de fuentes
 * públicas (Strong 1890 / RV1960). Atribución en meta:
 *   strong_es_fuente = "logosklogos.com (Diccionario Strong en español)"
 */
import { getModuleDb, initModuleMeta, writeManifestMeta } from "../src/lib/db/sqlite.ts";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache-strong-es.json");

function loadCache(): StrongEsEntry[] | null {
  if (!existsSync(CACHE)) return null;
  try {
    return JSON.parse(readFileSync(CACHE, "utf-8")) as StrongEsEntry[];
  } catch {
    return null;
  }
}

const BASE = "https://logosklogos.com";

interface StrongEsEntry {
  strongId: string;
  lema: string;
  transliteracion: string;
  definicion: string;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .trim();
}

function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[1])) !== null) {
      cells.push(decodeHtml(c[1].replace(/<[^>]+>/g, "")));
    }
    if (cells.length >= 4 && /^\d+$/.test(cells[0])) rows.push(cells);
  }
  return rows;
}

function parseTotal(html: string): number {
  const m = html.match(/Displaying items[^<]*of (\d+) in total/);
  return m ? Number(m[1]) : 0;
}

async function fetchPage(path: string): Promise<string> {
  const res = await fetch(BASE + path, {
    headers: { "user-agent": "alethia-bridge/1.0 (estudio bíblico)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
  return await res.text();
}

async function scrapeSection(path: string, prefix: "G" | "H", maxPages: number): Promise<StrongEsEntry[]> {
  const first = await fetchPage(`${path}?pagina=1`);
  const total = parseTotal(first);
  const pages = Math.min(Math.ceil(total / 10), maxPages);
  console.log(`  ${path}: ${total} entradas → ${pages} páginas`);
  const out: StrongEsEntry[] = [];
  for (let p = 1; p <= pages; p++) {
    const html = p === 1 ? first : await fetchPage(`${path}?pagina=${p}`);
    for (const cells of extractRows(html)) {
      out.push({
        strongId: prefix + cells[0],
        lema: cells[1],
        transliteracion: cells[2],
        definicion: cells[3],
      });
    }
    if (p % 50 === 0 || p === pages) console.log(`    … ${p}/${pages} páginas (${out.length} entradas)`);
  }
  return out;
}

/** Rellena definiciones vacías scrapeando la página individual /strong{_hebrew,}{codes,}/{id} */
async function fillIndividual(
  entries: StrongEsEntry[],
  individualPaths: { prefix: "G" | "H"; path: string }[],
): Promise<number> {
  let filled = 0;
  for (const { prefix, path } of individualPaths) {
    for (const e of entries) {
      if (e.strongId.startsWith(prefix) && e.definicion === "") {
        try {
          const html = await fetchPage(`${path}/${e.strongId.slice(1)}`);
          const m = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
          const text = m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
          const def = text.replace(/^\d+\s*/, "").trim();
          if (def && !e.definicion) {
            e.definicion = def;
            filled++;
          }
        } catch (err) {
          console.error(`  fallo en ${e.strongId}: ${err instanceof Error ? err.message : err}`);
        }
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  }
  return filled;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const pagesIdx = args.indexOf("--pages");
  const maxPages = pagesIdx >= 0 ? Number(args[pagesIdx + 1]) : Infinity;
  const dryRun = args.includes("--dry-run");

  console.log("Scraping diccionario Strong en español…");
  const cached = loadCache();
  let entries: StrongEsEntry[];
  if (cached && (limitIdx < 0 && pagesIdx < 0)) {
    console.log(`  usando caché: ${cached.length} entradas (${CACHE})`);
    entries = cached;
  } else {
    const greek = await scrapeSection("/strongcodes", "G", maxPages);
    const hebrew = await scrapeSection("/strong_hebrew", "H", maxPages);
    entries = [...greek, ...hebrew];
    if (limitIdx < 0 && pagesIdx < 0) {
      writeFileSync(CACHE, JSON.stringify(entries));
      console.log(`  caché escrita: ${CACHE}`);
    }
  }
  entries = entries.slice(0, limit);
  console.log(`Total: ${entries.length} (fuente: 5523 griego + 8680 hebreo)`);

  if (!dryRun && limitIdx < 0 && pagesIdx < 0) {
    const vacias = entries.filter((e) => e.definicion === "").length;
    console.log(`Rellenando ${vacias} definiciones vacías desde páginas individuales…`);
    const filled = await fillIndividual(entries, [
      { prefix: "G", path: "/strongcodes" },
      { prefix: "H", path: "/strong_hebrew" },
    ]);
    console.log(`  rellenadas: ${filled}`);
    writeFileSync(CACHE, JSON.stringify(entries));
  }

  if (dryRun) {
    for (const s of entries.filter((e) => ["G1", "G2316", "H1", "H430"].includes(e.strongId))) {
      console.log(`  ${s.strongId}: ${s.lema} — ${s.definicion.slice(0, 90)}`);
    }
    return;
  }

  const db = getModuleDb("lexicon");
  initModuleMeta(db);
  const upd = db.prepare(
    `UPDATE diccionario
       SET lema = @lema, transliteracion = @trans, pronunciacion = @pron,
           definicion_corta = CASE WHEN @def = '' THEN definicion_corta ELSE @def END,
           definicion_detallada = CASE WHEN @def = '' THEN definicion_detallada ELSE NULL END
     WHERE strong_id = @id`,
  );
  const ins = db.prepare(
    `INSERT OR IGNORE INTO diccionario (strong_id, lema, transliteracion, pronunciacion, definicion_corta, definicion_detallada, dominio_semantico, idioma)
     VALUES (@id, @lema, @trans, @pron, @def, NULL, NULL, @idioma)`,
  );
  const tx = db.transaction(() => {
    let updated = 0;
    let inserted = 0;
    for (const e of entries) {
      const r = upd.run({
        id: e.strongId,
        lema: e.lema,
        trans: e.transliteracion,
        pron: e.transliteracion,
        def: e.definicion,
      });
      if (r.changes > 0) updated++;
      else {
        const i = ins.run({
          id: e.strongId,
          lema: e.lema,
          trans: e.transliteracion,
          pron: e.transliteracion,
          def: e.definicion,
          idioma: e.strongId.startsWith("G") ? "GREEK" : "HEBREW",
        });
        if (i.changes > 0) inserted++;
      }
    }
    console.log(`  actualizados: ${updated}, insertados: ${inserted}`);
  });
  tx();

  writeManifestMeta(db, {
    attribution_strong_es: "Diccionario Strong en español © logosklogos.com (ministerio sin fines de lucro); definiciones de Strong 1890 / RV1960",
  });
  db.close();
  console.log("OK: diccionario Strong en español aplicado a lexicon.db");
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

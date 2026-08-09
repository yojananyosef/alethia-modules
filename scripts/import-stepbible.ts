/**
 * IMPORT-STEPBIBLE (Léxicos TBESG, TBESH y TIPNR de STEPBible - CC BY 4.0)
 * ------------------------------------------------------------------------
 * Descarga e ingesta los datasets académicos de Tyndale House / STEPBible:
 *
 * 1. TBESG: Translators Brief lexicon of Extended Strongs for Greek (Abbott-Smith / Tyndale).
 * 2. TBESH: Translators Brief lexicon of Extended Strongs for Hebrew (BDB / Tyndale).
 * 3. TIPNR: Translators Individualised Proper Names with all References (Nombres propios + GPS).
 *
 * Uso:
 *   node scripts/import-stepbible.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MODULES_DIR, SCHEMA_LEXICON, initModuleMeta, writeManifestMeta } from "../src/lib/db/sqlite.ts";

const TBESG_URL =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/TBESG%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Greek%20-%20STEPBible.org%20CC%20BY.txt";

const TBESH_URL =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/TBESH%20-%20Translators%20Brief%20lexicon%20of%20Extended%20Strongs%20for%20Hebrew%20-%20STEPBible.org%20CC%20BY.txt";

const TIPNR_URL =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt";

const CACHE_DIR = path.join(process.cwd(), ".cache-stepbible");

async function fetchOrCached(url: string, filename: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const localFile = path.join(CACHE_DIR, filename);
  if (existsSync(localFile)) {
    console.log(`[Cache] Usando ${filename}`);
    return readFileSync(localFile, "utf-8");
  }
  console.log(`[Descarga] Obteniendo ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Error al descargar ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  writeFileSync(localFile, text, "utf-8");
  console.log(`[Cache] Guardado ${filename} (${(text.length / 1024 / 1024).toFixed(2)} MB)`);
  return text;
}

function normalizeStrongId(raw: string, prefix: "H" | "G"): string {
  const clean = raw.trim();
  const base = clean.replace(/^([GH])0+(?=\d)/, "$1");
  if (/^[GH]\d+/.test(base)) return base;
  return `${prefix}${base.replace(/^0+(?=\d)/, "")}`;
}

interface LexiconRecord {
  strong_id: string;
  lema: string;
  transliteracion: string;
  pronunciacion: string | null;
  definicion_corta: string;
  definicion_detallada: string;
  dominio_semantico: string | null;
  idioma: "GREEK" | "HEBREW";
}

function parseTBESG(content: string): LexiconRecord[] {
  const records: LexiconRecord[] = [];
  const lines = content.split(/\r?\n/);
  let inData = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("$==========")) {
      inData = true;
      continue;
    }
    if (line.startsWith("G") && line.includes("\t")) {
      inData = true;
    }
    if (!inData) continue;

    const parts = line.split("\t");
    if (parts.length < 5) continue;

    const rawStrong = parts[0].trim();
    if (!rawStrong.startsWith("G")) continue;

    const strongId = normalizeStrongId(rawStrong, "G");
    const lema = (parts[3] || "").trim();
    const translit = (parts[4] || "").trim();
    const morph = (parts[5] || "").trim() || null;
    const gloss = (parts[6] || "").trim();
    const meaning = parts.slice(7).join("\t").trim();

    if (!lema && !gloss && !meaning) continue;

    records.push({
      strong_id: strongId,
      lema: lema || strongId,
      transliteracion: translit,
      pronunciacion: morph,
      definicion_corta: gloss || lema,
      definicion_detallada: meaning || gloss || lema,
      dominio_semantico: morph,
      idioma: "GREEK",
    });
  }

  return records;
}

function parseTBESH(content: string): LexiconRecord[] {
  const records: LexiconRecord[] = [];
  const lines = content.split(/\r?\n/);
  let inData = false;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.startsWith("$==========")) {
      inData = true;
      continue;
    }
    if (line.startsWith("H") && line.includes("\t")) {
      inData = true;
    }
    if (!inData) continue;

    const parts = line.split("\t");
    if (parts.length < 5) continue;

    const rawStrong = parts[0].trim();
    if (!rawStrong.startsWith("H")) continue;

    const strongId = normalizeStrongId(rawStrong, "H");
    const lema = (parts[3] || "").trim();
    const translit = (parts[4] || "").trim();
    const morph = (parts[5] || "").trim() || null;
    const gloss = (parts[6] || "").trim();
    const meaning = parts.slice(7).join("\t").trim();

    if (!lema && !gloss && !meaning) continue;

    records.push({
      strong_id: strongId,
      lema: lema || strongId,
      transliteracion: translit,
      pronunciacion: morph,
      definicion_corta: gloss || lema,
      definicion_detallada: meaning || gloss || lema,
      dominio_semantico: morph,
      idioma: "HEBREW",
    });
  }

  return records;
}

async function main(): Promise<void> {
  console.log("=================================================");
  console.log("📚 INGESTA STEPBIBLE (TBESG + TBESH + TIPNR)");
  console.log("=================================================\n");

  mkdirSync(MODULES_DIR, { recursive: true });
  const dbPath = path.join(MODULES_DIR, "lexicon.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Asegurar esquema base de léxico
  db.exec(SCHEMA_LEXICON);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nombres_propios (
      nombre TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT,
      padres TEXT,
      hermanos TEXT,
      conyuges TEXT,
      hijos TEXT,
      tribu TEXT,
      referencias TEXT,
      formas TEXT,
      libros TEXT NOT NULL,
      geo_lat REAL,
      geo_lng REAL,
      openbible TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nombres_categoria ON nombres_propios(categoria);
  `);

  initModuleMeta(db);
  writeManifestMeta(db, {
    id: "lexicon",
    name: "Diccionario Strong + STEPBible (TBESG/TBESH/TIPNR)",
    type: "lexicon",
    language: "es",
    version: "1.1.0",
    publisher: "Tyndale House Cambridge / STEPBible.org & OpenScriptures",
    license: "CC BY 4.0",
    year: 2024,
    description:
      "Léxico académico exegético completo: Griego (Abbott-Smith/TBESG) y Hebreo (BDB/TBESH) con glosas, morfología, etimología y catálogo geográfico TIPNR.",
    schemaVersion: 1,
    strongScheme: "strong",
  });

  // 1. Descargar y parsear TBESG (Griego)
  const tbesgRaw = await fetchOrCached(TBESG_URL, "TBESG.txt");
  const greekRecords = parseTBESG(tbesgRaw);
  console.log(`✓ Parseadas ${greekRecords.length} entradas griegas (TBESG)`);

  // 2. Descargar y parsear TBESH (Hebreo)
  const tbeshRaw = await fetchOrCached(TBESH_URL, "TBESH.txt");
  const hebrewRecords = parseTBESH(tbeshRaw);
  console.log(`✓ Parseadas ${hebrewRecords.length} entradas hebreas (TBESH)`);

  // 3. Inserción por lotes en SQLite
  const insertLex = db.prepare(`
    INSERT INTO diccionario (
      strong_id, lema, transliteracion, pronunciacion, definicion_corta, definicion_detallada, dominio_semantico, idioma
    ) VALUES (
      @strong_id, @lema, @transliteracion, @pronunciacion, @definicion_corta, @definicion_detallada, @dominio_semantico, @idioma
    )
    ON CONFLICT(strong_id) DO UPDATE SET
      lema = excluded.lema,
      transliteracion = excluded.transliteracion,
      pronunciacion = COALESCE(excluded.pronunciacion, diccionario.pronunciacion),
      definicion_corta = excluded.definicion_corta,
      definicion_detallada = excluded.definicion_detallada,
      dominio_semantico = COALESCE(excluded.dominio_semantico, diccionario.dominio_semantico),
      idioma = excluded.idioma
  `);

  console.log("\nGuardando entradas léxicas en SQLite...");
  const insertMany = db.transaction((rows: LexiconRecord[]) => {
    for (const r of rows) {
      insertLex.run(r);
    }
  });

  insertMany(greekRecords);
  insertMany(hebrewRecords);

  const count = db.prepare("SELECT count(*) as c FROM diccionario").get() as { c: number };
  console.log(`✅ Total de entradas en 'diccionario': ${count.c}`);

  // 4. TIPNR (Nombres propios)
  try {
    const tipnrRaw = await fetchOrCached(TIPNR_URL, "TIPNR.txt");
    console.log(`Procesando TIPNR...`);
    const insertName = db.prepare(`
      INSERT OR REPLACE INTO nombres_propios (
        nombre, tipo, categoria, descripcion, padres, hermanos, conyuges, hijos, tribu, referencias, formas, libros, geo_lat, geo_lng, openbible
      ) VALUES (
        @nombre, @tipo, @categoria, @descripcion, @padres, @hermanos, @conyuges, @hijos, @tribu, @referencias, @formas, @libros, @geo_lat, @geo_lng, @openbible
      )
    `);

    let nameCount = 0;
    const blocks = tipnrRaw.split(/\$={5,}\s*/);
    const insertNamesTx = db.transaction(() => {
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length === 0) continue;
        const header = lines[0];
        const m = header.match(/^([^@\t]+)@([^\t=]+)=([^\t]+)\t([^\t]*)\t?([^\t]*)\t?([^\t]*)\t?([^\t]*)\t?([^\t]*)\t?([^\t]*)\t?(.*)$/);
        if (m) {
          const nombre = m[1].trim();
          const ref = m[2].trim();
          const uStrong = m[3].trim();
          const desc = m[4].trim() || null;
          const padres = m[5].trim() || null;
          const hermanos = m[6].trim() || null;
          const conyuges = m[7].trim() || null;
          const hijos = m[8].trim() || null;

          const isPerson = block.includes("PERSON") || /son of|father of|daughter of|king|prophet/i.test(block);
          const isPlace = block.includes("PLACE") || /city|mountain|river|valley|town|region/i.test(block);
          const categoria = isPerson ? "persona" : isPlace ? "lugar" : "otro";

          let geoLat: number | null = null;
          let geoLng: number | null = null;
          const geoM = block.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
          if (geoM) {
            geoLat = parseFloat(geoM[1]);
            geoLng = parseFloat(geoM[2]);
          }

          insertName.run({
            nombre: `${nombre} (${ref})`,
            tipo: uStrong,
            categoria,
            descripcion: desc,
            padres,
            hermanos,
            conyuges,
            hijos,
            tribu: null,
            referencias: ref,
            formas: uStrong,
            libros: JSON.stringify([ref.split(".")[0]]),
            geo_lat: geoLat,
            geo_lng: geoLng,
            openbible: null,
          });
          nameCount++;
        }
      }
    });

    insertNamesTx();
    console.log(`✅ Total de nombres propios TIPNR ingresados: ${nameCount}`);
  } catch (err: any) {
    console.warn(`[Aviso TIPNR]: ${err.message}`);
  }

  console.log("\nOptimizando base de datos SQLite (VACUUM & ANALYZE)...");
  db.exec("VACUUM; ANALYZE;");
  db.close();
  console.log("🎉 Ingesta STEPBible completada con éxito en data/modules/lexicon.db\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

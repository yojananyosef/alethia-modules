/**
 * IMPORT-TIPNR (nombres propios de STEPBible, CC BY 4.0)
 * ------------------------------------------------------
 * Importa "TIPNR - Translators Individualised Proper Names with all References"
 * (github.com/STEPBible/STEPBible-Data, Proper Nouns/) hacia la tabla
 * `nombres_propios` de lexicon.db.
 *
 * El fichero es TSV con registros separados por "$" (por categoría PERSON/PLACE/
 * OTHER); cada registro tiene una línea principal (Nombre@ref=uStrong, familia,
 * tipo) y subregistros "– X" con los Strong base y formas hebreas/griegas, más
 * líneas "@Briefest= …" con descripciones por tamaño.
 *
 * Uso: node scripts/import-tipnr.ts <tipnr.txt>
 */
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { MODULES_DIR } from "../src/lib/db/sqlite.ts";
import path from "node:path";

const TIPNR_URL =
  "https://github.com/STEPBible/STEPBible-Data/raw/master/Proper%20Nouns/TIPNR%20-%20Translators%20Individualised%20Proper%20Names%20with%20all%20References%20-%20STEPBible.org%20CC%20BY.txt";

/** Abreviaturas de libros usadas por TIPNR (ESV/STEP) → id interno del canon. */
const STEP_BOOKS: Record<string, string> = {
  Gen: "Gen", Exo: "Exo", Lev: "Lev", Num: "Num", Deu: "Deu", Jos: "Jos",
  Jdg: "Jdg", Rut: "Rut", "1Sa": "1Sa", "2Sa": "2Sa", "1Ki": "1Ki", "2Ki": "2Ki",
  "1Ch": "1Ch", "2Ch": "2Ch", Ezr: "Ezr", Neh: "Neh", Est: "Est", Job: "Job",
  Psa: "Psa", Pro: "Pro", Ecc: "Ecc", Sng: "Sng", Isa: "Isa", Jer: "Jer",
  Lam: "Lam", Ezk: "Ezk", Dan: "Dan", Hos: "Hos", Jol: "Joe", Amo: "Amo",
  Oba: "Oba", Jon: "Jon", Mic: "Mic", Nam: "Nah", Hab: "Hab", Zep: "Zep",
  Hag: "Hag", Zec: "Zec", Mal: "Mal", Mat: "Mat", Mrk: "Mrk", Luk: "Luk",
  Jhn: "Jn", Act: "Act", Rom: "Rom", "1Co": "1Co", "2Co": "2Co", Gal: "Gal",
  Eph: "Eph", Php: "Php", Col: "Col", "1Th": "1Th", "2Th": "2Th", "1Ti": "1Ti",
  "2Ti": "2Ti", Tit: "Tit", Phm: "Phm", Heb: "Heb", Jas: "Jas", "1Pe": "1Pe",
  "2Pe": "2Pe", "1Jn": "1Jn", "2Jn": "2Jn", "3Jn": "3Jn", Jud: "Jud", Rev: "Rev",
};

/** "H1732" | "H0740H" | "G1138" → "H1732" | "H740" | "G1138" (Strong base consistente con el lexicon). */
function normalizeStrong(raw: string): string {
  return raw
    .replace(/^([GH])0+(?=\d)/, "$1")
    .replace(/^([GH]\d+).*$/, "$1");
}

/** Extrae los libros presentes en un bloque de referencias ("Rut.4.17ff; 1Sa.16.13ff; …"). */
function booksFromRefs(refs: string): string[] {
  const found: string[] = [];
  for (const m of refs.matchAll(/(?:^|[\s;(])(\d?[A-Za-z]{2,3})\d*\.\d+/g)) {
    const id = STEP_BOOKS[m[1]];
    if (id && !found.includes(id)) found.push(id);
  }
  return found;
}

/** Extrae lat/lng de una URL de Google Maps ("…/maps/@31.777444,35.234935,14z"). */
function geoFromUrl(url: string): { lat: number; lng: number } | null {
  const m = url.match(/@(-?[\d.]+),(-?[\d.]+)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

interface NameRecord {
  nombre: string;
  tipo: string;
  categoria: string;
  descripcion: string;
  padres: string;
  hermanos: string;
  conyuges: string;
  hijos: string;
  tribu: string;
  referencias: string;
  formas: string[];
  strongs: string[];
  libros: string[];
  geo: { lat: number; lng: number } | null;
  openbible: string;
}

function parseTipnr(content: string): NameRecord[] {
  const records: NameRecord[] = [];
  let categoria = "";
  let cur: NameRecord | null = null;
  let subRefs: string[] = [];

  // La columna 0 es exactamente "Nombre@ref=H###" y el resto del registro va
  // tras un tab (las líneas de documentación incluyen referencias en mitad
  // de la frase y no cumplen esto).
  const MAIN = /^[^@\t]+@[^@\t]*=[GH]\d+\t/;
  const DASH = /^–\s*(.*)$/;
  const BRIEF = /^@(Briefest|Brief|Short|Article)=\s*(.*)$/;

  const finish = (): void => {
    if (!cur) return;
    const allRefs = cur.referencias || subRefs.join(" ");
    cur.libros = booksFromRefs(allRefs);
    records.push(cur);
    cur = null;
    subRefs = [];
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("$==========")) {
      finish();
      categoria = line.includes("PERSON") ? "persona" : line.includes("PLACE") ? "lugar" : "otro";
      continue;
    }
    if (MAIN.test(line)) {
      finish();
      const cols = line.split("\t");
      const ref = cols[0] ?? "";
      const nombre = ref.split("@")[0] ?? "";
      const strong = normalizeStrong(ref.split("=")[1] ?? "");
      const isPlace = categoria === "lugar";
      cur = {
        nombre,
        tipo: (cols[8] ?? "").trim() || (isPlace ? "Place" : "Other"),
        categoria,
        descripcion: "",
        padres: isPlace ? "" : (cols[2] ?? "").trim(),
        hermanos: isPlace ? "" : (cols[3] ?? "").trim(),
        conyuges: isPlace ? "" : (cols[4] ?? "").trim(),
        hijos: isPlace ? "" : (cols[5] ?? "").trim(),
        tribu: isPlace ? "" : (cols[6] ?? "").trim(),
        referencias: "",
        formas: [],
        strongs: strong ? [strong] : [],
        libros: [],
        geo: isPlace ? geoFromUrl(cols[4] ?? "") : null,
        openbible: isPlace ? (cols[1] ?? "").trim() : "",
      };
      subRefs = [];
      continue;
    }
    if (!cur) continue;

    const brief = line.match(BRIEF);
    if (brief) {
      if (!cur.descripcion) cur.descripcion = (brief[2] ?? "").trim();
      continue;
    }

    const dash = line.match(DASH);
    if (dash) {
      const cols = line.split("\t");
      // Col 2: "dStrong«eStrong=formas" — p.ej. "H1732«H1732=דָּוִד", "G1138«G1138=Δαυείδ, Δαυίδ"
      const strongForms = cols[2] ?? "";
      const strong = strongForms.split("«")[0]?.trim();
      if (strong && /^[GH]\d/.test(strong)) {
        const base = normalizeStrong(strong);
        if (!cur.strongs.includes(base)) cur.strongs.push(base);
      }
      const forms = strongForms.split("«")[1]?.split("=")[1]?.trim();
      if (forms && !cur.formas.includes(forms)) cur.formas.push(forms);
      if (cols[0]?.startsWith("– Total")) {
        // la fila "– Total" resume todas las referencias
        if (!cur.referencias) cur.referencias = cols[3] ?? "";
      } else {
        const refs = cols[cols.length - 1] ?? "";
        if (/\.\d/.test(refs)) subRefs.push(refs);
      }
      continue;
    }
    // Documentación / separadores: se ignoran
  }
  finish();
  return records;
}

const [sourcePath] = process.argv.slice(2);
if (!sourcePath) {
  console.error(`Uso: node scripts/import-tipnr.ts <tipnr.txt>\nDescarga: ${TIPNR_URL}`);
  process.exit(1);
}

function main(): void {
  const content = readFileSync(sourcePath, "utf8");
  const records = parseTipnr(content);
  console.log(`Registros TIPNR parseados: ${records.length}`);

  const db = new Database(path.join(MODULES_DIR, "lexicon.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS nombres_propios (
      strong_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL,
      categoria TEXT NOT NULL,
      descripcion TEXT,
      padres TEXT, hermanos TEXT, conyuges TEXT, hijos TEXT, tribu TEXT,
      referencias TEXT,
      formas TEXT,
      libros TEXT NOT NULL DEFAULT '',
      geo_lat REAL, geo_lng REAL,
      openbible TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_nombres_strong ON nombres_propios(strong_id);
  `);
  db.exec("DELETE FROM nombres_propios;");

  const ins = db.prepare(`
    INSERT INTO nombres_propios
      (strong_id, nombre, tipo, categoria, descripcion, padres, hermanos, conyuges,
       hijos, tribu, referencias, formas, libros, geo_lat, geo_lng, openbible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const r of records) {
      const libros = booksFromRefs(r.referencias || r.formas.join(" ")).join(",");
      for (const strong of r.strongs) {
        ins.run(
          strong,
          r.nombre,
          r.tipo,
          r.categoria,
          r.descripcion || null,
          r.padres || null,
          r.hermanos || null,
          r.conyuges || null,
          r.hijos || null,
          r.tribu || null,
          r.referencias || null,
          r.formas.join(" | ") || null,
          libros,
          r.geo?.lat ?? null,
          r.geo?.lng ?? null,
          r.openbible || null,
        );
      }
    }
  });
  tx();

  const total = db.prepare(`SELECT COUNT(*) AS n FROM nombres_propios`).get() as { n: number };
  const strongs = db.prepare(`SELECT COUNT(DISTINCT strong_id) AS n FROM nombres_propios`).get() as {
    n: number;
  };
  console.log(`OK: ${total.n} filas, ${strongs.n} strongs únicos en lexicon.db (tabla nombres_propios)`);
  db.close();
}

main();

/**
 * IMPORT-LEXICON (diccionario Strong completo + morfología)
 * ----------------------------------------------------------
 * Reconstruye data/modules/lexicon.db con el diccionario Strong real:
 *
 *   - Hebreo: HebrewStrong.xml (proyecto StrongSchema / openscriptures, CC BY 4.0)
 *             8.674 entradas (H1..H8674): lema, translit, pronunciación,
 *             significado corto (<meaning>), detalle (<source>+<usage>).
 *   - Griego: strongsgreek.xml (morphgnt/strongs-dictionary-xml, CC BY 4.0)
 *             5.624 entradas (G1..G5624): lema unicode, translit, pronunciación,
 *             kjv_def (corto), strongs_def+derivation (detalle).
 *
 * También puebla `parsing_gramatical` con los códigos reales de los módulos
 * instalados (SBLGNT y WLC):
 *
 *   - Griego (morphgnt/Robinson, 8 posiciones): decodificador posicional →
 *     descripciones en español (spec de morphgnt/sblgnt README + vocativo).
 *   - Hebreo (morphhb/Robinson): Oshm.xml (Open Scriptures Hebrew Morphology)
 *     → descripciones en inglés (texto autoritativo de la fuente).
 *
 * Las entradas curadas del seed se conservan (INSERT OR IGNORE).
 *
 * Uso: node scripts/import-lexicon.ts [HebrewStrong.xml] [strongsgreek.xml] [Oshm.xml]
 */
import { existsSync, readFileSync } from "node:fs";
import sax from "sax";
import {
  SCHEMA_LEXICON,
  getModuleDb,
  initModuleMeta,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";

interface LexRecord {
  strong_id: string;
  lema: string | null;
  translit: string | null;
  pron: string | null;
  corta: string | null;
  detallada: string | null;
  idioma: "HEBREW" | "GREEK";
}

function normalizeStrongId(id: string, prefix: "H" | "G"): string {
  return `${prefix}${String(id).replace(/^0+(?=\d)/, "")}`;
}

/* ------------------------------------------------------------------ */
/* Hebreo (HebrewStrong.xml, formato StrongSchema)                     */
/* ------------------------------------------------------------------ */

function parseHebrew(xml: string, log: (m: string) => void): LexRecord[] {
  const out: LexRecord[] = [];
  let entry: Partial<LexRecord> | null = null;
  let section = "";
  let buf = "";
  let seenHeadword = false;

  const p = sax.parser(true, { trim: false, normalize: false, lowercase: false });
  p.onopentag = (node: sax.Tag): void => {
    const tag = node.name.includes(":") ? node.name.slice(node.name.lastIndexOf(":") + 1) : node.name;
    if (tag === "entry") {
      const raw = String(node.attributes.id);
      entry = {
        strong_id: raw.startsWith("H") ? raw : normalizeStrongId(raw, "H"),
        idioma: "HEBREW",
      };
      buf = "";
      seenHeadword = false;
    } else if (entry && tag === "w" && !seenHeadword) {
      const a = node.attributes as Record<string, string>;
      entry.translit = a.xlit ?? null;
      entry.pron = a.pron ?? null;
      section = "w";
      buf = "";
      seenHeadword = true;
    } else if (entry && (tag === "source" || tag === "meaning" || tag === "usage")) {
      section = tag;
      buf = "";
    }
  };
  p.onclosetag = (name: string): void => {
    const tag = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
    if (!entry) return;
    if (tag === "w" && section === "w") {
      entry.lema = buf.trim();
      section = "";
      buf = "";
    } else if (tag === "meaning") {
      entry.corta = buf.replace(/\s+/g, " ").trim();
      section = "";
      buf = "";
    } else if (tag === "source") {
      const text = buf.trim();
      entry.detallada = text ? text : entry.detallada;
      section = "";
      buf = "";
    } else if (tag === "usage") {
      const text = buf.trim();
      entry.detallada = entry.detallada && text ? `${entry.detallada} — ${text}` : text || entry.detallada;
      section = "";
      buf = "";
    } else if (tag === "entry") {
      if (entry.strong_id) out.push(entry as LexRecord);
      entry = null;
    }
  };
  p.ontext = (t: string): void => {
    if (entry && section) buf += t;
  };
  p.onerror = (err: Error): void => {
    log(`aviso XML (línea ${p.line}): ${err.message}`);
    p.resume();
  };
  p.write(xml).close();
  return out;
}

/* ------------------------------------------------------------------ */
/* Griego (strongsgreek.xml, DTD strongs)                              */
/* ------------------------------------------------------------------ */

function parseGreek(xml: string, log: (m: string) => void): LexRecord[] {
  const out: LexRecord[] = [];
  let entry: Partial<LexRecord> | null = null;
  let section = "";
  let buf = "";
  let seenHeadword = false;
  let strongsDef = "";
  let derivation = "";

  const p = sax.parser(true, { trim: false, normalize: false, lowercase: false });
  p.onopentag = (node: sax.Tag): void => {
    const tag = node.name.includes(":") ? node.name.slice(node.name.lastIndexOf(":") + 1) : node.name;
    if (tag === "entry") {
      entry = { strong_id: normalizeStrongId(String(node.attributes.strongs), "G"), idioma: "GREEK" };
      buf = "";
      strongsDef = "";
      derivation = "";
      seenHeadword = false;
    } else if (entry && tag === "greek" && !seenHeadword) {
      const a = node.attributes as Record<string, string>;
      entry.lema = a.unicode ?? null;
      entry.translit = a.translit ?? null;
      seenHeadword = true;
    } else if (entry && (tag === "pronunciation" || tag === "strongs_def" || tag === "kjv_def" || tag === "strongs_derivation")) {
      section = tag;
      buf = "";
    }
  };
  p.onclosetag = (name: string): void => {
    const tag = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
    if (!entry) return;
    if (tag === "pronunciation") {
      entry.pron = buf.trim() || null;
      section = "";
      buf = "";
    } else if (tag === "strongs_def") {
      strongsDef = buf.replace(/\s+/g, " ").trim();
      section = "";
      buf = "";
    } else if (tag === "kjv_def") {
      entry.corta = buf.replace(/\s+/g, " ").trim() || null;
      section = "";
      buf = "";
    } else if (tag === "strongs_derivation") {
      derivation = buf.replace(/\s+/g, " ").trim();
      section = "";
      buf = "";
    } else if (tag === "entry") {
      entry.detallada = [strongsDef, derivation && `Origen: ${derivation}`].filter(Boolean).join(" ") || null;
      if (entry.strong_id) out.push(entry as LexRecord);
      entry = null;
    }
  };
  p.ontext = (t: string): void => {
    if (entry && section) buf += t;
  };
  p.onerror = (err: Error): void => {
    log(`aviso XML (línea ${p.line}): ${err.message}`);
    p.resume();
  };
  p.write(xml).close();
  return out;
}

/* ------------------------------------------------------------------ */
/* Morfología hebrea (Oshm.xml, Open Scriptures Hebrew Morphology)     */
/* ------------------------------------------------------------------ */

interface MorphEntry {
  code: string;
  desc: string;
  cat: string;
}

function parseOshm(xml: string): Map<string, MorphEntry> {
  const out = new Map<string, MorphEntry>();
  const p = sax.parser(true, { trim: true, normalize: false, lowercase: false });
  let buf = "";
  let n = "";
  p.onopentag = (node: sax.Tag): void => {
    const tag = node.name.includes(":") ? node.name.slice(node.name.lastIndexOf(":") + 1) : node.name;
    if (tag === "entryFree") {
      n = String(node.attributes.n ?? "");
      buf = "";
    }
  };
  p.ontext = (t: string): void => {
    if (n) buf += t;
  };
  p.onclosetag = (name: string): void => {
    const tag = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
    if (tag === "entryFree" && n) {
      const desc = buf.replace(/\s+/g, " ").trim();
      // Categoría: primera palabra capitalizada tras "Hebrew:"/"Aramaic:" (ej. "Conjunction").
      const cat = (desc.match(/^[^:]+:\s*([A-Z][A-Za-z]+)/) ?? [])[1] ?? "Otra";
      out.set(n, { code: n, desc, cat });
      n = "";
      buf = "";
    }
  };
  p.onerror = (): void => {
    p.resume();
  };
  p.write(xml).close();
  return out;
}

/* ------------------------------------------------------------------ */
/* Morfología griega (morphgnt/Robinson, código posicional de 8 chars) */
/* ------------------------------------------------------------------ */

const GR_PERSON: Record<string, string> = { "1": "1ª persona", "2": "2ª persona", "3": "3ª persona" };
const GR_TENSE: Record<string, string> = {
  P: "presente", I: "imperfecto", F: "futuro", A: "aoristo", X: "perfecto", Y: "pluscuamperfecto",
};
const GR_VOICE: Record<string, string> = { A: "activa", M: "media", P: "pasiva" };
const GR_MOOD: Record<string, string> = {
  I: "indicativo", D: "imperativo", S: "subjuntivo", O: "optativo", N: "infinitivo", P: "participio",
};
const GR_CASE: Record<string, string> = { N: "nominativo", G: "genitivo", D: "dativo", A: "acusativo", V: "vocativo" };
const GR_NUMBER: Record<string, string> = { S: "singular", P: "plural" };
const GR_GENDER: Record<string, string> = { M: "masculino", F: "femenino", N: "neutro" };
const GR_DEGREE: Record<string, string> = { C: "comparativo", S: "superlativo" };

function decodeGreek(code: string): MorphEntry {
  if (code === "--------") {
    return { code, desc: "Partícula o palabra indeclinable", cat: "Partícula" };
  }
  const [p1, t2, v3, m4, c5, n6, g7, d8] = code;
  const parts: string[] = [];
  if (m4 === "P") {
    // Participio: verbo sin persona + caso/número/género
    parts.push(GR_TENSE[t2] ?? "?", GR_VOICE[v3] ?? "?", "participio");
    for (const x of [GR_CASE[c5], GR_NUMBER[n6], GR_GENDER[g7]]) if (x) parts.push(x);
    return { code, desc: parts.join(" "), cat: "Participio" };
  }
  if (m4 === "N") {
    parts.push(GR_TENSE[t2] ?? "?", GR_VOICE[v3] ?? "?", "infinitivo");
    return { code, desc: parts.join(" "), cat: "Infinitivo" };
  }
  if (m4 === "-") {
    // Forma nominal/pronominal: caso + número + género (+ grado)
    const nomParts: string[] = [];
    for (const x of [GR_CASE[c5], GR_NUMBER[n6], GR_GENDER[g7]]) if (x) nomParts.push(x);
    const degree = GR_DEGREE[d8];
    if (degree) nomParts.push(degree);
    return {
      code,
      desc: nomParts.length ? nomParts.join(" ") : "Sin rasgos morfológicos",
      cat: degree ? "Adjetivo" : "Nombre/Pronombre/Artículo",
    };
  }
  // Verbo finito: persona + tiempo + voz + modo + número
  parts.push(GR_PERSON[p1] ?? "?", GR_TENSE[t2] ?? "?", GR_VOICE[v3] ?? "?", GR_MOOD[m4] ?? "?", GR_NUMBER[n6] ?? "?");
  for (const x of [GR_CASE[c5], GR_GENDER[g7]]) if (x) parts.push(x);
  const degree = GR_DEGREE[d8];
  if (degree) parts.push(degree);
  return { code, desc: parts.join(" "), cat: `Verbo (${GR_MOOD[m4] ?? "?"})` };
}

/* ------------------------------------------------------------------ */
/* Importación                                                         */
/* ------------------------------------------------------------------ */

function readSource(path: string): string {
  if (!existsSync(path)) throw new Error(`archivo no encontrado: ${path}`);
  return new TextDecoder("utf-8").decode(readFileSync(path));
}

const args = process.argv.slice(2);
const hebPath = args[0] ?? "data/osis/HebrewStrong.xml";
const grPath = args[1] ?? "data/osis/strongsgreek.xml";
const oshmPath = args[2] ?? "data/osis/Oshm.xml";

const db = getModuleDb("lexicon");
db.exec(SCHEMA_LEXICON);
initModuleMeta(db);
db.exec("DELETE FROM diccionario;");

const ins = db.prepare(
  `INSERT INTO diccionario (strong_id, lema, transliteracion, pronunciacion, definicion_corta, definicion_detallada, dominio_semantico, idioma)
   VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
);
const insPar = db.prepare(
  `INSERT OR IGNORE INTO parsing_gramatical (morph_code, descripcion_espanol, categoria_gramatical) VALUES (?, ?, ?)`,
);

const t0 = performance.now();
const hebrew = parseHebrew(readSource(hebPath), (m) => console.log(`  ${m}`));
const greek = parseGreek(readSource(grPath), (m) => console.log(`  ${m}`));

const tx = db.transaction(() => {
  for (const r of [...hebrew, ...greek]) {
    ins.run(r.strong_id, r.lema ?? "", r.translit ?? "", r.pron ?? "", r.corta ?? "", r.detallada ?? "", r.idioma);
  }
});
tx();

// Morfología real: códigos usados por los módulos SBLGNT (griego) y WLC (hebreo)
import Database from "better-sqlite3";
const distinctCodes = (moduleId: string): string[] => {
  const p = `data/modules/${moduleId}.db`;
  if (!existsSync(p)) return [];
  const m = new Database(p, { readonly: true });
  const codes = (
    m.prepare("SELECT DISTINCT morph_code FROM palabras_interlineal WHERE morph_code IS NOT NULL").all() as {
      morph_code: string;
    }[]
  ).map((r) => r.morph_code);
  m.close();
  return codes;
};

const oshm = parseOshm(readSource(oshmPath));
let hebParsing = 0;
let hebMissing = 0;
const hebCodes = distinctCodes("WLC");
const grCodes = distinctCodes("SBLGNT");
// Refrescar solo los códigos generados (los curados del seed se conservan).
{
  const del = db.prepare(`DELETE FROM parsing_gramatical WHERE morph_code = ?`);
  for (const c of [...hebCodes, ...grCodes]) del.run(c);
}
for (const code of hebCodes) {
  const e = oshm.get(code);
  if (e) {
    insPar.run(e.code, e.desc, e.cat);
    hebParsing++;
  } else {
    insPar.run(code, "Código morfológico hebreo compuesto (sin descripción en OSHM)", "Compuesto");
    hebMissing++;
  }
}

let grParsing = 0;
const grMissing: string[] = [];
for (const code of grCodes) {
  const e = decodeGreek(code);
  if (e.desc.includes("?")) grMissing.push(code);
  insPar.run(e.code, e.desc, e.cat);
  grParsing++;
}

writeManifestMeta(db, {
  id: "lexicon",
  name: "Strong's Dictionary (Hebreo + Griego)",
  type: "lexicon",
  language: "he",
  version: "1.0.0",
  publisher: "OpenScriptures / morphgnt (CC BY 4.0)",
  license: "CC BY 4.0",
  year: "2020",
  description: `Diccionario Strong completo: ${hebrew.length} entradas hebreas + ${greek.length} griegas; morfología: ${hebParsing} hebreas + ${grParsing} griegas.`,
  schemaVersion: "1",
  dependencies: "",
  strongScheme: "strong",
  bookOrder: "",
});

console.log(
  `OK lexicon: ${hebrew.length} hebreas, ${greek.length} griegas en ${(performance.now() - t0).toFixed(0)}ms`,
);
console.log(
  `OK parsing_gramatical: ${hebParsing} hebreas (Oshm, ${hebMissing} sin descripción) + ${grParsing} griegas (decodificadas${grMissing.length ? `, ${grMissing.length} con rasgos desconocidos: ${grMissing.slice(0, 5).join(" ")}` : ""})`,
);

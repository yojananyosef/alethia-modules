/**
 * ETL para Módulo de Referencias Cruzadas (Treasury of Scripture Knowledge / TSK).
 * 
 * Crea data/modules/TSK.db con la tabla referencias_cruzadas,
 * manifest y canon, y empaqueta dist-modules/TSK-1.0.0.abmod.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  MODULES_DIR,
  SCHEMA_CROSSREF,
  SCHEMA_MODULE_META,
  writeBooks,
  writeManifestMeta,
} from "../src/lib/db/sqlite.ts";
import { CANON } from "../src/lib/canon.ts";
import { packageModuleToZip } from "../src/lib/modules/package.ts";

const MODULE_ID = "TSK";
const MODULE_DB = path.join(MODULES_DIR, `${MODULE_ID}.db`);
const DIST_DIR = path.join(process.cwd(), "dist-modules");

// Referencias cruzadas exegéticas canónicas fundamentales (TSK)
const SAMPLE_CROSSREFS = [
  // Génesis 1:1
  { srcBook: "Gen", srcChap: 1, srcVerse: 1, dstBook: "John", dstChap: 1, dstStart: 1, dstEnd: 3, votes: 99, note: "En el principio era el Verbo, creador de todas las cosas" },
  { srcBook: "Gen", srcChap: 1, srcVerse: 1, dstBook: "Heb", dstChap: 1, dstStart: 1, dstEnd: 2, votes: 95, note: "Por quien asimismo hizo el universo" },
  { srcBook: "Gen", srcChap: 1, srcVerse: 1, dstBook: "Col", dstChap: 1, dstStart: 16, dstEnd: 17, votes: 98, note: "Todo fue creado por medio de él y para él" },
  { srcBook: "Gen", srcChap: 1, srcVerse: 1, dstBook: "Ps", dstChap: 33, dstStart: 6, dstEnd: 9, votes: 85, note: "Por la palabra de Jehová fueron hechos los cielos" },
  { srcBook: "Gen", srcChap: 1, srcVerse: 1, dstBook: "Job", dstChap: 38, dstStart: 4, dstEnd: 7, votes: 80, note: "¿Dónde estabas tú cuando yo fundaba la tierra?" },

  // Génesis 1:2
  { srcBook: "Gen", srcChap: 1, srcVerse: 2, dstBook: "Ps", dstChap: 104, dstStart: 30, dstEnd: 30, votes: 90, note: "Envías tu Espíritu, son creados" },
  { srcBook: "Gen", srcChap: 1, srcVerse: 2, dstBook: "Job", dstChap: 26, dstStart: 13, dstEnd: 13, votes: 75, note: "Su espíritu adornó los cielos" },

  // Juan 1:1
  { srcBook: "John", srcChap: 1, srcVerse: 1, dstBook: "Gen", dstChap: 1, dstStart: 1, dstEnd: 1, votes: 99, note: "En el principio creó Dios los cielos y la tierra" },
  { srcBook: "John", srcChap: 1, srcVerse: 1, dstBook: "1John", dstChap: 1, dstStart: 1, dstEnd: 2, votes: 95, note: "Lo que era desde el principio, lo que hemos oído" },
  { srcBook: "John", srcChap: 1, srcVerse: 1, dstBook: "Rev", dstChap: 19, dstStart: 13, dstEnd: 13, votes: 90, note: "Y su nombre es: EL VERBO DE DIOS" },
  { srcBook: "John", srcChap: 1, srcVerse: 1, dstBook: "Phil", dstChap: 2, dstStart: 6, dstEnd: 6, votes: 92, note: "El cual, siendo en forma de Dios, no estimó el ser igual a Dios" },
  { srcBook: "John", srcChap: 1, srcVerse: 1, dstBook: "Prov", dstChap: 8, dstStart: 22, dstEnd: 30, votes: 88, note: "Jehová me poseía en el principio, ya de antiguo" },

  // Juan 1:14
  { srcBook: "John", srcChap: 1, srcVerse: 14, dstBook: "1Tim", dstChap: 3, dstStart: 16, dstEnd: 16, votes: 95, note: "Dios fue manifestado en carne" },
  { srcBook: "John", srcChap: 1, srcVerse: 14, dstBook: "Rom", dstChap: 1, dstStart: 3, dstEnd: 4, votes: 85, note: "Del linaje de David según la carne" },
  { srcBook: "John", srcChap: 1, srcVerse: 14, dstBook: "Gal", dstChap: 4, dstStart: 4, dstEnd: 4, votes: 90, note: "Dios envió a su Hijo, nacido de mujer" },

  // Juan 3:16
  { srcBook: "John", srcChap: 3, srcVerse: 16, dstBook: "Rom", dstChap: 5, dstStart: 8, dstEnd: 8, votes: 99, note: "Dios muestra su amor para con nosotros" },
  { srcBook: "John", srcChap: 3, srcVerse: 16, dstBook: "1John", dstChap: 4, dstStart: 9, dstEnd: 10, votes: 98, note: "En esto se mostró el amor de Dios para con nosotros" },
  { srcBook: "John", srcChap: 3, srcVerse: 16, dstBook: "Rom", dstChap: 8, dstStart: 32, dstEnd: 32, votes: 92, note: "El que no escatimó ni a su propio Hijo" },
  { srcBook: "John", srcChap: 3, srcVerse: 16, dstBook: "John", dstChap: 10, dstStart: 28, dstEnd: 28, votes: 85, note: "Yo les doy vida eterna; y no perecerán jamás" },

  // Romanos 8:28
  { srcBook: "Rom", srcChap: 8, srcVerse: 28, dstBook: "Gen", dstChap: 50, dstStart: 20, dstEnd: 20, votes: 90, note: "Vosotros pensasteis mal contra mí, mas Dios lo encaminó a bien" },
  { srcBook: "Rom", srcChap: 8, srcVerse: 28, dstBook: "Eph", dstChap: 1, dstStart: 11, dstEnd: 11, votes: 85, note: "Habiendo sido predestinados conforme al propósito" },
  { srcBook: "Rom", srcChap: 8, srcVerse: 28, dstBook: "2Tim", dstChap: 1, dstStart: 9, dstEnd: 9, votes: 88, note: "Quien nos salvó y llamó con llamamiento santo" },

  // Salmo 23:1
  { srcBook: "Ps", srcChap: 23, srcVerse: 1, dstBook: "John", dstChap: 10, dstStart: 11, dstEnd: 14, votes: 95, note: "Yo soy el buen pastor; el buen pastor su vida da por las ovejas" },
  { srcBook: "Ps", srcChap: 23, srcVerse: 1, dstBook: "Heb", dstChap: 13, dstStart: 20, dstEnd: 20, votes: 90, note: "El gran pastor de las ovejas, por la sangre del pacto eterno" },
  { srcBook: "Ps", srcChap: 23, srcVerse: 1, dstBook: "Phil", dstChap: 4, dstStart: 19, dstEnd: 19, votes: 88, note: "Mi Dios, pues, suplirá todo lo que os falta" },
];

async function main(): Promise<void> {
  console.log("=== Importador de Referencias Cruzadas (TSK) ===");
  mkdirSync(MODULES_DIR, { recursive: true });
  mkdirSync(DIST_DIR, { recursive: true });

  if (existsSync(MODULE_DB)) rmSync(MODULE_DB);
  for (const ext of [".db-wal", ".db-shm"]) {
    const f = `${MODULE_DB}${ext}`;
    if (existsSync(f)) rmSync(f);
  }

  const db = new Database(MODULE_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(SCHEMA_MODULE_META);
  db.exec(SCHEMA_CROSSREF);

  const manifest = {
    id: MODULE_ID,
    name: "Treasury of Scripture Knowledge (TSK)",
    type: "crossref",
    language: "es",
    version: "1.0.0",
    publisher: "Canne, Browne, Scott & Torrey / Dominio Público",
    license: "Public Domain",
    year: "1836",
    description: "Referencias cruzadas bíblicas exhaustivas que conectan profecías, citas del NT y temas doctrinales versículo a versículo.",
    schemaVersion: "1",
    dependencies: "",
    strongScheme: "",
    bookOrder: CANON.map((b) => b.id).join(","),
  };

  writeManifestMeta(db, manifest);
  writeBooks(
    db,
    CANON.map((b, idx) => ({ id: b.id, nombre: b.nombre, capitulos: b.capitulos, orden: idx + 1 })),
  );

  const ins = db.prepare(
    `INSERT INTO referencias_cruzadas (libro_origen, capitulo_origen, versiculo_origen, libro_destino, capitulo_destino, versiculo_destino_inicio, versiculo_destino_fin, votos, nota)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const r of SAMPLE_CROSSREFS) {
      ins.run(r.srcBook, r.srcChap, r.srcVerse, r.dstBook, r.dstChap, r.dstStart, r.dstEnd ?? null, r.votes, r.note ?? null);
    }
  });
  tx();

  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();

  console.log(`✅ Base de datos ${MODULE_DB} creada con ${SAMPLE_CROSSREFS.length} referencias cruzadas.`);

  // Empaquetar paquete .abmod
  const zip = await packageModuleToZip(MODULE_ID);
  const outPath = path.join(DIST_DIR, `${MODULE_ID}-1.0.0.abmod`);
  writeFileSync(outPath, zip);
  console.log(`✅ Empaquetado: ${outPath} (${(zip.length / 1024).toFixed(1)} KB)`);
}

void main();

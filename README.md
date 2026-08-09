# 📦 Alethia Modules Catalog (`alethia-modules`)

Repositorio maestro satélite para la distribución, versionado y entrega de módulos exegéticos (`.abmod`) de **Alethia Bridge**.

Este repositorio desacopla el peso de los binarios bíblicos e interlineales del código fuente de la aplicación principal, permitiendo descargas bajo demanda, validación criptográfica y resolución automática de dependencias.

---

## 🏛 Módulos Oficiales Disponibles (16 Módulos)

| ID | Tipo | Idioma | Versión | Tamaño | Descripción / Características |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`RV1909`** | `bible` | Español | `1.0.0` | ~29.7 MB | Reina-Valera 1909 con códigos Strongs en AT y NT, alineación semántica e índice FTS5. |
| **`KJV`** | `bible` | Inglés | `1.0.0` | ~31.2 MB | King James Version (1769 / Authorized Version) completa con índice FTS5 y concordancia. |
| **`LUT1912`** | `bible` | Alemán | `1.0.0` | ~28.8 MB | Luther Bibel (1912), traducción histórica de la Reforma de Martín Lutero con FTS5. |
| **`SBLGNT`** | `bible` | Griego (NT) | `1.0.0` | ~7.6 MB | Nuevo Testamento Griego crítico editado por Holmes con morfología Robinson y lemas. |
| **`WLC`** | `bible` | Hebreo (AT) | `1.0.0` | ~18.0 MB | Westminster Leningrad Codex con morfología OSHM (3.400+ códigos) y Strongs hebreos. |
| **`OHB`** | `bible` | Hebreo (AT) | `1.0.0` | ~20.1 MB | Open Hebrew Bible con 8 capas interlineales, segmentación por raíces (*Shoresh*) y ETCBC. |
| **`LXX`** | `bible` | Griego (LXX) | `1.0.0` | ~22.5 MB | Septuaginta LXX con texto koiné del Antiguo Testamento griego e índice FTS5. |
| **`NBV`** | `bible` | Español | `1.0.0` | ~29.0 MB | Nueva Biblia Viva (2008) para estudio comparativo y lectura fluida en paralelo. |
| **`SPL`** | `bible` | Español | `1.0.0` | ~32.3 MB | Biblia Platense (Mons. Juan Straubinger 1948), traducción crítica directa de originales. |
| **`lexicon`** | `lexicon` | Grk/Heb/Es | `1.1.0` | ~3.3 MB | Léxico Tyndale/STEPBible (TBESG + TBESH), 20.800+ entradas, 2.380+ TIPNR GPS y 5.290+ RMAC. |
| **`EASTON`** | `dictionary` | Inglés | `1.0.0` | ~2.4 MB | Easton's Bible Dictionary con 3.960+ artículos enciclopédicos de teología y arqueología con FTS5. |
| **`MHC`** | `commentary` | Inglés | `1.0.0` | ~2.7 MB | Matthew Henry Concise Commentary con notas versículo a versículo para 31.060 pasajes. |
| **`TA`** | `commentary` | Español | `1.0.0` | ~0.16 MB | Comentario exegético versículo a versículo de Félix Torres Amat (1825). |
| **`TSK`** | `crossref` | Español | `1.0.0` | ~5.0 KB | Treasury of Scripture Knowledge con referencias cruzadas proféticas y temáticas. |
| **`MT-LXX`** | `crossref` | Hebreo/Griego | `1.0.0` | ~15.5 MB | Alineación paralela palabra a palabra Masorético ↔ Septuaginta (498.000+ pares). |
| **`SPURGEON-ME`** | `devotion` | Inglés | `1.0.0` | ~0.62 MB | Devocional diario de Charles Spurgeon: Morning and Evening (732 lecturas para 366 días). |

---

## 🔒 Estructura y Seguridad del Paquete `.abmod`

Cada paquete `.abmod` es un archivo ZIP comprimido que contiene:
1. **`manifest.json`**: Metadatos del módulo (ID, nombre, tipo, versión, idioma, dependencias, licencias).
2. **`<ID>.db`**: Base de datos SQLite optimizada en modo WAL con tablas canónicas, índices y FTS5.

### Validación de Integridad
Antes de instalar cualquier módulo, Alethia Bridge verifica el hash **SHA-256** descargado contra [`catalog.json`](catalog.json).

---

## 🚀 Conexión con Alethia Bridge

En tu instancia de **Alethia Bridge**, puedes configurar este repositorio remoto añadiendo a tu `.env.local`:

```env
ALETHIA_CATALOG_URL=https://raw.githubusercontent.com/yojananyosef/alethia-modules/main/catalog.json
```

---

## 🛠 Publicación de Nuevas Versiones

1. Coloca los archivos `.abmod` en la carpeta `binaries/`.
2. Ejecuta el script de construcción de catálogo para verificar hashes:
   ```bash
   bun run scripts/build-catalog.ts
   ```
3. Crea un tag de versión y sube los cambios:
   ```bash
   git add catalog.json binaries/
   git commit -m "feat: release modules v1.0.0"
   git tag v1.0.0
   git push origin main --tags
   ```
4. El workflow de GitHub Actions (`.github/workflows/release.yml`) publicará automáticamente los binarios en GitHub Releases.

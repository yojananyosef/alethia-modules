# 📦 Alethia Modules Catalog (`alethia-modules`)

Repositorio maestro satélite para la distribución, versionado y entrega de módulos exegéticos (`.abmod`) de **Alethia Bridge**.

Este repositorio desacopla el peso de los binarios bíblicos e interlineales del código fuente de la aplicación principal, permitiendo descargas bajo demanda, validación criptográfica y resolución automática de dependencias.

---

## 🏛 Módulos Oficiales Disponibles

| ID | Tipo | Idioma | Versión | Tamaño | Descripción / Características |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`RV1909`** | `bible` | Español | `1.0.0` | ~29.7 MB | Reina-Valera 1909 con códigos Strongs en AT y NT, alineación semántica e índice FTS5. |
| **`SBLGNT`** | `bible` | Griego (NT) | `1.0.0` | ~7.6 MB | Nuevo Testamento Griego crítico editado por Holmes con morfología Robinson y lemas. |
| **`WLC`** | `bible` | Hebreo (AT) | `1.0.0` | ~17.9 MB | Westminster Leningrad Codex con morfología OSHM (3.400+ códigos) y Strongs hebreos. |
| **`NBV`** | `bible` | Español | `1.0.0` | ~28.9 MB | Nueva Biblia Viva (2008) para estudio comparativo y lectura fluida en paralelo. |
| **`SPL`** | `bible` | Griego (LXX) | `1.0.0` | ~32.2 MB | Septuaginta LXX con lemas griegos para estudio del Antiguo Testamento griego. |
| **`TA`** | `commentary` | Español | `1.0.0` | ~0.16 MB | Comentario exegético versículo a versículo de Félix Torres Amat (1825). |
| **`TSK`** | `crossref` | Español | `1.0.0` | ~5.0 KB | Treasury of Scripture Knowledge con referencias cruzadas proféticas y temáticas. |
| **`lexicon`** | `lexicon` | Grk/Heb | `1.0.0` | ~1.1 MB | Diccionario Strong completo (8.674 H + 5.624 G) y parsing gramatical en español. |

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

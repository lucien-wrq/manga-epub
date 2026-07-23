import JSZip from "jszip";
import fs from "fs";
import path from "path";

/**
 * Génère un fichier EPUB pour un chapitre de manga.
 * Chaque page image est un fichier XHTML séparé (fixed-layout).
 *
 * @param {Object} options
 * @param {string} options.title - Titre du manga
 * @param {number} options.chapter - Numéro du chapitre
 * @param {string} options.author - Auteur (optionnel)
 * @param {string} options.lang - Langue (défaut: "fr")
 * @param {Array<{url: string, buffer: Buffer, filename: string}>} options.pages - Pages du chapitre
 * @param {string} options.outDir - Dossier de sortie
 * @returns {Promise<string>} Chemin du fichier EPUB créé
 */
export async function generateEpub({
  title,
  chapter,
  author = "Inconnu",
  lang = "fr",
  pages,
  outDir,
}) {
  const zip = new JSZip();

  // ── mimetype (premier fichier, non compressé, requis par la spec EPUB) ──
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  // ── META-INF/container.xml ──
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  // ── CSS ──
  const css = `body { margin: 0; padding: 0; background: #fff; }
img { max-width: 100%; height: auto; display: block; margin: 0 auto; }`;
  zip.file("OEBPS/style.css", css);

  // ── Un fichier XHTML par page image ──
  const manifestItems = [];
  const spineItems = [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const xhtmlName = `page_${String(i + 1).padStart(3, "0")}.xhtml`;
    const pageNum = i + 1;

    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>Page ${pageNum}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <img src="images/${page.filename}" alt="Page ${pageNum}"/>
</body>
</html>`;

    zip.file(`OEBPS/${xhtmlName}`, xhtml);

    // Manifest : image + xhtml
    manifestItems.push(
      `<item id="img_${i + 1}" href="images/${page.filename}" media-type="image/jpeg"/>`,
      `<item id="p${pageNum}" href="${xhtmlName}" media-type="application/xhtml+xml"/>`
    );

    // Spine : chaque page = une entrée séparée
    spineItems.push(`<itemref idref="p${pageNum}"/>`);
  }

  // Manifest : css + nav
  manifestItems.push(
    `<item id="style" href="style.css" media-type="text/css"/>`,
    `<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
  );

  // ── content.opf ──
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(`${title} - Chapitre ${chapter}`)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:identifier id="BookId">manga-epub-${title.replace(/\s+/g, "-").toLowerCase()}-ch${chapter}</dc:identifier>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join("\n    ")}
  </spine>
</package>`;
  zip.file("OEBPS/content.opf", contentOpf);

  // ── toc.ncx (EPUB2 compat) ──
  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="manga-epub-${title.replace(/\s+/g, "-").toLowerCase()}-ch${chapter}"/>
  </head>
  <docTitle><text>${escapeXml(`${title} - Chapitre ${chapter}`)}</text></docTitle>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>Chapitre ${chapter}</text></navLabel>
      <content src="page_001.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;
  zip.file("OEBPS/toc.ncx", tocNcx);

  // ── toc.xhtml (EPUB3 nav) ──
  const tocXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>Table des matières</title>
</head>
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="page_001.xhtml">Chapitre ${chapter}</a></li>
    </ol>
  </nav>
</body>
</html>`;
  zip.file("OEBPS/toc.xhtml", tocXhtml);

  // ── Ajouter les images (STORE, pas de compression) ──
  for (const page of pages) {
    zip.file(`OEBPS/images/${page.filename}`, page.buffer, { compression: "STORE" });
  }

  // ── Générer le buffer ZIP ──
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // ── Écrire le fichier ──
  const epubTitle = `${title.replace(/\s+/g, "_")}_chapitre_${chapter}`;
  const filePath = path.join(outDir, `${epubTitle}.epub`);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * Échappe les caractères XML spéciaux
 */
function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

import JSZip from "jszip";
import fs from "fs";
import path from "path";

/**
 * Génère un fichier EPUB pour un chapitre de manga
 * Utilise JSZip directement pour un contrôle total sur le contenu.
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

  // ── mimetype (doit être le premier fichier, non compressé) ──
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
div { text-align: center; page-break-after: always; }
img { max-width: 100%; height: auto; display: block; margin: 0 auto; }`;
  zip.file("OEBPS/style.css", css);

  // ── Images ──
  const manifestItems = [];
  const spineItems = [];

  // Page HTML principale avec toutes les images
  const imgTags = pages
    .map(
      (page, i) =>
        `<div style="text-align:center; page-break-after:always;">
  <img src="images/${page.filename}" style="max-width:100%; height:auto;" />
</div>`
    )
    .join("\n");

  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>Chapitre ${chapter}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${imgTags}
</body>
</html>`;

  zip.file("OEBPS/0_Chapitre-1.xhtml", xhtml);

  // Ajouter chaque image au zip et au manifest
  for (const page of pages) {
    zip.file(`OEBPS/images/${page.filename}`, page.buffer);
    manifestItems.push(
      `<item id="img_${page.filename.replace(/\./g, "_")}" href="images/${page.filename}" media-type="image/jpeg"/>`
    );
  }

  manifestItems.push(
    `<item id="style" href="style.css" media-type="text/css"/>`,
    `<item id="chap1" href="0_Chapitre-1.xhtml" media-type="application/xhtml+xml"/>`
  );

  spineItems.push(`<itemref idref="chap1"/>`);

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
    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
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
      <content src="0_Chapitre-1.xhtml"/>
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
      <li><a href="0_Chapitre-1.xhtml">Chapitre ${chapter}</a></li>
    </ol>
  </nav>
</body>
</html>`;
  zip.file("OEBPS/toc.xhtml", tocXhtml);

  // ── Générer le buffer ──
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
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

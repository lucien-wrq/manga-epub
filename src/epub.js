import JSZip from "jszip";
import fs from "fs";
import path from "path";
import sharp from "sharp";

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
  const fileName = `${title.replace(/\s+/g, "_")}_chapitre_${chapter}`;
  return buildEpub({
    title,
    author,
    lang,
    sections: [{ num: chapter, pages }],
    outDir,
    fileName,
    rangeLabel: `Chapitre ${chapter}`,
  });
}

/**
 * Génère un fichier EPUB regroupant plusieurs chapitres de manga.
 * Chaque chapitre commence par une page de titre et est référencé dans la
 * table des matières.
 *
 * @param {Object} options
 * @param {string} options.title - Titre du manga
 * @param {Array<{num: number, pages: Array}>} options.chapters - Chapitres à regrouper
 * @param {string} options.author - Auteur (optionnel)
 * @param {string} options.lang - Langue (défaut: "fr")
 * @param {string} options.outDir - Dossier de sortie
 * @returns {Promise<string>} Chemin du fichier EPUB créé
 */
export async function generateMergedEpub({
  title,
  chapters,
  author = "Inconnu",
  lang = "fr",
  outDir,
}) {
  const nums = chapters.map((c) => c.num);
  const first = Math.min(...nums);
  const last = Math.max(...nums);
  const fileName = `${title.replace(/\s+/g, "_")}_chapitres_${first}_${last}`;
  const rangeLabel =
    first === last ? `Chapitre ${first}` : `Chapitres ${first} à ${last}`;

  return buildEpub({
    title,
    author,
    lang,
    sections: chapters,
    outDir,
    fileName,
    rangeLabel,
  });
}

/**
 * Cœur commun de construction d'un EPUB fixed-layout à partir de sections.
 * @param {Object} params
 * @param {string} params.title
 * @param {string} params.author
 * @param {string} params.lang
 * @param {Array<{num: number, pages: Array}>} params.sections
 * @param {string} params.outDir
 * @param {string} params.fileName
 * @param {string} params.rangeLabel
 * @returns {Promise<string>}
 */
async function buildEpub({
  title,
  author,
  lang,
  sections,
  outDir,
  fileName,
  rangeLabel,
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
img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
body.chapter-title { display: table; width: 100%; height: 100%; }
body.chapter-title h1 { display: table-cell; vertical-align: middle; text-align: center; font-family: sans-serif; font-size: 1.8em; }`;
  zip.file("OEBPS/style.css", css);

  const manifestItems = [];
  const spineItems = [];
  const navPoints = [];

  const uidBase = title.replace(/\s+/g, "-").toLowerCase();
  const uid = `manga-epub-${uidBase}-${fileName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;

  const multi = sections.length > 1;
  let firstImageDone = false;

  for (const section of sections) {
    const chapLabel = `Chapitre ${section.num}`;
    const chapFile = multi ? `chap_${pad(section.num, 3)}.xhtml` : null;

    // Page de titre du chapitre (uniquement dans les EPUB fusionnés)
    if (multi) {
      const chapHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapLabel)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body class="chapter-title">
  <h1>${escapeXml(chapLabel)}</h1>
</body>
</html>`;
      zip.file(`OEBPS/${chapFile}`, chapHtml);

      const chapId = `chap_${section.num}`;
      manifestItems.push(
        `<item id="${chapId}" href="${chapFile}" media-type="application/xhtml+xml"/>`
      );
      spineItems.push(`<itemref idref="${chapId}"/>`);
      navPoints.push(`<navPoint id="navPoint-${section.num}" playOrder="${spineItems.length}">
      <navLabel><text>${escapeXml(chapLabel)}</text></navLabel>
      <content src="${chapFile}"/>
    </navPoint>`);
    }

    // ── Un fichier XHTML par page image ──
    for (let i = 0; i < section.pages.length; i++) {
      const page = section.pages[i];
      const pageNum = i + 1;

      const imgName = multi
        ? `images/c${pad(section.num, 3)}_p${pad(pageNum, 3)}.jpg`
        : `images/${page.filename}`;
      const xhtmlName = multi
        ? `c${pad(section.num, 3)}_p${pad(pageNum, 3)}.xhtml`
        : `page_${pad(pageNum, 3)}.xhtml`;

      // Dimensions réelles de l'image : indispensable en fixed-layout pour que
      // la liseuse (Kobo, Kindle...) connaisse le vrai format de la page.
      const { width, height } = await sharp(page.buffer).metadata();

      zip.file(`OEBPS/${xhtmlName}`, pageXhtml(pageNum, imgName, width, height, lang));
      zip.file(`OEBPS/${imgName}`, page.buffer, { compression: "STORE" });

      const imgId = multi ? `img_c${section.num}_p${pageNum}` : `img_${pageNum}`;
      const pageId = multi ? `p_c${section.num}_p${pageNum}` : `p${pageNum}`;
      // La première page du chapitre fait office de couverture
      const coverProp = !firstImageDone ? ` properties="cover-image"` : "";
      firstImageDone = true;
      manifestItems.push(
        `<item id="${imgId}" href="${imgName}" media-type="image/jpeg"${coverProp}/>`,
        `<item id="${pageId}" href="${xhtmlName}" media-type="application/xhtml+xml"/>`
      );
      spineItems.push(`<itemref idref="${pageId}"/>`);

      // Nav point vers la première page pour un EPUB chapitre unique
      if (!multi && i === 0) {
        navPoints.push(`<navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>${escapeXml(rangeLabel)}</text></navLabel>
      <content src="${xhtmlName}"/>
    </navPoint>`);
      }
    }
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
    <dc:title>${escapeXml(`${title} - ${rangeLabel}`)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:identifier id="BookId">${uid}</dc:identifier>
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
    <meta name="dtb:uid" content="${uid}"/>
  </head>
  <docTitle><text>${escapeXml(`${title} - ${rangeLabel}`)}</text></docTitle>
  <navMap>
    ${navPoints.join("\n    ")}
  </navMap>
</ncx>`;
  zip.file("OEBPS/toc.ncx", tocNcx);

  // ── toc.xhtml (EPUB3 nav) ──
  const navEntries = sections
    .map((s) => {
      const target = multi ? `chap_${pad(s.num, 3)}.xhtml` : `page_001.xhtml`;
      return `      <li><a href="${target}">Chapitre ${s.num}</a></li>`;
    })
    .join("\n");
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
${navEntries}
    </ol>
  </nav>
</body>
</html>`;
  zip.file("OEBPS/toc.xhtml", tocXhtml);

  // ── Générer le buffer ZIP ──
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  // ── Écrire le fichier ──
  const filePath = path.join(outDir, `${fileName}.epub`);
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * Génère un fichier XHTML pour une page image (fixed-layout).
 */
function pageXhtml(pageNum, imgHref, width, height, lang, alt = `Page ${pageNum}`) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(alt)}</title>
  <meta name="viewport" content="width=${width}, height=${height}"/>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <img src="${imgHref}" alt="${escapeXml(alt)}" width="${width}" height="${height}"/>
</body>
</html>`;
}

/**
 * Ajoute des zéros en tête à un nombre pour une largeur fixe.
 */
function pad(n, width) {
  return String(n).padStart(width, "0");
}

/**
 * Échappe les caractères XML spéciaux
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

#!/usr/bin/env node

import { Command, Option } from "commander";
import {
  searchManga,
  getScanVariants,
  getRealName,
  getChapterInfo,
  buildImageUrl,
  downloadImage,
  getAuthor,
} from "../src/scraper.js";
import { generateEpub, generateMergedEpub } from "../src/epub.js";
import {
  ensureDir,
  sanitizeFilename,
  parseChapterRange,
  delay,
  createProgressBar,
  updateProgress,
  stopProgress,
} from "../src/utils.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(__dirname, "..", "output");

/**
 * Télécharge toutes les pages d'un chapitre en mémoire.
 * Les images échouées après retry sont ignorées sans interrompre.
 * @param {string} realName - Nom exact du manga
 * @param {number} chapterNum - Numéro du chapitre
 * @param {number} pageCount - Nombre de pages
 * @returns {Promise<Array<{url: string, buffer: Buffer, filename: string}>>}
 */
async function downloadChapterPages(realName, chapterNum, pageCount) {
  const pages = [];
  const bar = createProgressBar(pageCount, `  Chap. ${chapterNum}`);

  let failedImages = 0;

  for (let page = 1; page <= pageCount; page++) {
    const url = buildImageUrl(realName, chapterNum, page);

    try {
      const buffer = await downloadImage(url);
      pages.push({ url, buffer, filename: `page_${page}.jpg` });
    } catch (err) {
      // Image échouée après 3 retries : warning mais continuer
      console.warn(
        `\n  ⚠ Image page ${page} échouée, ignorée : ${err.message}`
      );
      failedImages++;
    }

    updateProgress(bar, page);

    // Délai entre chaque image
    if (page < pageCount) await delay();
  }

  stopProgress(bar);

  if (failedImages > 0) {
    console.log(`  ⚠ ${failedImages} image(s) échouée(s) sur ${pageCount}`);
  }

  return pages;
}

const program = new Command();

program
  .name("manga-epub")
  .description(
    "Télécharge des scans de manga depuis anime-sama.to et les convertit en EPUB"
  )
  .version("1.0.0");

// ─── COMMANDE : search ──────────────────────────────────────────
program
  .command("search <query>")
  .description("Rechercher un manga sur anime-sama.to")
  .action(async (query) => {
    try {
      console.log(`🔍 Recherche de "${query}"...`);
      const results = await searchManga(query);

      if (results.length === 0) {
        console.log("❌ Aucun manga trouvé.");
        return;
      }

      console.log(`\n📚 ${results.length} résultat(s) trouvé(s) :\n`);
      results.forEach((manga, i) => {
        console.log(`  ${i + 1}. ${manga.title}`);
        console.log(`     ID: ${manga.id}`);
        console.log(`     URL: ${manga.url.startsWith("http") ? manga.url : `https://anime-sama.to${manga.url}`}`);
        console.log("");
      });
    } catch (err) {
      console.error("❌ Erreur lors de la recherche :", err.message);
    }
  });

// ─── COMMANDE : chapters ────────────────────────────────────────
program
  .command("chapters <query>")
  .description("Lister les chapitres disponibles pour un scan")
  .option("--scan <vf|vostfr>", "Langue du scan", "vf")
  .addOption(
    new Option("--type <couleur|noir-blanc>", "Type de scan (couleur ou noir et blanc)")
      .default("couleur")
      .choices(["couleur", "noir-blanc"])
  )
  .action(async (query, opts) => {
    try {
      console.log(`🔍 Recherche de "${query}"...`);
      const results = await searchManga(query);

      if (results.length === 0) {
        console.log("❌ Aucun manga trouvé.");
        return;
      }

      // Prendre le premier résultat
      const manga = results[0];
      console.log(`\n📖 Manga sélectionné : ${manga.title} (${manga.id})\n`);

      // Récupérer les variantes de scan
      console.log("🔍 Récupération des scans disponibles...");
      const variants = await getScanVariants(manga.id);

      if (variants.length === 0) {
        console.log("❌ Aucun scan disponible pour ce manga.");
        return;
      }

      // Filtrer par langue et type demandés
      const matchingVariants = variants.filter(
        (v) => v.language === opts.scan && v.type === opts.type
      );

      if (matchingVariants.length === 0) {
        console.log(
          `❌ Aucun scan de type "${opts.type}" en "${opts.scan}" disponible pour ce manga.`
        );
        console.log("   Scans disponibles :");
        variants.forEach((v) => {
          console.log(`   - ${v.name} (${v.language} - ${v.type}) → ${v.path}`);
        });
        return;
      }

      const variant = matchingVariants[0];
      console.log(
        `📂 Scan sélectionné : ${variant.name} (${variant.type}, ${variant.path})\n`
      );

      // Récupérer le realName
      console.log("🔍 Récupération du nom exact...");
      const realName = await getRealName(
        manga.id,
        variant.scanValue,
        variant.language
      );
      console.log(`   Nom exact : "${realName}"\n`);

      // Récupérer les infos chapitres
      console.log("📊 Récupération des informations chapitres...");
      const chapterInfo = await getChapterInfo(realName);

      if (!chapterInfo || Object.keys(chapterInfo).length === 0) {
        console.log("❌ Aucun chapitre trouvé.");
        return;
      }

      const chapters = Object.entries(chapterInfo).sort(
        ([a], [b]) => Number(a) - Number(b)
      );
      console.log(`\n📚 ${chapters.length} chapitre(s) disponible(s) :\n`);

      chapters.forEach(([num, pages]) => {
        console.log(
          `  Chapitre ${num.padStart(3, " ")} — ${pages} page(s)`
        );
      });

      console.log(
        `\n💡 Utilisez "download" pour télécharger un chapitre spécifique.`
      );
    } catch (err) {
      console.error("❌ Erreur :", err.message);
    }
  });

// ─── COMMANDE : download ────────────────────────────────────────
program
  .command("download <query>")
  .description("Télécharger un ou plusieurs chapitres en EPUB")
  .option("--chapter <number>", "Numéro du chapitre unique")
  .option("--chapters <range>", "Plage de chapitres (ex: 1-10)")
  .option("--merge", "Regrouper tous les chapitres téléchargés en un seul EPUB")
  .option("--scan <vf|vostfr>", "Langue du scan", "vf")
  .addOption(
    new Option("--type <couleur|noir-blanc>", "Type de scan (couleur ou noir et blanc)")
      .default("couleur")
      .choices(["couleur", "noir-blanc"])
  )
  .option("--out <directory>", "Dossier de sortie", DEFAULT_OUTPUT)
  .action(async (query, opts) => {
    try {
      // Déterminer la liste des chapitres à télécharger
      let chapterList = [];
      if (opts.chapter) {
        chapterList = [Number(opts.chapter)];
      } else if (opts.chapters) {
        chapterList = parseChapterRange(opts.chapters);
      } else {
        console.error(
          "❌ Veuillez spécifier --chapter <numéro> ou --chapters <plage>."
        );
        return;
      }

      // S'assurer que le dossier de sortie existe
      ensureDir(opts.out);

      console.log(`🔍 Recherche de "${query}"...`);
      const results = await searchManga(query);

      if (results.length === 0) {
        console.log("❌ Aucun manga trouvé.");
        return;
      }

      const manga = results[0];
      console.log(`\n📖 Manga sélectionné : ${manga.title} (${manga.id})\n`);

      // Récupérer les variantes de scan
      console.log("🔍 Récupération des scans disponibles...");
      const variants = await getScanVariants(manga.id);

      const matchingVariants = variants.filter(
        (v) => v.language === opts.scan && v.type === opts.type
      );

      if (matchingVariants.length === 0) {
        console.log(
          `❌ Aucun scan de type "${opts.type}" en "${opts.scan}" disponible pour ce manga.`
        );
        console.log("   Scans disponibles :");
        variants.forEach((v) => {
          console.log(`   - ${v.name} (${v.language} - ${v.type}) → ${v.path}`);
        });
        return;
      }

      const variant = matchingVariants[0];
      console.log(
        `📂 Scan sélectionné : ${variant.name} (${variant.type}, ${variant.path})\n`
      );

      // Récupérer le realName
      console.log("🔍 Récupération du nom exact...");
      const realName = await getRealName(
        manga.id,
        variant.scanValue,
        variant.language
      );
      console.log(`   Nom exact : "${realName}"\n`);

      // Récupérer les infos chapitres
      console.log("📊 Récupération des informations chapitres...");
      const chapterInfo = await getChapterInfo(realName);

      if (!chapterInfo || Object.keys(chapterInfo).length === 0) {
        console.log("❌ Aucun chapitre trouvé.");
        return;
      }

      // Filtrer pour ne garder que les chapitres demandés et existants
      const validChapters = chapterList.filter(
        (n) => chapterInfo[String(n)] !== undefined
      );

      if (validChapters.length === 0) {
        console.log(
          "❌ Aucun des chapitres demandés n'existe pour ce manga."
        );
        console.log(
          `   Chapitres disponibles : ${Object.keys(chapterInfo)
            .sort((a, b) => Number(a) - Number(b))
            .join(", ")}`
        );
        return;
      }

      if (validChapters.length < chapterList.length) {
        const missing = chapterList.filter((n) => !validChapters.includes(n));
        console.log(
          `⚠ Chapitres ignorés (inexistants) : ${missing.join(", ")}`
        );
      }

      console.log(
        `\n📥 Téléchargement de ${validChapters.length} chapitre(s)...\n`
      );

      // Récupérer l'auteur réel du manga
      let author = "Inconnu";
      try {
        console.log("🔍 Récupération des informations du manga...");
        const mangaAuthor = await getAuthor(manga.id);
        if (mangaAuthor) author = mangaAuthor;
        console.log(`   Auteur : ${author}`);
      } catch (err) {
        console.warn(
          `  ⚠ Informations du manga indisponibles (auteur) : ${err.message}`
        );
      }

      if (opts.merge && validChapters.length > 1) {
        // ── Mode fusion : un seul EPUB avec tous les chapitres ──
        const chapters = [];

        for (const chapterNum of validChapters) {
          const pageCount = chapterInfo[String(chapterNum)];
          console.log(`\n── Chapitre ${chapterNum} (${pageCount} pages) ──`);

          const pages = await downloadChapterPages(
            realName,
            chapterNum,
            pageCount
          );

          if (pages.length === 0) {
            console.log(
              `  ❌ Chapitre ${chapterNum} abandonné (aucune image récupérée).`
            );
            continue;
          }

          chapters.push({ num: chapterNum, pages });
        }

        if (chapters.length === 0) {
          console.log("❌ Aucun chapitre téléchargé.");
          return;
        }

        console.log(`  📦 Génération de l'EPUB fusionné...`);
        const epubPath = await generateMergedEpub({
          title: manga.title,
          chapters,
          author,
          lang: "fr",
          outDir: opts.out,
        });

        console.log(`  ✅ EPUB créé : ${epubPath}`);
        console.log(
          `\n🎉 Terminé ! 1 EPUB (${chapters.length} chapitres) créé.`
        );
      } else {
        // ── Mode standard : un EPUB par chapitre ──
        let created = 0;

        for (const chapterNum of validChapters) {
          const pageCount = chapterInfo[String(chapterNum)];
          console.log(`\n── Chapitre ${chapterNum} (${pageCount} pages) ──`);

          const pages = await downloadChapterPages(
            realName,
            chapterNum,
            pageCount
          );

          if (pages.length === 0) {
            console.log(
              `  ❌ Chapitre ${chapterNum} abandonné (aucune image récupérée).`
            );
            continue;
          }

          // Générer l'EPUB
          console.log(`  📦 Génération de l'EPUB...`);
          const epubPath = await generateEpub({
            title: manga.title,
            chapter: chapterNum,
            author,
            lang: "fr",
            pages,
            outDir: opts.out,
          });

          console.log(`  ✅ EPUB créé : ${epubPath}`);
          created++;
        }

        console.log(`\n🎉 Terminé ! ${created} EPUB(s) créé(s).`);
      }
    } catch (err) {
      console.error("❌ Erreur :", err.message);
    }
  });

program.parse();

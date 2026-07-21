import axios from "axios";
import * as cheerio from "cheerio";
import { randomUA, delay, retry } from "./utils.js";

const BASE_URL = "https://anime-sama.to";

/**
 * Headers de base pour les requêtes vers anime-sama
 */
function baseHeaders() {
  return {
    "User-Agent": randomUA(),
    Referer: `${BASE_URL}/`,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };
}

/**
 * Recherche un manga sur anime-sama.to
 * @param {string} query - Nom du manga à rechercher
 * @returns {Promise<Array<{id: string, title: string, image: string, url: string}>>}
 */
export async function searchManga(query) {
  const url = `${BASE_URL}/template-php/defaut/fetch.php`;
  const { data } = await axios.post(
    url,
    `query=${encodeURIComponent(query)}`,
    {
      headers: {
        ...baseHeaders(),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
    }
  );

  const $ = cheerio.load(data);
  const results = [];

  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/catalogue\/([^/]+)/);
    if (!match) return;

    const id = match[1];
    const title = $(el).find("h3").text().trim() || $(el).find("img").attr("alt") || id;
    const image = $(el).find("img").attr("src") || "";

    // Éviter les doublons
    if (!results.find((r) => r.id === id)) {
      results.push({ id, title, image, url: href });
    }
  });

  return results;
}

/**
 * Récupère les variantes de scan disponibles pour un manga
 * @param {string} animeId - ID du manga dans le catalogue
 * @returns {Promise<Array<{name: string, scanValue: string, language: string, path: string}>>}
 */
export async function getScanVariants(animeId) {
  const url = `${BASE_URL}/catalogue/${animeId}/`;
  const { data } = await axios.get(url, { headers: baseHeaders() });

  const $ = cheerio.load(data);
  const variants = [];

  // Chercher les appels panneauScan() dans le HTML/JS inline
  const htmlContent = $.html();
  const regex = /panneauScan\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
  let match;

  while ((match = regex.exec(htmlContent)) !== null) {
    const name = match[1];
    const scanPath = match[2];
    const parts = scanPath.split("/");
    const scanValue = parts[0]; // ex: "scan", "scan_noir-et-blanc"
    const language = parts[1]; // ex: "vf", "vostfr"

    variants.push({ name, scanValue, language, path: scanPath });
  }

  return variants;
}

/**
 * Récupère le realName (nom exact utilisé par le CDN) pour un scan donné
 * @param {string} animeId - ID du manga
 * @param {string} scanValue - Valeur du scan (ex: "scan")
 * @param {string} language - Langue (ex: "vf")
 * @returns {Promise<string>} Le realName exact
 */
export async function getRealName(animeId, scanValue, language) {
  const url = `${BASE_URL}/catalogue/${animeId}/${scanValue}/${language}/`;
  const { data } = await axios.get(url, { headers: baseHeaders() });

  const $ = cheerio.load(data);
  // Le titre exact est dans <span id="titreOeuvre">
  const raw = $("#titreOeuvre").text();

  // IMPORTANT : ne trimmer QUE les espaces en début de chaîne
  // Certains titres ont des espaces de fin intentionnels
  return raw.replace(/^\s+/, "");
}

/**
 * Récupère le nombre de chapitres et d'images par chapitre
 * @param {string} realName - Nom exact du manga
 * @returns {Promise<Object>} Map chapitre -> nombre d'images { "1": 55, "2": 48, ... }
 */
export async function getChapterInfo(realName) {
  const url = `${BASE_URL}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(realName)}`;

  try {
    const { data } = await axios.get(url, { headers: baseHeaders() });
    return data;
  } catch (err) {
    // Fallback : essayer avec le nom trimmé
    console.warn(
      "  ⚠ Erreur avec le realName exact, tentative avec le nom trimmé..."
    );
    const trimmed = realName.trim();
    const url2 = `${BASE_URL}/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(trimmed)}`;
    const { data } = await axios.get(url2, { headers: baseHeaders() });
    return data;
  }
}

/**
 * Construit l'URL d'une image de scan
 * @param {string} realName - Nom exact du manga
 * @param {number} chapter - Numéro du chapitre
 * @param {number} page - Numéro de la page
 * @returns {string} URL complète de l'image
 */
export function buildImageUrl(realName, chapter, page) {
  return `${BASE_URL}/s2/scans/${encodeURIComponent(realName)}/${chapter}/${page}.jpg`;
}

/**
 * Télécharge une image en mémoire avec retry
 * @param {string} url - URL de l'image
 * @returns {Promise<Buffer>} Buffer de l'image
 */
export async function downloadImage(url) {
  return retry(async () => {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        Referer: `${BASE_URL}/`,
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
      responseType: "arraybuffer",
      timeout: 30000,
    });
    return Buffer.from(data);
  }, 3, `image ${url.split("/").pop()}`);
}

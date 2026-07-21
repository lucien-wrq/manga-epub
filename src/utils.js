import fs from "fs";
import path from "path";
import cliProgress from "cli-progress";

// Liste de User-Agents pour rotation
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

/**
 * Retourne un User-Agent aléatoire de la liste
 */
export function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Attendre un délai aléatoire entre 100 et 300 ms
 */
export function delay() {
  return new Promise((r) => setTimeout(r, Math.random() * 200 + 100));
}

/**
 * Exécute une fonction avec retry en cas d'erreur
 * @param {Function} fn - Fonction async à exécuter
 * @param {number} maxRetries - Nombre max de tentatives
 * @param {string} label - Label pour les messages d'erreur
 * @returns {Promise<*>} Résultat de la fonction
 */
export async function retry(fn, maxRetries = 3, label = "opération") {
  let lastErr;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxRetries) {
        const wait = i * 1000;
        console.warn(
          `  ⚠ Échec ${label} (tentative ${i}/${maxRetries}), retry dans ${wait / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

/**
 * Crée et retourne une barre de progression CLI
 * @param {number} total - Nombre total d'éléments
 * @param {string} label - Label de la barre
 * @returns {cliProgress.SingleBar}
 */
export function createProgressBar(total, label = "Téléchargement") {
  const bar = new cliProgress.SingleBar(
    {
      format: `${label} |{bar}| {percentage}% | {value}/{total} images`,
      hideCursor: true,
      clearOnComplete: true,
    },
    cliProgress.Presets.shades_classic
  );
  bar.start(total, 0);
  return bar;
}

/**
 * Met à jour la barre de progression
 * @param {cliProgress.SingleBar} bar
 * @param {number} current
 */
export function updateProgress(bar, current) {
  bar.update(current);
}

/**
 * Termine la barre de progression
 * @param {cliProgress.SingleBar} bar
 */
export function stopProgress(bar) {
  bar.stop();
}

/**
 * S'assure que le dossier de sortie existe
 * @param {string} dir - Chemin du dossier
 */
export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Nettoie un nom de fichier (remplace les caractères interdits)
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

/**
 * Parse une plage de chapitres "1-10" en tableau [1,2,...,10]
 * @param {string} range
 * @returns {number[]}
 */
export function parseChapterRange(range) {
  if (range.includes("-")) {
    const [start, end] = range.split("-").map(Number);
    const chapters = [];
    for (let i = start; i <= end; i++) chapters.push(i);
    return chapters;
  }
  return [Number(range)];
}

# manga-epub

CLI Node.js pour télécharger des scans de manga depuis [anime-sama.to](https://anime-sama.to) et les convertir en fichiers EPUB pour liseuse.

## Installation

```bash
git clone https://github.com/lucien-wrq/manga-epub.git
cd manga-epub
npm install
```

## Utilisation

```bash
node bin/manga-epub.js <commande> [options]
```

### Rechercher un manga

```bash
node bin/manga-epub.js search "one piece"
```

Affiche les résultats avec l'ID, le titre et l'URL de chaque manga trouvé.

### Lister les chapitres disponibles

```bash
node bin/manga-epub.js chapters "one piece" --scan vf --type couleur
```

| Option        | Description                                   | Défaut    |
| ------------- | --------------------------------------------- | --------- |
| `--scan`      | Langue du scan (`vf` ou `vostfr`)             | `vf`      |
| `--type`      | Type de scan (`couleur` ou `noir-blanc`)      | `couleur` |

### Télécharger un chapitre

```bash
# Chapitre unique
node bin/manga-epub.js download "one piece" --chapter 1 --scan vf

# Scan noir et blanc (sort souvent avant le scan couleur)
node bin/manga-epub.js download "one piece" --chapter 1 --scan vf --type noir-blanc

# Plage de chapitres (un EPUB par chapitre)
node bin/manga-epub.js download "one piece" --chapters 1-10 --scan vf

# Fusionner plusieurs chapitres en un seul EPUB (ex: un tome)
node bin/manga-epub.js download "one piece" --chapters 1-10 --scan vf --merge

# Dossier de sortie personnalisé
node bin/manga-epub.js download "one piece" --chapter 1 --scan vf --out ./mes-mangas
```

| Option        | Description                                        | Défaut             |
| ------------- | -------------------------------------------------- | ------------------ |
| `--chapter`   | Numéro du chapitre unique                          | —                  |
| `--chapters`  | Plage de chapitres (ex: `1-10`)                    | —                  |
| `--merge`     | Regrouper tous les chapitres dans un seul EPUB     | —                  |
| `--scan`      | Langue du scan (`vf` ou `vostfr`)                  | `vf`               |
| `--type`      | Type de scan (`couleur` ou `noir-blanc`)           | `couleur`          |
| `--out`       | Dossier de sortie                                  | `./output`         |

> `--chapter` et `--chapters` sont mutuellement exclusifs.

## Sortie

Les fichiers EPUB sont créés dans le dossier `output/` (ou celui spécifié avec `--out`) :

```
output/
├── One_Piece_chapitre_1.epub
├── One_Piece_chapitre_2.epub
└── ...
```

Avec `--merge`, les chapitres sont regroupés dans un seul fichier :

```
output/
└── One_Piece_chapitres_1_10.epub
```

## Fonctionnalités

- Recherche de manga sur anime-sama.to
- Support des scans couleur et noir et blanc
- Fusion de plusieurs chapitres en un seul EPUB (`--merge`)
- Auteur récupéré depuis le site ; couverture = première page du chapitre
- Téléchargement avec retry automatique (3 tentatives)
- Barre de progression CLI
- User-Agent rotatif pour éviter le blocage
- Délai aléatoire entre chaque requête (100-300ms)
- EPUB3 fixed-layout pour affichage correct sur liseuse
- Gestion des erreurs : images échouées ignorées sans interrompre

## Prérequis

- Node.js >= 18

## Dépendances

| Package       | Usage                              |
| ------------- | ---------------------------------- |
| `axios`       | Requêtes HTTP                      |
| `cheerio`     | Parsing HTML                       |
| `commander`   | Parsing des arguments CLI          |
| `cli-progress`| Barre de progression               |
| `jszip`       | Génération des fichiers EPUB       |

## Licence

MIT

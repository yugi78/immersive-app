# Mise en ligne avec l'espace client (Cloudflare Pages)

Le site public et l'espace client sont hébergés sur **Cloudflare Pages** (offre gratuite).
Cloudflare reconstruit le site à chaque commit sur `master`, que le commit vienne de toi
(`git push`) ou du client (bouton **Publier** de l'espace client).

```
toi (local) ── git push ──▶ GitHub ◀── commit ── espace client (/<projet>/admin, mot de passe)
                              │
                              └──▶ Cloudflare Pages : construit et met en ligne le site
```

- Un dossier par projet : `projects/<projet>/` (réglages) et `public/projects/<projet>/`
  (fichiers 3D, images). Site public : `/<projet>/`, espace client : `/<projet>/admin/`.
- `scene.json` : la structure (fichiers 3D, scan…), modifiée par toi seulement.
- `content.json` : le contenu (visite, œuvres, carte, réglages), modifié par le client.
- Les fonctions serveur sont dans `functions/` : connexion, protection des espaces client,
  publication (`/api/publish`) et envoi d'images (`/api/upload`).

À faire une seule fois. Les étapes marquées ✋ se font dans ton navigateur : je ne crée
pas de comptes et je ne saisis pas de mots de passe ni de jetons à ta place.

## 1. ✋ Créer le jeton GitHub (accès en écriture au seul dépôt)

GitHub → photo de profil → **Settings** → **Developer settings** → **Personal access
tokens** → **Fine-grained tokens** → **Generate new token** :

- *Repository access* : **Only select repositories** → `yugi78/immersive-app`.
- *Permissions* → *Repository permissions* → **Contents : Read and write** (rien d'autre).
- *Expiration* : 1 an (à renouveler ; Cloudflare le remplace sans rien casser).

Copie le jeton (il ne sera plus affiché). Ne le colle nulle part ailleurs qu'à l'étape 3.

## 2. Préparer le mot de passe et le secret de session (en local)

```powershell
npm run hash-password
```

Saisis le mot de passe du client (10 caractères minimum, il ne s'affiche pas). La commande
renvoie une ligne `pbkdf2$100000$…$…` : c'est l'**empreinte**, à coller à l'étape 3. Le
mot de passe lui-même n'est stocké nulle part : transmets-le au client de vive voix ou par
un canal sûr.

Secret de session (une longue chaîne aléatoire) :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. ✋ Créer le projet Cloudflare Pages

Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
choisis `yugi78/immersive-app`.

- *Production branch* : `master`
- *Build command* : `npm run build:cloudflare`
- *Build output directory* : `dist`
- *Environment variables* (onglet *Settings → Variables and Secrets*, environnement
  **Production**, type **Secret** pour les quatre premières) :

| Variable | Valeur |
| --- | --- |
| `ADMIN_PASSWORD_HASH` | l'empreinte de l'étape 2 |
| `SESSION_SECRET` | le secret de l'étape 2 |
| `GITHUB_TOKEN` | le jeton de l'étape 1 |
| `ADMIN_USER` | l'identifiant du client (ex. `pantheon`) |
| `GITHUB_REPO` | `yugi78/immersive-app` |
| `GITHUB_BRANCH` | `master` |
| `NODE_VERSION` | `24` |

Lance le déploiement. Le site est alors sur `https://<projet>.pages.dev`, l'espace client
sur `https://<projet>.pages.dev/pantheon/admin/` (redirige vers la page de connexion).

## 4. Vérifier

1. `/pantheon/admin/` sans être connecté → page de connexion.
2. Mauvais mot de passe → refusé (après un court délai).
3. Bon mot de passe → espace client. Modifier un texte → **Publier** → la pastille indique
   « Publié · en ligne d'ici 1 à 2 min » ; un commit « Contenu publié depuis l'espace
   client » apparaît dans GitHub ; le site se met à jour après la reconstruction.

## 5. ✋ Brancher le domaine (plus tard, optionnel)

Aujourd'hui (option retenue) : le site public reste sur **pantheon.stylz.fr**, servi par
GitHub Pages (enregistrement **A** chez FreeDNS → 185.199.108.153), et l'espace client est
sur l'adresse Cloudflare (`…pages.dev/pantheon/admin/`). Chaque publication met à jour les deux.

Pour tout regrouper sur Cloudflare, il faudra un **CNAME** vers l'adresse `…pages.dev`
(ou confier le DNS du domaine à Cloudflare) :

1. Cloudflare Pages → ton projet → **Custom domains** → **Set up a custom domain** →
   `pantheon.stylz.fr`.
2. Chez le registraire de stylz.fr : remplace le CNAME `pantheon` par
   `<projet>.pages.dev` (Cloudflare affiche la valeur exacte). Le certificat HTTPS est
   automatique.
3. Une fois le site servi par Cloudflare, désactive le déploiement GitHub Pages (onglet
   *Actions* du dépôt → *Déploiement GitHub Pages* → **Disable workflow**, ou supprime
   `.github/workflows/deploy.yml`). En attendant, ce workflow publie le site **sans**
   l'espace client (`npm run build:github-pages`), qui ne pourrait pas y être protégé.

## Recommandé : limiter les essais de connexion

Cloudflare → ton domaine → **Security** → **WAF** → **Rate limiting rules** : par exemple
5 requêtes par minute et par adresse IP sur le chemin `/api/login` (l'offre gratuite
inclut une règle). La connexion attend déjà ~1 s après chaque échec.

## Au quotidien

- **Le client** se connecte sur `/<projet>/admin/`, modifie, **Publier**. Les images importées
  (vignettes, illustrations) apparaissent en ligne après la reconstruction (1 à 2 min).
- **Toi** : fais toujours `git pull` avant de travailler (pour récupérer ses
  publications), modifie la structure (`scene.json`, fichiers 3D, scan), puis `git push`.
  Ne modifie pas `content.json` à la main sans avoir fait `git pull` juste avant.
- **Changer le mot de passe** : `npm run hash-password`, puis remplace
  `ADMIN_PASSWORD_HASH` dans Cloudflare. Pour déconnecter tout le monde, change aussi
  `SESSION_SECRET`.
- **Si deux publications se croisent**, la seconde est refusée avec un message
  (« modifié entre-temps ») au lieu d'écraser la première : recharger la page suffit.

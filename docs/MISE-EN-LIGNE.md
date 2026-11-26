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

## 2. Préparer les comptes et le secret de session (en local)

Chaque compte est rattaché à **un seul projet** : le client du Panthéon ne voit et ne
publie que `/pantheon/admin/`. Un compte au projet `*` (le tien) ouvre tous les projets.

```powershell
npm run add-client -- pantheon pantheon
```

(identifiant, puis projet). Saisis deux fois le mot de passe (10 caractères minimum, il ne
s'affiche pas). La commande garde la liste des comptes dans `clients.local.json` (ignoré
par Git) et affiche la valeur complète de **`ADMIN_USERS`** à coller à l'étape 3 : une
liste `[{"user":…,"project":…,"hash":"pbkdf2$…"}]`. Seules les **empreintes** des mots
de passe y figurent ; transmets le mot de passe au client de vive voix ou par un canal sûr.

- Ton compte, tous projets : `npm run add-client -- moi "*"`
- Voir les comptes : `npm run add-client -- --list`
- Retirer un compte : `npm run add-client -- --retirer <identifiant>`

Chaque commande réaffiche `ADMIN_USERS` : recolle-la dans Cloudflare pour l'appliquer.

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
  **Production**, type **Secret** pour les trois premières) :

| Variable | Valeur |
| --- | --- |
| `ADMIN_USERS` | la liste des comptes de l'étape 2 |
| `SESSION_SECRET` | le secret de l'étape 2 |
| `GITHUB_TOKEN` | le jeton de l'étape 1 |
| `GITHUB_REPO` | `yugi78/immersive-app` |
| `GITHUB_BRANCH` | `master` |
| `NODE_VERSION` | `24` |

Lance le déploiement. Le site est alors sur `https://<projet>.pages.dev`, l'espace client
sur `https://<projet>.pages.dev/pantheon/admin/` (redirige vers la page de connexion).

## 4. Vérifier

1. `/pantheon/admin/` sans être connecté → page de connexion.
2. Mauvais mot de passe → refusé (après un court délai).
3. Compte d'un projet sur l'espace d'un autre projet (ou sur `/admin/`) → renvoyé vers
   l'espace de son projet ; une publication vers un autre projet est refusée.
4. Bon mot de passe → espace client. Modifier un texte → **Publier** → la pastille indique
   « Publié · en ligne d'ici 1 à 2 min » ; un commit « Contenu publié depuis l'espace
   client » apparaît dans GitHub ; le site se met à jour après la reconstruction.

## 5. Le domaine immersive-app.stylz.fr (FreeDNS)

Le sous-domaine FreeDNS n'accepte que des enregistrements **A** : il ne peut pas pointer
vers Cloudflare Pages (qui demande un CNAME). Organisation actuelle :

| Adresse | Servi par | Contenu |
| --- | --- | --- |
| `immersive-app.stylz.fr` | GitHub Pages (A → 185.199.108.153) | accueil + apps publiques `/<projet>/` |
| `immersive-app.pages.dev` | Cloudflare Pages | la même chose **+ l'espace client** (`/admin/`) |

Le bouton « Espace client » de l'accueil sur `immersive-app.stylz.fr` mène à
`https://immersive-app.pages.dev/admin/` (variable `PUBLIC_ADMIN_URL` du workflow
`.github/workflows/deploy.yml`). Chaque publication met à jour les deux sites.
Réglage GitHub (une fois) : *Settings → Pages → Custom domain* `immersive-app.stylz.fr`
+ *Enforce HTTPS*.

Avec un vrai nom de domaine (quelques euros par an), tout peut passer sur Cloudflare :
Cloudflare Pages → **Custom domains** → ajouter le domaine, CNAME vers
`immersive-app.pages.dev`, retirer `PUBLIC_ADMIN_URL`, puis désactiver le workflow GitHub
Pages (onglet *Actions* → *Déploiement GitHub Pages* → **Disable workflow**).

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
- **Nouveau client / nouveau projet** : `npm run add-client -- <identifiant> <projet>`,
  puis recolle `ADMIN_USERS` dans Cloudflare (*Settings → Variables and Secrets*) et
  relance un déploiement (*Deployments → Retry deployment*) pour que la valeur s'applique.
- **Changer un mot de passe** : relance `npm run add-client` avec le même identifiant,
  puis recolle `ADMIN_USERS`. Les sessions ouvertes de ce compte sont fermées ; retirer
  un compte ferme aussi les siennes. Pour déconnecter tout le monde, change
  `SESSION_SECRET`.
- **Ancienne configuration** (`ADMIN_USER` + `ADMIN_PASSWORD_HASH`) : toujours acceptée
  tant que `ADMIN_USERS` n'existe pas, limitée au projet `pantheon` (ou `ADMIN_PROJECT`).
  Une fois `ADMIN_USERS` en place, tu peux supprimer ces deux variables.
- **Si deux publications se croisent**, la seconde est refusée avec un message
  (« modifié entre-temps ») au lieu d'écraser la première : recharger la page suffit.

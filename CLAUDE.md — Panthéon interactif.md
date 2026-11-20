# CLAUDE.md — Panthéon interactif

## Contexte

Visualiseur WebGL interactif présentant une captation photogrammétrique des plafonds du Panthéon de Paris (du dessous de l'entablement du premier étage jusqu'au dôme), réalisée pour un appel d'offres de restauration. Le scan est intégré dans une maquette low poly du Panthéon et une maquette clay du quartier. Projet vitrine pour le site collaboratif (numérisation 3D du patrimoine).

## Stack

- Astro + TypeScript ; le viewer Three.js (WebGL) est un composant isolé (island côté client), indépendant du reste du site
- GLTFLoader + MeshoptDecoder + KTX2Loader
- 3DTilesRendererJS (NASA-AMMOS) pour le scan, dans un second temps
- Back-office prévu plus tard avec Puck : la scène (points d'intérêt, textes, caméras, points de découpe) doit être pilotée par des données JSON séparées du code, pour être éditable sans toucher au viewer

## Assets (`/public/models`)

- `paris.glb` : quartier autour du Panthéon, issu du LiDAR HD IGN + roofer, texture bakée, \~200k faces, rendu clay
- cull\_`pantheon.glb` : maquette Panthéon modélisée dans Blender sans son sol, \~20-30k faces, rendu clay, reçoit le shader de découpe. sol\_pantheon.glb : sol de la maquette, matériau clay sans découpe, pour qu'il ne soit jamais effacé en vue rasante
- `scan.glb` : scan des plafonds, \~200k faces, 4 matériaux, textures KTX2. Pas encore dans le dossier ; sera remplacé par un tileset 3D Tiles (`/public/tiles/tileset.json`)

Tous les assets partagent la même échelle (mètres) et la même origine que la scène Blender. Ne jamais les recentrer ni les rééchelonner individuellement.

## Cibles et performances

- Ordinateur, tablette et téléphone : fluidité obligatoire sur mobile
- Limiter les draw calls (fusionner la ville en peu de meshes)
- Textures uniquement en KTX2, mémoire GPU surveillée
- pixelRatio plafonné à 2 sur mobile
- Pas de post-processing coûteux par défaut

## Découpe « voir à travers les murs »

- Vue orbitale extérieure (OrbitControls)
- Pas de raycast : la découpe est calculée entièrement dans le fragment shader des maquettes clay, à coût constant quel que soit le zoom
- Un fragment est effacé s'il se trouve entre la caméra et la cible orbitale, dans un cylindre autour de l'axe caméra–cible (uniforms : position caméra, cible, rayon), injecté via onBeforeCompile ; les murs derrière la cible restent visibles avec leur texture
- Le fragment shader fait un `discard` avec un bord en dégradé obtenu par dithering (motif de Bayer) : le matériau reste opaque, sans tri de transparence
- Le scan reçoit le même cylindre de découpe que les maquettes (pas de backface culling seul, qui laisserait des bords parasites en vue rasante). Maquettes clay en DoubleSide : leurs normales pointent vers l'extérieur, donc les murs du fond sont vus par leur face arrière ; les faces arrière (gl\_FrontFacing) sont rendues dans une teinte de coupe unie pour simuler l'épaisseur des murs coupés
- Rayon du cylindre et largeur du dégradé réglables, à terme exposés dans le back-office

## Rendu

- Maquettes : clay blanc assumé, occlusion ambiante bakée, aspect volontairement propre
- Le contraste clay / scan est intentionnel : la maquette sert de contexte, le scan montre le relevé réel

## Séquence d'ouverture et caméra

Toutes les valeurs sont en mètres (maquettes à l'échelle métrique) et centralisées dans le JSON de configuration.

1. **Référence** : au chargement, calculer la bounding box de cull\_pantheon.glb (le mesh n'a pas de pivot centré). Son centre donne la cible de l'orbite et le centre du cylindre de découpe ; son min.y donne la hauteur du sol.
2. **Chargement** : barre de progression branchée sur le LoadingManager de Three.js ; la scène n'apparaît qu'une fois tous les assets prêts.
3. **Intro** : la caméra part du ciel, à 200 m au-dessus du sol et 350 m du Panthéon, et avance vers lui jusqu'à 90 m de distance, avec une courbe ease-in-out. Contrôles désactivés pendant l'animation.
4. **Orbite** : à la fin de l'intro, OrbitControls activé avec autoRotate lent. L'autoRotate se coupe dès que l'utilisateur prend la main et reprend après quelques secondes d'inactivité.
5. **Découpe** : elle apparaît quand la caméra passe sous 50 m du centre, avec une transition progressive (par exemple de 60 à 50 m) plutôt qu'une apparition brutale.
6. **Sol** : la caméra ne descend jamais sous la hauteur du sol issue de la bounding box, plus une petite marge, quel que soit le zoom ou l'angle.

## Étapes

1. Scène de base : chargement des trois GLB, éclairage, vue orbitale
2. Découpe par raycast et shader
3. Points d'intérêt (peintures autour du pendule de Foucault, fissures, désordres) avec animation de caméra vers le détail
4. Panneau orthomosaïque synchronisé avec le point d'intérêt sélectionné
5. Remplacement de `scan.glb` par les 3D Tiles avec chargement progressif

## Conventions

- Code modulaire : `scene/`, `loaders/`, `cutaway/`, `poi/`, `ui/`
- Tester chaque étape sur mobile avant de passer à la suivante

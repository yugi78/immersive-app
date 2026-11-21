"""Étape 1 — analyse de scan_hd.glb avant découpage (ne génère aucun fichier de scène).

Mesure :
  - les texels utiles par triangle (aire UV × résolution de l'atlas), la densité px/m ;
  - le taux de remplissage réel des atlas (rasterisation des triangles UV) et les recouvrements ;
  - les îlots UV (composantes connexes par arêtes partagées, sommets soudés par UV identique) ;
puis simule le découpage k-d équilibré en texels pour plusieurs nombres de tuiles et vérifie,
par tuile, que les îlots (+ dilatation) tiennent dans une texture de TILE_MAX px.

    .venv/Scripts/python scripts/scan_lod/analyze.py public/models/scan_hd.glb [--json rapport.json]
"""
from __future__ import annotations

import argparse
import io
import json
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

from glb import read_glb

Image.MAX_IMAGE_PIXELS = None  # atlas 16K = 268 Mpx, au-delà de la limite anti-« bombe » de Pillow

TILE_MAX = 4096
PAD = 8  # dilatation autour de chaque îlot (px)
PACK_EFFICIENCY = 0.80  # remplissage réaliste de rectpack sur des rectangles hétérogènes
RASTER = 8192  # résolution de rasterisation pour mesurer le remplissage (1 px = 2×2 texels 16K)


def tri_area_2d(p):  # p: (T,3,2)
    a, b, c = p[:, 0], p[:, 1], p[:, 2]
    return 0.5 * np.abs((b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1]))


def tri_area_3d(p):  # p: (T,3,3)
    return 0.5 * np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)


def uv_edge_graph(uv_tris_px):
    """Arêtes partagées entre triangles, sommets soudés par coordonnée UV identique.
    Renvoie (tri_a, tri_b) pour chaque paire de triangles adjacents en espace UV."""
    t = uv_tris_px.shape[0]
    flat = uv_tris_px.reshape(-1, 2)
    _, vid = np.unique(np.round(flat * 1e3).astype(np.int64), axis=0, return_inverse=True)  # soudure à 0,001 px
    vid = vid.reshape(t, 3)
    edges = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]], vid[:, [2, 0]]])
    edges.sort(axis=1)
    owner = np.tile(np.arange(t), 3)
    key = edges[:, 0] * (vid.max() + 1) + edges[:, 1]
    order = np.argsort(key, kind="stable")
    k, o = key[order], owner[order]
    same = np.nonzero(k[1:] == k[:-1])[0]
    return o[same], o[same + 1]


def islands(n_tris, pairs, mask=None):
    a, b = pairs
    if mask is not None:
        keep = mask[a] & mask[b]
        a, b = a[keep], b[keep]
    g = coo_matrix((np.ones(len(a), np.int8), (a, b)), shape=(n_tris, n_tris))
    return connected_components(g, directed=False)[1]


def island_boxes(labels, uv_tris_px, sel):
    """Bbox pixel (entiers) de chaque îlot parmi les triangles `sel`."""
    lab = labels[sel]
    pts = uv_tris_px[sel]
    lo = np.floor(pts.min(axis=1))
    hi = np.ceil(pts.max(axis=1))
    uniq, inv = np.unique(lab, return_inverse=True)
    mn = np.full((len(uniq), 2), np.inf)
    mx = np.full((len(uniq), 2), -np.inf)
    np.minimum.at(mn, inv, lo)
    np.maximum.at(mx, inv, hi)
    return mx - mn  # (n_islands, 2) largeur, hauteur


def kd_split(idx, centroids, weights, k, out):
    """Découpe récursive : axe le plus long, coupe au quantile de texels k_gauche/k."""
    if k == 1:
        out.append(idx)
        return
    c = centroids[idx]
    axis = int(np.argmax(c.max(0) - c.min(0)))
    order = idx[np.argsort(c[:, axis], kind="stable")]
    cw = np.cumsum(weights[order])
    kl = k // 2
    cut = int(np.searchsorted(cw, cw[-1] * kl / k)) + 1
    cut = min(max(cut, 1), len(order) - 1)
    kd_split(order[:cut], centroids, weights, kl, out)
    kd_split(order[cut:], centroids, weights, k - kl, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--json")
    ap.add_argument("--tiles", default="32,48,64,96,128")
    args = ap.parse_args()

    t0 = time.time()
    glb = read_glb(args.glb)
    report = {"source": args.glb, "materials": []}

    all_uvpx, all_cent, all_tex, all_mat, all_area3d = [], [], [], [], []
    pair_a, pair_b, offset = [], [], 0
    atlas_px = {}

    print(f"\n=== {args.glb} ===")
    for pi, p in enumerate(glb.primitives):
        img_index = glb.material_image(p.material)
        img = Image.open(io.BytesIO(glb.image_bytes(img_index)))
        w, h = img.size
        atlas_px[pi] = (w, h)
        tris_uv = p.uvs[p.indices]  # (T,3,2)
        # UDIM : chaque matériau occupe une case entière (u ∈ [1,2], v ∈ [-1,0]…) ;
        # on ramène les UV dans la case de l'atlas du matériau.
        udim = np.floor(np.median(tris_uv.reshape(-1, 2), axis=0))
        local_uv = tris_uv - udim
        outside = int(np.count_nonzero((local_uv < -1e-6) | (local_uv > 1 + 1e-6)))
        uv_px = local_uv * np.array([w, h])
        tris_xyz = p.positions[p.indices]
        texels = tri_area_2d(uv_px)
        area3d = tri_area_3d(tris_xyz)

        # Remplissage : rasterisation des triangles UV.
        s = RASTER / w
        mask = Image.new("1", (RASTER, RASTER), 0)
        draw = ImageDraw.Draw(mask)
        for tri in uv_px * s:
            draw.polygon([tuple(v) for v in tri], fill=1)
        covered = np.count_nonzero(np.asarray(mask)) / (s * s)

        pairs = uv_edge_graph(uv_px)
        lab = islands(len(texels), pairs)
        boxes = island_boxes(lab, uv_px, np.arange(len(texels)))
        n_isl = lab.max() + 1
        too_big = int(np.count_nonzero(boxes.max(1) + 2 * PAD > TILE_MAX))

        dens = np.sqrt(texels.sum() / max(area3d.sum(), 1e-12))
        m = {
            "material": glb.json["materials"][p.material]["name"],
            "atlas": f"{w}x{h}",
            "triangles": int(len(texels)),
            "udim": udim.astype(int).tolist(),
            "uv_hors_case": outside,
            "uv_min": tris_uv.reshape(-1, 2).min(0).round(4).tolist(),
            "uv_max": tris_uv.reshape(-1, 2).max(0).round(4).tolist(),
            "texels_somme_triangles": float(texels.sum()),
            "texels_couverts": float(covered),
            "remplissage_atlas": float(covered / (w * h)),
            "recouvrement_uv": float(texels.sum() / max(covered, 1) - 1),
            "texels_par_triangle_median": float(np.median(texels)),
            "texels_par_triangle_p99": float(np.percentile(texels, 99)),
            "densite_px_par_m_local": float(dens),
            "ilots": int(n_isl),
            "ilot_plus_grand_px": boxes.max(0).astype(int).tolist(),
            "ilots_trop_grands_pour_4096": too_big,
            "triangles_degeneres_uv": int(np.count_nonzero(texels < 1e-9)),
        }
        report["materials"].append(m)
        print(
            f"\n[{m['material']}] atlas {m['atlas']} · {m['triangles']} tris · case UDIM {m['udim']} · UV hors case : {outside}\n"
            f"  remplissage {m['remplissage_atlas']:.1%} ({covered/1e6:.1f} Mtexels couverts) · recouvrement UV {m['recouvrement_uv']:+.1%}\n"
            f"  texels/tri médian {m['texels_par_triangle_median']:.0f} · p99 {m['texels_par_triangle_p99']:.0f} · densité ≈ {dens:.0f} px/m (repère local)\n"
            f"  îlots UV {n_isl} · plus grande bbox {m['ilot_plus_grand_px']} px · îlots > {TILE_MAX - 2*PAD} px : {too_big}"
        )

        all_uvpx.append(uv_px)
        all_cent.append(tris_xyz.mean(1))
        all_tex.append(texels)
        all_mat.append(np.full(len(texels), pi))
        all_area3d.append(area3d)
        pair_a.append(pairs[0] + offset)
        pair_b.append(pairs[1] + offset)
        offset += len(texels)

    uvpx = np.concatenate(all_uvpx)
    cent = np.concatenate(all_cent)
    tex = np.concatenate(all_tex)
    pairs = (np.concatenate(pair_a), np.concatenate(pair_b))
    n = len(tex)

    total_cov = sum(m["texels_couverts"] for m in report["materials"])
    total_atlas = sum(w * h for w, h in atlas_px.values())
    print(
        f"\n=== Total ===\n  {n} triangles · {total_cov/1e6:.0f} Mtexels utiles sur {total_atlas/1e6:.0f} Mtexels d'atlas "
        f"({total_cov/total_atlas:.1%})\n  équivalent ≈ {total_cov/TILE_MAX**2:.1f} textures {TILE_MAX}² pleines, "
        f"soit ≥ {total_cov/(TILE_MAX**2*PACK_EFFICIENCY):.0f} tuiles à {PACK_EFFICIENCY:.0%} de remplissage"
    )
    report["total"] = {"triangles": n, "texels_utiles": total_cov, "texels_atlas": total_atlas}

    # Simulation du découpage k-d (aucune écriture).
    print(f"\n=== Simulation k-d (équilibré en texels, tuile ≤ {TILE_MAX}, dilatation {PAD} px) ===")
    print("  tuiles | texels/tuile min-méd-max (M) | îlots/tuile méd-max | utile/4096² méd | rect.+dilat./4096² méd-max | perte rect. | îlot max (px) | hors capacité")
    report["simulations"] = []
    for k in [int(x) for x in args.tiles.split(",")]:
        leaves: list[np.ndarray] = []
        kd_split(np.arange(n), cent, tex, k, leaves)
        leaf_of = np.empty(n, np.int64)
        for li, idx in enumerate(leaves):
            leaf_of[idx] = li
        # Îlots recalculés par tuile : une arête coupée par une frontière sépare l'îlot.
        same_leaf = leaf_of[pairs[0]] == leaf_of[pairs[1]]
        lab = islands(n, (pairs[0][same_leaf], pairs[1][same_leaf]))
        rows = []
        for li, idx in enumerate(leaves):
            boxes = island_boxes(lab, uvpx, idx)
            need = float(np.sum((boxes[:, 0] + 2 * PAD) * (boxes[:, 1] + 2 * PAD)))
            useful = float(tex[idx].sum())
            rows.append(
                {
                    "texels": float(tex[idx].sum()),
                    "ilots": int(len(boxes)),
                    "besoin": need / TILE_MAX**2,
                    "utile": useful / TILE_MAX**2,
                    "ilot_max": int(boxes.max()),
                    "bbox3d": [cent[idx].min(0).round(2).tolist(), cent[idx].max(0).round(2).tolist()],
                }
            )
        tx = np.array([r["texels"] for r in rows]) / 1e6
        isl = np.array([r["ilots"] for r in rows])
        need = np.array([r["besoin"] for r in rows])
        use = np.array([r["utile"] for r in rows])
        imax = max(r["ilot_max"] for r in rows)
        over = int(np.count_nonzero((need > PACK_EFFICIENCY) | (np.array([r["ilot_max"] for r in rows]) + 2 * PAD > TILE_MAX)))
        print(
            f"  {k:6d} | {tx.min():5.1f} {np.median(tx):5.1f} {tx.max():5.1f} | {int(np.median(isl)):5d} {isl.max():5d} | "
            f"{np.median(use):5.0%} | {np.median(need):5.0%} {need.max():5.0%} | ×{need.sum()/use.sum():.2f} | {imax:5d} | {over}"
        )
        report["simulations"].append({"tuiles": k, "tuiles_hors_capacite": over, "detail": rows})

    print(f"\n({time.time() - t0:.0f} s)")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

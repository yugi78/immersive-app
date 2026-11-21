"""Tuilage spatial + repacking SANS PERTE des textures du scan.

Contraintes garanties (et vérifiées à chaque tuile) :
  - géométrie : chaque triangle va entier dans une tuile ; positions, normales, couleurs
    recopiées octet pour octet ; ordre des sommets (winding) conservé ; aucun sommet ajouté
    ni retiré, sauf la duplication d'un sommet partagé par deux îlots ou deux tuiles ;
  - textures : chaque îlot UV est déplacé par une translation de pixels entiers, sans
    rotation ni mise à l'échelle ; ses pixels (« cœur » = pixels touchés + 1 px pour le
    filtrage bilinéaire) sont copiés tels quels depuis l'atlas de référence (8K) et
    comparés ensuite pixel à pixel ;
  - le reste de la tuile (dilatation et fond) est rempli par la couleur du pixel de cœur
    le plus proche : pas de couture, y compris dans les niveaux réduits de la pyramide.

Rangement : chaque îlot devient un masque (cœur dilaté de `pad` px), placé par FFT sur une
grille de `cell` px au premier emplacement libre (ordre ligne par ligne), du plus grand au
plus petit. Si une tuile ne tient pas dans `tileMax`, elle est recoupée en deux (k-d).

    .venv/Scripts/python scripts/scan_lod/build_tiles.py [--config ...] [--only 0,21,42,63]
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import binary_dilation, distance_transform_edt
from scipy.signal import fftconvolve

from analyze import islands, kd_split, tri_area_2d, uv_edge_graph
from downscale_atlases import linear_to_srgb, srgb_to_linear_lut
from glb import Attribute, read_glb, write_glb

Image.MAX_IMAGE_PIXELS = None
SQUARE = np.ones((3, 3), bool)


class Source:
    """Triangles de toutes les primitives, à plat, avec leurs UV en pixels de l'atlas 8K."""

    def __init__(self, cfg):
        self.glb = read_glb(cfg["source"])
        self.attr_names = cfg["attributes"]
        atlas_dir = Path(cfg["workDir"]) / "atlas"
        self.atlases, uvpx, cent, tex, prim, local, pa, pb = [], [], [], [], [], [], [], []
        off = 0
        for pi, p in enumerate(self.glb.primitives):
            name = self.glb.json["materials"][p.material]["name"]
            atlas = np.asarray(Image.open(atlas_dir / f"{name}.png").convert("RGB"))
            self.atlases.append(atlas)
            h, w, _ = atlas.shape
            t_uv = p.uvs[p.indices]
            udim = np.floor(np.median(t_uv.reshape(-1, 2), axis=0))
            px = (t_uv - udim) * np.array([w, h])
            uvpx.append(px)
            cent.append(p.positions[p.indices].mean(1))
            tex.append(tri_area_2d(px))
            prim.append(np.full(len(px), pi))
            local.append(np.arange(len(px)))
            a, b = uv_edge_graph(px)
            pa.append(a + off)
            pb.append(b + off)
            off += len(px)
        self.uvpx = np.concatenate(uvpx)
        self.cent = np.concatenate(cent)
        self.tex = np.concatenate(tex)
        self.prim = np.concatenate(prim)
        self.local = np.concatenate(local)
        self.pairs = (np.concatenate(pa), np.concatenate(pb))
        self.n = len(self.tex)
        # Poids du k-d : texels + coût de la marge (bord libre des îlots × (dilatation + 1 px)).
        # Périmètre UV de chaque triangle, moins une arête moyenne par voisin (arête partagée) :
        # estimation de la longueur de bord libre portée par le triangle.
        perim = sum(np.linalg.norm(self.uvpx[:, (k + 1) % 3] - self.uvpx[:, k], axis=1) for k in range(3))
        shared_len = np.zeros(self.n)
        a, b = self.pairs
        np.add.at(shared_len, a, perim[a] / 3)
        np.add.at(shared_len, b, perim[b] / 3)
        self.border = np.clip(perim - shared_len, 0, None)
        self.weight = self.tex if cfg.get("balance", "texels") == "texels" else self.tex + (cfg["pad"] + 1) * self.border


def rasterize_core(uv_tris, x0, y0, w, h):
    """Pixels touchés par les triangles (remplissage + contour), dilatés de 1 px (bilinéaire)."""
    img = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(img)
    for tri in uv_tris - np.array([x0, y0]):
        pts = [tuple(v) for v in tri]
        d.polygon(pts, fill=1, outline=1)
    return binary_dilation(np.asarray(img), SQUARE)


def build_islands(src: Source, idx, cfg):
    pad, cell = cfg["pad"], cfg["cell"]
    mask = np.zeros(src.n, bool)
    mask[idx] = True
    lab = islands(src.n, src.pairs, mask)[idx]
    out = []
    for isl in np.unique(lab):
        tris = idx[lab == isl]
        m = int(src.prim[tris[0]])
        ah, aw, _ = src.atlases[m].shape
        uv = src.uvpx[tris]
        x0 = max(int(np.floor(uv[..., 0].min())) - 2, 0)
        y0 = max(int(np.floor(uv[..., 1].min())) - 2, 0)
        x1 = min(int(np.ceil(uv[..., 0].max())) + 2, aw)
        y1 = min(int(np.ceil(uv[..., 1].max())) + 2, ah)
        core = rasterize_core(uv, x0, y0, x1 - x0, y1 - y0)
        # Empreinte de rangement : cœur dilaté de `pad`, alignée sur la grille de `cell` px.
        fh = -(-(core.shape[0] + 2 * pad) // cell) * cell
        fw = -(-(core.shape[1] + 2 * pad) // cell) * cell
        fp = np.zeros((fh, fw), bool)
        fp[pad : pad + core.shape[0], pad : pad + core.shape[1]] = core
        fp = binary_dilation(fp, SQUARE, iterations=pad)
        fp_cells = fp.reshape(fh // cell, cell, fw // cell, cell).any(axis=(1, 3))
        out.append({"tris": tris, "prim": m, "x0": x0, "y0": y0, "core": core, "fp": fp_cells})
    return out


def _pack_order(isls, order, g):
    """Rangement « par contact » : parmi les positions libres, celle où l'empreinte touche
    le plus de cellules déjà occupées (ou le bord de la tuile) ; à égalité, la plus haute
    puis la plus à gauche. Les îlots s'emboîtent ainsi dans les creux des autres."""
    # Grille étendue d'une cellule : le cadre compte comme occupé (contact avec les bords).
    occ = np.zeros((g + 2, g + 2), np.float32)
    occ[0, :] = occ[-1, :] = occ[:, 0] = occ[:, -1] = 1
    places = {}
    for i in order:
        fp = isls[i]["fp"].astype(np.float32)
        fh, fw = fp.shape
        if fh > g or fw > g:
            return None
        kernel = fp[::-1, ::-1]
        inner = occ[1:-1, 1:-1]
        hits = fftconvolve(inner, kernel, mode="valid")
        free = hits < 0.5
        if not free.any():
            return None
        # Contact : cellules occupées adjacentes à l'empreinte (anneau de 1 cellule).
        ring = binary_dilation(np.pad(fp > 0, 1), SQUARE) & ~np.pad(fp > 0, 1)
        contact = fftconvolve(occ, ring[::-1, ::-1].astype(np.float32), mode="valid")
        score = np.where(free, contact, -1.0)
        best = score.max()
        cy, cx = np.argwhere(score >= best - 0.5)[0]
        inner[cy : cy + fh, cx : cx + fw] += fp
        places[i] = (int(cx), int(cy))
    return places


def pack(isls, size, cell):
    """Essaie plusieurs ordres (surface, plus grand côté, hauteur) ; None si la tuile déborde."""
    g = size // cell
    keys = [
        lambda i: -int(isls[i]["fp"].sum()),
        lambda i: -max(isls[i]["fp"].shape),
        lambda i: (-isls[i]["fp"].shape[0], -isls[i]["fp"].shape[1]),
    ]
    for key in keys:
        places = _pack_order(isls, sorted(range(len(isls)), key=key), g)
        if places is not None:
            return places
    return None


def make_tile(src: Source, isls, places, size, cfg):
    pad, cell = cfg["pad"], cfg["cell"]
    img = np.zeros((size, size, 3), np.uint8)
    core_all = np.zeros((size, size), bool)
    checked = 0
    for i, isl in enumerate(isls):
        cx, cy = places[i]
        # Translation entière : coin de l'empreinte (cellule) − coin du cœur − dilatation.
        dx = cx * cell + pad - isl["x0"]
        dy = cy * cell + pad - isl["y0"]
        isl["dx"], isl["dy"] = dx, dy
        core = isl["core"]
        h, w = core.shape
        tx, ty = isl["x0"] + dx, isl["y0"] + dy
        src_px = src.atlases[isl["prim"]][isl["y0"] : isl["y0"] + h, isl["x0"] : isl["x0"] + w]
        dst = img[ty : ty + h, tx : tx + w]
        if np.any(core_all[ty : ty + h, tx : tx + w] & core):
            raise AssertionError("recouvrement de deux îlots")
        dst[core] = src_px[core]
        core_all[ty : ty + h, tx : tx + w] |= core
    # Remplissage par le pixel de cœur le plus proche (dilatation + fond).
    iy, ix = distance_transform_edt(~core_all, return_distances=False, return_indices=True)
    img = img[iy, ix]
    # Test de non-perte : chaque pixel de cœur est identique à l'atlas de référence.
    for isl in isls:
        core = isl["core"]
        h, w = core.shape
        a = src.atlases[isl["prim"]][isl["y0"] : isl["y0"] + h, isl["x0"] : isl["x0"] + w][core]
        b = img[isl["y0"] + isl["dy"] : isl["y0"] + isl["dy"] + h, isl["x0"] + isl["dx"] : isl["x0"] + isl["dx"] + w][core]
        if not np.array_equal(a, b):
            raise AssertionError("pixels modifiés")
        checked += int(core.sum())
    return img, core_all, checked


def make_geometry(src: Source, isls, size):
    """Une primitive par tuile ; sommets recopiés, UV translatés. Renvoie attributs, indices, contrôles."""
    names = src.attr_names
    cols = {n: [] for n in names}
    index_rows, uv_err, n_src_verts = [], 0.0, 0
    base = 0
    for isl in isls:
        p = src.glb.primitives[isl["prim"]]
        tri_local = src.local[isl["tris"]]
        tri_idx = p.indices[tri_local]  # (t,3) indices dans la primitive source
        verts, inv = np.unique(tri_idx.reshape(-1), return_inverse=True)
        n_src_verts += len(verts)
        for n in names:
            if n == "TEXCOORD_0":
                continue
            cols[n].append(p.raw[n].data[verts])
        udim = np.floor(np.median(p.uvs[tri_idx].reshape(-1, 2), axis=0))
        ah, aw, _ = src.atlases[isl["prim"]].shape
        old_px = (p.uvs[verts] - udim) * np.array([aw, ah])
        new_uv = ((old_px + np.array([isl["dx"], isl["dy"]])) / size).astype(np.float32)
        uv_err = max(uv_err, float(np.abs(new_uv.astype(np.float64) * size - old_px - [isl["dx"], isl["dy"]]).max()))
        cols["TEXCOORD_0"].append(new_uv)
        index_rows.append(inv.reshape(-1, 3) + base)
        base += len(verts)
    attrs = {}
    for n in names:
        normalized = src.glb.primitives[0].raw[n].normalized
        attrs[n] = Attribute(np.concatenate(cols[n]), normalized)
    return attrs, np.concatenate(index_rows), uv_err


def pyramid(img, size, min_level, lut):
    levels = {size: img}
    cur = img
    s = size
    while s > min_level:
        lin = lut[cur]
        s //= 2
        cur = linear_to_srgb(lin.reshape(s, 2, s, 2, 3).mean(axis=(1, 3)))
        levels[s] = cur
    return levels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="scripts/scan_lod/config.json")
    ap.add_argument("--only", help="indices des feuilles à construire (essai), ex. 0,21,42,63")
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    size, cell = cfg["tileMax"], cfg["cell"]
    out_dir, work = Path(cfg["outDir"]), Path(cfg["workDir"]) / "tiles"
    out_dir.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    lut = srgb_to_linear_lut()

    t0 = time.time()
    src = Source(cfg)
    leaves: list[np.ndarray] = []
    kd_split(np.arange(src.n), src.cent, src.weight, cfg["tiles"], leaves)
    selected = [int(x) for x in args.only.split(",")] if args.only else list(range(len(leaves)))
    print(f"{src.n} triangles, {len(leaves)} feuilles k-d, construction de {len(selected)} ({time.time() - t0:.0f} s)", flush=True)

    queue = [(f"t{i:02d}", leaves[i]) for i in selected]
    tiles_meta, total_checked, total_tris = [], 0, 0
    while queue:
        tid, idx = queue.pop(0)
        t1 = time.time()
        isls = build_islands(src, idx, cfg)
        places = pack(isls, size, cell)
        if places is None:
            halves: list[np.ndarray] = []
            kd_split(idx, src.cent, src.weight, 2, halves)
            print(f"  {tid} : ne tient pas en {size}², recoupée en {tid}a / {tid}b", flush=True)
            queue[:0] = [(tid + "a", halves[0]), (tid + "b", halves[1])]
            continue
        img, core_all, checked = make_tile(src, isls, places, size, cfg)
        attrs, indices, uv_err = make_geometry(src, isls, size)

        # Contrôle géométrie : positions recopiées à l'identique, triangle par triangle.
        p_out = attrs["POSITION"].data[indices]
        p_src = np.concatenate(
            [src.glb.primitives[i["prim"]].raw["POSITION"].data[src.glb.primitives[i["prim"]].indices[src.local[i["tris"]]]] for i in isls]
        )
        if not np.array_equal(p_out, p_src):
            raise AssertionError(f"{tid} : positions modifiées")

        geo = f"{tid}.glb"
        write_glb(out_dir / geo, attrs, indices)
        Image.fromarray(img).save(work / f"{tid}.png", compress_level=1)
        textures = {}
        for s, level in pyramid(img, size, cfg["minLevel"], lut).items():
            name = f"{tid}_{s}.jpg"
            Image.fromarray(level).save(out_dir / name, quality=cfg["jpegQuality"], subsampling=0)
            textures[str(s)] = name
        pos = attrs["POSITION"].data.astype(np.float64)
        fill = core_all.mean()
        tiles_meta.append(
            {
                "id": tid,
                "geometry": geo,
                "bbox": {"min": pos.min(0).round(4).tolist(), "max": pos.max(0).round(4).tolist()},
                "triangles": int(len(indices)),
                "vertices": int(len(pos)),
                "islands": len(isls),
                "fill": round(float(fill), 4),
                "textures": textures,
            }
        )
        total_checked += checked
        total_tris += len(indices)
        print(
            f"  {tid} : {len(indices)} tris · {len(isls)} îlots · cœurs {fill:.0%} de {size}² · "
            f"{checked/1e6:.2f} Mpx identiques · écart UV max {uv_err:.1e} px · {time.time() - t1:.0f} s",
            flush=True,
        )

    levels = sorted({int(s) for t in tiles_meta for s in t["textures"]})
    manifest = {
        "version": 1,
        "source": cfg["source"],
        "frame": "repère local de scan_hd.glb (avant scanTransform)",
        "tileMax": size,
        "levels": levels,
        "trial": bool(args.only),
        "tiles": tiles_meta,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(
        f"\n{len(tiles_meta)} tuiles · {total_tris} triangles · {total_checked/1e6:.1f} Mpx vérifiés identiques à l'atlas 8K"
        f" · manifest {out_dir / 'manifest.json'} · {time.time() - t0:.0f} s"
    )


if __name__ == "__main__":
    main()

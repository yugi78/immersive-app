"""Réduit les atlas de scan_hd.glb d'un facteur entier (2 : 16K → 8K).

Moyenne de boîte N×N calculée en lumière linéaire (sRGB → linéaire → moyenne → sRGB),
par bandes de lignes pour limiter la mémoire. Les UV étant normalisés, ils restent valides.
Sortie : PNG sans perte dans <workDir>/atlas/<nom du matériau>.png — ce sont les
références du test de non-perte du tuilage.

    .venv/Scripts/python scripts/scan_lod/downscale_atlases.py [scripts/scan_lod/config.json]
"""
from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

from glb import read_glb

Image.MAX_IMAGE_PIXELS = None


def srgb_to_linear_lut():
    c = np.arange(256) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(x):
    x = np.clip(x, 0, 1)
    s = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.round(s * 255).astype(np.uint8)


def main():
    cfg_path = Path(sys.argv[1] if len(sys.argv) > 1 else "scripts/scan_lod/config.json")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    f = int(cfg["atlasDownscale"])
    out = Path(cfg["workDir"]) / "atlas"
    out.mkdir(parents=True, exist_ok=True)
    lut = srgb_to_linear_lut()

    glb = read_glb(cfg["source"])
    for p in glb.primitives:
        name = glb.json["materials"][p.material]["name"]
        t0 = time.time()
        src = np.asarray(Image.open(io.BytesIO(glb.image_bytes(glb.material_image(p.material)))).convert("RGB"))
        h, w, _ = src.shape
        if h % f or w % f:
            raise ValueError(f"{name} : {w}x{h} non divisible par {f}")
        dst = np.empty((h // f, w // f, 3), np.uint8)
        band = 512 * f
        for y in range(0, h, band):
            lin = lut[src[y : y + band]]  # (b, w, 3) float32 linéaire
            b = lin.shape[0]
            avg = lin.reshape(b // f, f, w // f, f, 3).mean(axis=(1, 3))
            dst[y // f : (y + b) // f] = linear_to_srgb(avg)
        del src
        Image.fromarray(dst).save(out / f"{name}.png", compress_level=1)
        print(f"{name} : {w}x{h} → {w // f}x{h // f} ({time.time() - t0:.0f} s)", flush=True)


if __name__ == "__main__":
    main()

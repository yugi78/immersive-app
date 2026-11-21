"""Lecture / écriture minimales de GLB en tableaux numpy.

Les attributs sont conservés dans leur type d'origine (`raw`) pour être recopiés
octet pour octet ; `positions` et `uvs` sont aussi fournis en float64 pour les calculs.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

_COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_COMPONENT_ID = {np.dtype(v): k for k, v in _COMPONENT.items()}
_TYPE = {1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4"}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


@dataclass
class Attribute:
    data: np.ndarray  # (V, n), type d'origine
    normalized: bool = False


@dataclass
class Primitive:
    material: int
    positions: np.ndarray  # (V, 3) float64
    uvs: np.ndarray  # (V, 2) float64, convention glTF (v vers le bas)
    indices: np.ndarray  # (T, 3) int64
    attributes: list[str]
    raw: dict[str, Attribute] = field(default_factory=dict)


@dataclass
class Glb:
    json: dict
    bin: bytes
    primitives: list[Primitive]

    def image_bytes(self, index: int) -> bytes:
        view = self.json["bufferViews"][self.json["images"][index]["bufferView"]]
        start = view.get("byteOffset", 0)
        return self.bin[start : start + view["byteLength"]]

    def material_image(self, material: int) -> int:
        tex = self.json["materials"][material]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
        return self.json["textures"][tex]["source"]


def _accessor(doc: dict, binary: bytes, index: int) -> Attribute:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dtype = np.dtype(_COMPONENT[acc["componentType"]])
    n = _COUNT[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", dtype.itemsize * n)
    if stride == dtype.itemsize * n:
        arr = np.frombuffer(binary, dtype, acc["count"] * n, start).reshape(acc["count"], n).copy()
    else:
        rows = [np.frombuffer(binary, dtype, n, start + i * stride) for i in range(acc["count"])]
        arr = np.stack(rows)
    return Attribute(arr, bool(acc.get("normalized", False)))


def read_glb(path: str | Path) -> Glb:
    data = Path(path).read_bytes()
    magic, _version, _length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError(f"{path} n'est pas un GLB")
    json_len, _ = struct.unpack_from("<I4s", data, 12)
    doc = json.loads(data[20 : 20 + json_len])
    bin_len, _ = struct.unpack_from("<I4s", data, 20 + json_len)
    binary = data[28 + json_len : 28 + json_len + bin_len]

    prims = []
    for mesh in doc["meshes"]:
        for p in mesh["primitives"]:
            raw = {k: _accessor(doc, binary, i) for k, i in p["attributes"].items()}
            if raw["POSITION"].normalized or raw["TEXCOORD_0"].normalized:
                raise ValueError("POSITION/TEXCOORD_0 quantifiés non gérés")
            prims.append(
                Primitive(
                    material=p["material"],
                    positions=raw["POSITION"].data.astype(np.float64),
                    uvs=raw["TEXCOORD_0"].data.astype(np.float64),
                    indices=_accessor(doc, binary, p["indices"]).data.reshape(-1, 3).astype(np.int64),
                    attributes=list(p["attributes"].keys()),
                    raw=raw,
                )
            )
    return Glb(doc, binary, prims)


def write_glb(path: str | Path, attributes: dict[str, Attribute], indices: np.ndarray, extras: dict | None = None):
    """GLB à un seul maillage non texturé (les textures sont chargées à part par le viewer)."""
    chunks: list[bytes] = []
    views, accessors, attrs = [], [], {}
    offset = 0

    def add(arr: np.ndarray, target: int, normalized=False, minmax=False) -> int:
        nonlocal offset
        arr = np.ascontiguousarray(arr)
        data = arr.tobytes()
        pad = (-len(data)) % 4
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        chunks.append(data + b"\0" * pad)
        offset += len(data) + pad
        acc = {
            "bufferView": len(views) - 1,
            "componentType": _COMPONENT_ID[arr.dtype],
            "count": int(arr.shape[0]),
            "type": _TYPE[arr.shape[1]] if arr.ndim == 2 else "SCALAR",
        }
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = arr.min(0).tolist()
            acc["max"] = arr.max(0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    for name, a in attributes.items():
        attrs[name] = add(a.data, 34962, a.normalized, minmax=(name == "POSITION"))
    idx = add(indices.reshape(-1).astype(np.uint32), 34963)

    doc = {
        "asset": {"version": "2.0", "generator": "pantheon scan_lod"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": attrs, "indices": idx, "mode": 4}]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    if extras:
        doc["extras"] = extras
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    binary = b"".join(chunks)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)

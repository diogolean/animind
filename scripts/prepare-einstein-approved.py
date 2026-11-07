#!/usr/bin/env python3
"""Older front-only helper. Do not run this to refresh the catalog.

The approved pack now ships three cameras from the full zip
(views/front.png, views/three-quarter.png, views/three-quarter-right.png
and layers/{front,three-quarter,three-quarter-right}/). This script still
rebuilds only the earlier p82 front plate and would overwrite that layout.

Place the approved Einstein pack where the app can serve it.

Reads the p82 pack (ksheet, mouths A–H+X, eyes, voice, motion) and writes:

  public/characters/einstein_approved/   images, voice, demos, puppet.json
  lib/approved/einstein-layout.json      boxes the player uses

The mouth sprites are the approved pixels, cropped to their opaque bounds.
They were drawn on a 2036×2048 plate that is not in the pack. This script
maps that plate onto one frontal frame of ksheet.png (bottom-right cell,
caption cut off). The painted mouth hole is filled from the surrounding
skin so the visemes do not stack on a second mouth. Nothing is redrawn.

The closed-eye sprite does not land on the eyes of this frame, so it is
kept under pack/ and is not a rig layer.

  python3 scripts/prepare-einstein-approved.py \
    --pack /path/to/p82 \
    --en-contact /path/to/einstein_emotions_en_contact.jpg \
    --en-video /path/to/einstein_en.mp4 \
    --pt-video /path/to/einstein_pt.mp4
"""
from __future__ import annotations

import argparse
import json
import shutil
from collections import deque
from pathlib import Path

from PIL import Image

# Bottom-right cell of ksheet.png: frontal, small mouth, caption along the bottom.
CELL = (1, 2)
CAPTION_Y = 620
# Native mouth center on the 2036×2048 viseme plate (midpoint of viseme X).
NATIVE_X = 972.0
NATIVE_Y = 1757.5
# Where that center sits on the 480px-wide ksheet cell, and how the plate scales.
ANCHOR = (242, 488)
SCALE = 0.30
VISEMES = list("ABCDEFGHX")
PUBLIC_ROOT = "/characters/einstein_approved"


def mouth_mask(cell: Image.Image) -> set[tuple[int, int]]:
    px = cell.load()
    width, height = cell.size
    seen: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque([ANCHOR])
    while queue:
        x, y = queue.popleft()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        red, green, blue, _alpha = px[x, y]
        if red > 80 or green > 60 or blue > 60:
            continue
        seen.add((x, y))
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    dilated: set[tuple[int, int]] = set()
    for x, y in seen:
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                dilated.add((x + dx, y + dy))
    return {(x, y) for x, y in dilated if 0 <= x < width and 0 <= y < height}


def inpaint(cell: Image.Image, mask: set[tuple[int, int]]) -> None:
    px = cell.load()
    width, height = cell.size
    pending = set(mask)
    for radius in range(1, 48):
        done: list[tuple[int, int]] = []
        for x, y in pending:
            found = None
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    nx, ny = x + dx, y + dy
                    if (nx, ny) in mask or not (0 <= nx < width and 0 <= ny < height):
                        continue
                    found = px[nx, ny]
                    break
                if found:
                    break
            if found:
                px[x, y] = found
                done.append((x, y))
        for item in done:
            pending.discard(item)
        if not pending:
            break


def content_box(image: Image.Image) -> tuple[int, int, int, int]:
    box = image.getchannel("A").point(lambda p: 255 if p > 12 else 0).getbbox()
    if not box:
        raise SystemExit("sprite has no opaque pixels")
    return box


def mapped_box(box: tuple[int, int, int, int]) -> dict[str, int]:
    x0, y0, x1, y1 = box
    ax, ay = ANCHOR
    return {
        "x": round(ax + (x0 - NATIVE_X) * SCALE),
        "y": round(ay + (y0 - NATIVE_Y) * SCALE),
        "w": max(1, round((x1 - x0) * SCALE)),
        "h": max(1, round((y1 - y0) * SCALE)),
        "z": 8,
    }


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def main() -> None:
    raise SystemExit(
        "Este script republicava a frente antiga em public/. "
        "Os dois pacotes privados estão em private/characters/ e não devem voltar para o catálogo público."
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", required=True, type=Path)
    parser.add_argument("--en-contact", required=True, type=Path)
    parser.add_argument("--en-video", required=True, type=Path)
    parser.add_argument("--pt-video", required=True, type=Path)
    parser.add_argument("--dest", type=Path, default=Path("public/characters/einstein_approved"))
    parser.add_argument("--layout", type=Path, default=Path("lib/approved/einstein-layout.json"))
    args = parser.parse_args()

    pack: Path = args.pack
    dest: Path = args.dest
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    sheet = Image.open(pack / "ksheet.png").convert("RGBA")
    cell_w, cell_h = sheet.size[0] // 3, sheet.size[1] // 2
    row, col = CELL
    cell = sheet.crop((col * cell_w, row * cell_h, (col + 1) * cell_w, (row + 1) * cell_h))
    front = cell.crop((0, 0, cell.size[0], CAPTION_Y))
    save_png(front, dest / "views" / "front.png")

    plate = cell.copy()
    inpaint(plate, mouth_mask(cell))
    body = plate.crop((0, 0, cell.size[0], CAPTION_Y))
    save_png(body, dest / "layers" / "front" / "body.png")
    save_png(sheet, dest / "emotion-sheet.png")
    shutil.copyfile(args.en_contact, dest / "emotion-sheet-en.jpg")

    (dest / "pack").mkdir(parents=True)
    visemes: dict[str, dict[str, int | str]] = {}
    for name in VISEMES:
        source = Image.open(pack / f"front_mouth_smile_{name}.png").convert("RGBA")
        box = content_box(source)
        save_png(source.crop(box), dest / "mouths" / f"{name}.png")
        shutil.copyfile(pack / f"front_mouth_smile_{name}.png", dest / "pack" / f"front_mouth_smile_{name}.png")
        placed = mapped_box(box)
        placed["url"] = f"{PUBLIC_ROOT}/mouths/{name}.png"
        visemes[name] = placed

    for extra in (
        "front_eyes_fechado.png",
        "eyes.png",
        "derived.png",
        "smile2.png",
        "zB.png",
        "mouth_en.json",
        "motion_en.json",
        "motion_pt.json",
    ):
        target = dest / "pack" / extra
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(pack / extra, target)
    for name in ("dialog_en.txt", "mouth_en.json", "motion_en.json", "motion_pt.json", "voice_en.mp3"):
        shutil.copyfile(pack / name, dest / name)
    demo = dest / "demo"
    demo.mkdir(parents=True)
    shutil.copyfile(args.en_video, demo / "einstein_en.mp4")
    shutil.copyfile(args.pt_video, demo / "einstein_pt.mp4")

    dialog = (pack / "dialog_en.txt").read_text(encoding="utf-8").strip()
    (dest / "persona.txt").write_text("https://en.wikiquote.org/wiki/Albert_Einstein\n", encoding="utf-8")

    canvas = {"w": body.size[0], "h": body.size[1]}
    layers = [
        {
            "name": "body",
            "url": "layers/front/body.png",
            "x": 0,
            "y": 0,
            "w": canvas["w"],
            "h": canvas["h"],
            "z": 1,
        }
    ]
    puppet_visemes = {
        name: {
            "name": "mouth",
            "url": f"mouths/{name}.png",
            "x": spec["x"],
            "y": spec["y"],
            "w": spec["w"],
            "h": spec["h"],
            "z": 8,
        }
        for name, spec in visemes.items()
    }
    view = {"canvas": canvas, "layers": layers, "visemes": puppet_visemes}
    puppet = {
        "name": "Albert Einstein",
        "personaSheetRef": "https://en.wikiquote.org/wiki/Albert_Einstein",
        "artStyle": "ghibli",
        "emotionSheet": "emotion-sheet.png",
        "views": {"front": view, "left": view, "right": view},
        "note": "Approved p82 pack. left/right reuse the front plate; 3/4 views were not in the pack.",
    }
    (dest / "puppet.json").write_text(json.dumps(puppet, indent=2) + "\n", encoding="utf-8")

    layout = {
        "id": "chr_einstein_approved",
        "name": "Albert Einstein",
        "personaSheetRef": "https://en.wikiquote.org/wiki/Albert_Einstein",
        "createdAt": "2026-11-04T00:00:00.000Z",
        "canvas": canvas,
        "front": f"{PUBLIC_ROOT}/views/front.png",
        "body": f"{PUBLIC_ROOT}/layers/front/body.png",
        "emotionSheet": f"{PUBLIC_ROOT}/emotion-sheet.png",
        "emotionSheetEn": f"{PUBLIC_ROOT}/emotion-sheet-en.jpg",
        "voiceEn": f"{PUBLIC_ROOT}/voice_en.mp3",
        "dialogEn": dialog,
        "demoEn": f"{PUBLIC_ROOT}/demo/einstein_en.mp4",
        "demoPt": f"{PUBLIC_ROOT}/demo/einstein_pt.mp4",
        "visemes": visemes,
    }
    args.layout.parent.mkdir(parents=True, exist_ok=True)
    args.layout.write_text(json.dumps(layout, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dest} and {args.layout}")


if __name__ == "__main__":
    main()

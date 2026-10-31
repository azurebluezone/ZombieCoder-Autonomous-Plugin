#!/usr/bin/env python3
"""Deterministic fixtures for selfcheck/tests. No network, no model."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def make_input(path: Path) -> None:
    width, height = 900, 700
    image = Image.new("RGB", (width, height), (24, 32, 48))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        blend = y / height
        draw.line([(0, y), (width, y)], fill=(int(30 + 60 * blend), int(40 + 80 * blend), int(60 + 50 * blend)))
    draw.ellipse([610, 70, 770, 230], fill=(240, 190, 90))
    draw.polygon([(0, 520), (260, 300), (520, 520)], fill=(40, 90, 70))
    draw.polygon([(300, 560), (600, 330), (900, 560)], fill=(28, 70, 58))
    draw.rectangle([0, 560, width, height], fill=(18, 44, 38))
    image.save(path, quality=92)


def make_logo(path: Path) -> None:
    size = 240
    logo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(logo)
    draw.ellipse([8, 8, size - 8, size - 8], fill=(230, 180, 60, 255))
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 96)
    box = draw.textbbox((0, 0), "ZC", font=font)
    draw.text(
        ((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]),
        "ZC",
        font=font,
        fill=(24, 24, 24, 255),
    )
    logo.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()
    out = Path(args.dir)
    out.mkdir(parents=True, exist_ok=True)
    make_input(out / "input.jpg")
    make_logo(out / "logo.png")
    print(out / "input.jpg")
    print(out / "logo.png")


if __name__ == "__main__":
    main()

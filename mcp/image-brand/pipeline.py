#!/usr/bin/env python3
"""PIL composition core for the image-brand MCP server.

The server passes one JSON spec file; this script writes one JPEG/PNG plus a
sidecar JSON. Text is drawn in script runs because Noto Sans Bengali has no
Latin glyphs (and no middle dot), so a single-font draw silently produces tofu.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont, ImageOps, features

VERSION = "1.1.0"
BENGALI = re.compile(r"[\u0980-\u09FF]")
DEFAULT_BN_FONT = "/usr/share/fonts/truetype/noto/NotoSansBengali-Bold.ttf"
DEFAULT_BN_FONT_REGULAR = "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf"
DEFAULT_LATIN_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
DEFAULT_LATIN_FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def fail(message: str) -> "NoReturn":
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    sys.exit(1)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_aspect(value: str) -> float:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*", str(value))
    if not match:
        fail(f"aspect must look like W:H, got {value!r}")
    width, height = float(match.group(1)), float(match.group(2))
    if width <= 0 or height <= 0:
        fail("aspect sides must be positive")
    return width / height


def focus_offsets(focus: str) -> tuple[float, float]:
    focus = (focus or "center").lower()
    table = {
        "center": (0.5, 0.5),
        "top": (0.5, 0.0),
        "bottom": (0.5, 1.0),
        "left": (0.0, 0.5),
        "right": (1.0, 0.5),
        "top-left": (0.0, 0.0),
        "top-right": (1.0, 0.0),
        "bottom-left": (0.0, 1.0),
        "bottom-right": (1.0, 1.0),
    }
    if focus not in table:
        fail(f"unknown focus {focus!r}; use one of {', '.join(sorted(table))}")
    return table[focus]


def crop_box(size: tuple[int, int], spec: dict) -> tuple[int, int, int, int]:
    width, height = size
    rect = spec.get("rect")
    if rect:
        if not (isinstance(rect, (list, tuple)) and len(rect) == 4):
            fail("crop.rect must be [x, y, w, h] in 0..1")
        x, y, w, h = (float(v) for v in rect)
        if min(x, y, w, h) < 0 or x + w > 1.0001 or y + h > 1.0001 or w <= 0 or h <= 0:
            fail("crop.rect must stay inside 0..1 and have positive size")
        box = (round(x * width), round(y * height), round((x + w) * width), round((y + h) * height))
        return box
    ratio = parse_aspect(spec.get("aspect", "4:5"))
    fx, fy = focus_offsets(spec.get("focus", "center"))
    if width / height > ratio:
        crop_w, crop_h = round(height * ratio), height
        left = round((width - crop_w) * fx)
        top = 0
    else:
        crop_w, crop_h = width, round(width / ratio)
        left = 0
        top = round((height - crop_h) * fy)
    return (left, top, left + crop_w, top + crop_h)


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    if not os.path.isfile(path):
        fail(f"font not found: {path}")
    return ImageFont.truetype(path, size)


def runs_of(text: str) -> list[tuple[str, bool]]:
    runs: list[tuple[str, bool]] = []
    for char in text:
        is_bn = bool(BENGALI.match(char))
        if runs and runs[-1][1] == is_bn:
            runs[-1] = (runs[-1][0] + char, is_bn)
        else:
            runs.append((char, is_bn))
    return runs


class TextEngine:
    def __init__(self, spec: dict, draw: ImageDraw.ImageDraw):
        fonts = spec.get("fonts") or {}
        self.bn_bold = fonts.get("bengali_bold") or os.environ.get("IMAGE_BRAND_BN_FONT") or DEFAULT_BN_FONT
        self.bn_regular = (
            fonts.get("bengali_regular")
            or os.environ.get("IMAGE_BRAND_BN_FONT_REGULAR")
            or DEFAULT_BN_FONT_REGULAR
        )
        self.latin_bold = fonts.get("latin_bold") or os.environ.get("IMAGE_BRAND_LATIN_FONT") or DEFAULT_LATIN_FONT
        self.latin_regular = (
            fonts.get("latin_regular")
            or os.environ.get("IMAGE_BRAND_LATIN_FONT_REGULAR")
            or DEFAULT_LATIN_FONT_REGULAR
        )
        self.draw = draw
        self.cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

    def font(self, bengali: bool, size: int, bold: bool) -> ImageFont.FreeTypeFont:
        path = self.bn_bold if bengali and bold else self.bn_regular if bengali else self.latin_bold if bold else self.latin_regular
        key = (path, size)
        if key not in self.cache:
            self.cache[key] = load_font(path, size)
        return self.cache[key]

    def word_width(self, word: str, size: int, bold: bool) -> float:
        total = 0.0
        for chunk, is_bn in runs_of(word):
            total += self.draw.textlength(chunk, font=self.font(is_bn, size, bold))
        return total

    def gap(self, size: int) -> int:
        # A whitespace-only run measures as zero in Raqm, so draw explicit gaps
        # between words instead of relying on a space glyph.
        return max(4, round(size * 0.27))

    def line_width(self, line: str, size: int, bold: bool) -> float:
        words = line.split()
        if not words:
            return 0.0
        return sum(self.word_width(word, size, bold) for word in words) + self.gap(size) * (len(words) - 1)

    def wrap(self, text: str, size: int, bold: bool, max_width: float) -> list[str]:
        lines: list[str] = []
        current: list[str] = []
        for word in text.split():
            trial = " ".join(current + [word])
            if current and self.line_width(trial, size, bold) > max_width:
                lines.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            lines.append(" ".join(current))
        return lines or [""]

    def fit(
        self,
        text: str,
        sizes: list[int],
        bold: bool,
        max_width: float,
        max_lines: int,
        max_height: float,
    ) -> tuple[int, list[str]]:
        for size in sizes:
            lines = self.wrap(text, size, bold, max_width)
            line_height = round(size * 1.32)
            if len(lines) <= max_lines and len(lines) * line_height <= max_height:
                return size, lines
        size = sizes[-1]
        return size, self.wrap(text, size, bold, max_width)

    def draw_line(self, position: tuple[float, float], text: str, size: int, bold: bool, fill) -> None:
        words = text.split()
        if not words:
            return
        x, y = position
        ascent = max(self.font(is_bn, size, bold).getmetrics()[0] for _, is_bn in runs_of(text) or [(text, False)])
        baseline = y + ascent
        for index, word in enumerate(words):
            for chunk, is_bn in runs_of(word):
                font = self.font(is_bn, size, bold)
                run_ascent = font.getmetrics()[0]
                self.draw.text((x, baseline - run_ascent), chunk, font=font, fill=fill)
                x += self.draw.textlength(chunk, font=font)
            if index < len(words) - 1:
                x += self.gap(size)


def gradient_band(canvas: Image.Image, height: int, alpha: int) -> None:
    width = canvas.width
    strip = Image.new("L", (1, height))
    for y in range(height):
        strip.putpixel((0, y), int(alpha * (y / max(1, height - 1)) ** 1.45))
    mask = strip.resize((width, height))
    shade = Image.new("RGBA", (width, height), (8, 10, 16, 255))
    shade.putalpha(mask)
    canvas.alpha_composite(shade, (0, canvas.height - height))


def place_logo(canvas: Image.Image, logo_path: str, margin: int, max_h: int, max_w: int, position: str) -> dict:
    logo = Image.open(logo_path).convert("RGBA")
    scale = min(max_w / logo.width, max_h / logo.height, 1.0)
    logo = logo.resize((max(1, round(logo.width * scale)), max(1, round(logo.height * scale))), Image.LANCZOS)
    shadow = Image.new("RGBA", (logo.width + 16, logo.height + 16), (0, 0, 0, 0))
    tint = Image.new("RGBA", logo.size, (0, 0, 0, 150))
    tint.putalpha(logo.getchannel("A"))
    shadow.alpha_composite(tint, (8, 10))
    shadow = shadow.filter(ImageFilter.GaussianBlur(6))
    x = margin if position != "top-right" else canvas.width - margin - logo.width
    y = margin
    canvas.alpha_composite(shadow, (x - 8, y - 8))
    canvas.alpha_composite(logo, (x, y))
    return {"path": logo_path, "box": [x, y, x + logo.width, y + logo.height], "mode": "image"}


def draw_wordmark(canvas: Image.Image, engine: TextEngine, margin: int, accent: str, brand: str) -> dict:
    size = max(30, round(canvas.width * 0.032))
    radius = round(size * 1.05)
    draw = ImageDraw.Draw(canvas)
    draw.ellipse([margin, margin, margin + radius * 2, margin + radius * 2], fill=accent)
    mark_font = load_font(DEFAULT_LATIN_FONT, round(radius * 0.95))
    mark = "ZC"
    box = draw.textbbox((0, 0), mark, font=mark_font)
    draw.text(
        (margin + radius - (box[2] - box[0]) / 2 - box[0], margin + radius - (box[3] - box[1]) / 2 - box[1]),
        mark,
        font=mark_font,
        fill=(24, 24, 24, 255),
    )
    engine.draw_line((margin + radius * 2 + 18, margin + radius * 0.45), brand, size, True, (255, 255, 255, 240))
    return {"path": None, "box": [margin, margin, margin + radius * 2, margin + radius * 2], "mode": "wordmark"}


def compose(spec: dict) -> dict:
    input_path = Path(spec["input"]).expanduser()
    if not input_path.is_file():
        fail(f"input image not found: {input_path}")
    output_path = Path(spec.get("output") or input_path.with_name(input_path.stem + "-branded.jpg")).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    crop_spec = spec.get("crop") or {}
    ratio = parse_aspect(crop_spec.get("aspect", "4:5"))
    canvas_spec = spec.get("canvas") or {}
    canvas_w = int(canvas_spec.get("width") or 1080)
    canvas_h = int(canvas_spec.get("height") or round(canvas_w / ratio))
    if canvas_w < 200 or canvas_h < 200:
        fail("canvas is too small")

    source = ImageOps.exif_transpose(Image.open(input_path)).convert("RGB")
    box = crop_box(source.size, crop_spec)
    cropped = source.crop(box)
    canvas = cropped.resize((canvas_w, canvas_h), Image.LANCZOS).convert("RGBA")

    theme = spec.get("theme") or {}
    accent = theme.get("accent") or "#e6b43c"
    margin = max(28, round(canvas_w * 0.055))
    engine = TextEngine(spec, ImageDraw.Draw(canvas))

    band_h = round(canvas_h * float(theme.get("band_fraction") or 0.38))
    band_h = max(280, min(band_h, round(canvas_h * 0.48)))
    gradient_band(canvas, band_h + round(canvas_h * 0.05), int(theme.get("scrim_alpha") or 235))
    draw = ImageDraw.Draw(canvas)

    title = str(spec.get("title") or "").strip()
    if not title:
        fail("title is required")
    subtitle = str(spec.get("subtitle") or "").strip()
    attribution = str(spec.get("attribution") or "").strip()

    attr_size = max(17, round(canvas_w * 0.019))
    attr_y = canvas_h - margin - round(attr_size * 1.2)
    if attribution:
        engine.draw_line((margin, attr_y), attribution, attr_size, False, (215, 215, 215, 230))

    block_bottom = attr_y - round(attr_size * 0.9) if attribution else canvas_h - margin
    title_sizes = list(range(min(96, round(canvas_w * 0.085)), 39, -4))
    title_size, title_lines = engine.fit(
        title,
        title_sizes,
        True,
        canvas_w - margin * 2,
        2,
        band_h * 0.62,
    )
    subtitle_size = max(24, round(title_size * 0.44))
    subtitle_lines = engine.wrap(subtitle, subtitle_size, False, canvas_w - margin * 2) if subtitle else []
    line_gap = round(title_size * 0.26)
    subtitle_gap = round(subtitle_size * 0.5)
    title_h = len(title_lines) * round(title_size * 1.32)
    subtitle_h = len(subtitle_lines) * round(subtitle_size * 1.32)
    block_h = title_h + (subtitle_h + subtitle_gap if subtitle_lines else 0) + round(title_size * 0.1)
    title_top = block_bottom - block_h
    if title_top < canvas_h - band_h:
        title_top = canvas_h - band_h + round(band_h * 0.06)

    y = title_top
    for line in title_lines:
        engine.draw_line((margin, y), line, title_size, True, (255, 255, 255, 255))
        y += round(title_size * 1.32)
    if subtitle_lines:
        y += subtitle_gap
        for line in subtitle_lines:
            engine.draw_line((margin, y), line, subtitle_size, False, (240, 230, 208, 255))
            y += round(subtitle_size * 1.32)

    logo_path = spec.get("logo")
    if logo_path:
        logo_info = place_logo(
            canvas,
            str(Path(logo_path).expanduser()),
            margin,
            round(canvas_h * 0.085),
            round(canvas_w * 0.3),
            theme.get("logo_position") or "top-left",
        )
    else:
        logo_info = draw_wordmark(canvas, engine, margin, accent, str(theme.get("brand") or "ZombieCoder"))

    quality = int(spec.get("quality") or 92)
    suffix = output_path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        canvas.convert("RGB").save(output_path, quality=quality, subsampling=1)
    elif suffix == ".png":
        canvas.save(output_path)
    else:
        fail(f"unsupported output extension {suffix}; use .jpg/.jpeg/.png")

    sidecar_path = output_path.with_suffix(".json")
    source_meta = spec.get("source") or {}
    fixture = {
        "ok": True,
        "version": VERSION,
        "output": str(output_path),
        "output_bytes": output_path.stat().st_size,
        "output_sha256": sha256_file(output_path),
        "sidecar": str(sidecar_path),
        "canvas": [canvas_w, canvas_h],
        "crop_box": list(box),
        "source_size": list(source.size),
        "source_sha256": sha256_file(input_path),
        "title": title,
        "subtitle": subtitle,
        "attribution": attribution,
        "logo": logo_info,
        "fonts": {
            "bengali_bold": engine.bn_bold,
            "bengali_regular": engine.bn_regular,
            "latin_bold": engine.latin_bold,
            "latin_regular": engine.latin_regular,
            "raqm": bool(features.check("raqm")),
        },
        "provider": source_meta.get("provider"),
        "source_page": source_meta.get("page"),
        "license": source_meta.get("license"),
        "creator": source_meta.get("creator"),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    sidecar_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return fixture


def parse_color(value: str) -> tuple[int, int, int]:
    try:
        return ImageColor.getrgb(str(value))
    except ValueError:
        fail(f"invalid background color {value!r}; use #rrggbb")


def save_image(canvas: Image.Image, output_path: Path, quality: int, format_hint: str | None) -> str:
    suffix = output_path.suffix.lower()
    if format_hint:
        suffix = {"jpg": ".jpg", "jpeg": ".jpg", "png": ".png", "webp": ".webp"}.get(format_hint.lower(), suffix)
    if suffix in (".jpg", ".jpeg"):
        canvas.convert("RGB").save(output_path, quality=quality, subsampling=1)
    elif suffix == ".png":
        canvas.save(output_path)
    elif suffix == ".webp":
        canvas.convert("RGB").save(output_path, quality=quality, method=4)
    else:
        fail(f"unsupported output extension {suffix}; use .jpg/.jpeg/.png/.webp")
    return suffix


def fit_image(spec: dict) -> dict:
    """Exact-size delivery crop: cover (fill, crop edges) or contain (pad)."""
    input_path = Path(spec["input"]).expanduser()
    if not input_path.is_file():
        fail(f"input image not found: {input_path}")
    width = int(spec.get("width") or 0)
    height = int(spec.get("height") or 0)
    if not (1 <= width <= 8000 and 1 <= height <= 8000):
        fail("width and height must be between 1 and 8000")
    mode = str(spec.get("fit") or "cover").lower()
    if mode not in ("cover", "contain"):
        fail("fit must be cover or contain")

    output_path = Path(spec.get("output") or input_path.with_name(f"{input_path.stem}-{width}x{height}.jpg")).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    source = ImageOps.exif_transpose(Image.open(input_path)).convert("RGB")
    crop_spec = spec.get("crop") or {}
    box = crop_box(source.size, crop_spec) if crop_spec else (0, 0, source.width, source.height)
    cropped = source.crop(box)

    if mode == "cover":
        focus = str(spec.get("focus") or crop_spec.get("focus") or "center")
        fx, fy = focus_offsets(focus)
        canvas = ImageOps.fit(cropped, (width, height), method=Image.LANCZOS, centering=(fx, fy))
    else:
        inner = ImageOps.contain(cropped, (width, height), method=Image.LANCZOS)
        canvas = Image.new("RGB", (width, height), parse_color(spec.get("background") or "#000000"))
        canvas.paste(inner, ((width - inner.width) // 2, (height - inner.height) // 2))

    quality = max(60, min(100, int(spec.get("quality") or 92)))
    save_image(canvas, output_path, quality, spec.get("format"))

    sidecar_path = output_path.with_suffix(".json")
    source_meta = spec.get("source") or {}
    fixture = {
        "ok": True,
        "version": VERSION,
        "op": "fit",
        "output": str(output_path),
        "output_bytes": output_path.stat().st_size,
        "output_sha256": sha256_file(output_path),
        "sidecar": str(sidecar_path),
        "width": width,
        "height": height,
        "fit": mode,
        "canvas": [width, height],
        "crop_box": list(box),
        "source_size": list(source.size),
        "source_sha256": sha256_file(input_path),
        "provider": source_meta.get("provider"),
        "source_page": source_meta.get("page"),
        "license": source_meta.get("license"),
        "creator": source_meta.get("creator"),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    sidecar_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return fixture


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value).lower()).strip("-")
    return (slug[:48] or "site").strip("-")


def cover_image(path: Path, width: int, height: int) -> Image.Image:
    source = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return ImageOps.fit(source, (width, height), method=Image.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")


def gradient_canvas(width: int, height: int, accent: tuple[int, int, int], site: str) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (10, 16, 28, 255))
    draw = ImageDraw.Draw(canvas)
    top = (18 + accent[0] // 8, 22 + accent[1] // 8, 34 + accent[2] // 8)
    bottom = (7, 10, 18)
    for y in range(height):
        blend = y / max(1, height - 1)
        color = tuple(round(top[i] * (1 - blend) + bottom[i] * blend) for i in range(3))
        draw.line([(0, y), (width, y)], fill=color + (255,))
    # Large translucent shapes give the placeholder depth without stock art.
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shape = ImageDraw.Draw(layer)
    shape.ellipse([width * 0.62, -height * 0.25, width * 1.05, height * 0.55], fill=accent + (54,))
    shape.ellipse([-width * 0.18, height * 0.45, width * 0.35, height * 1.1], fill=accent + (38,))
    if site == "hospital":
        shape.rounded_rectangle([width * 0.72, height * 0.52, width * 0.88, height * 0.9], radius=18, fill=(255, 255, 255, 18))
    elif site == "lms":
        for i in range(3):
            shape.rounded_rectangle(
                [width * 0.7, height * (0.5 + i * 0.12), width * 0.92, height * (0.56 + i * 0.12)],
                radius=12,
                fill=(255, 255, 255, 22),
            )
    else:
        shape.rounded_rectangle([width * 0.7, height * 0.58, width * 0.93, height * 0.84], radius=22, fill=(255, 255, 255, 20))
    return Image.alpha_composite(canvas, layer)


def draw_hero_text(canvas: Image.Image, engine: TextEngine, spec: dict, margin: int, max_width: int) -> None:
    kicker = str(spec.get("kicker") or spec.get("site") or "site").upper()
    headline = str(spec.get("headline") or spec.get("brand") or "").strip()
    subheadline = str(spec.get("subheadline") or "").strip()
    accent = ImageColor.getrgb(str(spec.get("accent") or "#e6b43c"))
    draw = ImageDraw.Draw(canvas)
    bottom = canvas.height - margin
    kicker_size = max(22, round(canvas.width * 0.017))
    engine.draw_line((margin, bottom - round(canvas.height * 0.30)), kicker, kicker_size, True, accent + (255,))
    title_size, title_lines = engine.fit(
        headline,
        list(range(min(92, round(canvas.width * 0.058)), 39, -4)),
        True,
        max_width,
        3,
        canvas.height * 0.28,
    )
    sub_size = max(24, round(title_size * 0.42))
    sub_lines = engine.wrap(subheadline, sub_size, False, max_width) if subheadline else []
    block = len(title_lines) * round(title_size * 1.24) + (len(sub_lines) * round(sub_size * 1.32) + round(sub_size * 0.5) if sub_lines else 0)
    y = bottom - block
    for line in title_lines:
        engine.draw_line((margin, y), line, title_size, True, (255, 255, 255, 255))
        y += round(title_size * 1.24)
    if sub_lines:
        y += round(sub_size * 0.5)
        for line in sub_lines:
            engine.draw_line((margin, y), line, sub_size, False, (229, 231, 235, 255))
            y += round(sub_size * 1.32)
    draw.line([(margin, bottom + round(margin * 0.25)), (margin + round(canvas.width * 0.18), bottom + round(margin * 0.25))], fill=accent + (255,), width=max(4, round(canvas.width * 0.003)))


def decorate(spec: dict) -> dict:
    brand = str(spec.get("brand") or "").strip()
    if not brand:
        fail("brand is required")
    site = str(spec.get("site") or "generic").lower()
    if site not in ("ecommerce", "hospital", "lms", "generic"):
        fail("site must be ecommerce, hospital, lms or generic")
    out_dir = Path(spec.get("output_dir") or ".").expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = slugify(brand)
    accent_value = str(spec.get("accent") or "#e6b43c")
    try:
        accent = ImageColor.getrgb(accent_value)
    except ValueError:
        fail(f"invalid accent {accent_value!r}; use #rrggbb")
    margin = 72
    files: dict[str, object] = {}

    # Logo: always written as <slug>-logo.png, whether supplied or generated.
    logo_path = out_dir / f"{slug}-logo.png"
    if spec.get("logo"):
        supplied = Path(str(spec["logo"])).expanduser()
        if not supplied.is_file():
            fail(f"logo not found: {supplied}")
        logo = Image.open(supplied).convert("RGBA")
        logo.thumbnail((640, 160), Image.LANCZOS)
        canvas = Image.new("RGBA", (720, 180), (0, 0, 0, 0))
        canvas.alpha_composite(logo, ((720 - logo.width) // 2, (180 - logo.height) // 2))
    else:
        canvas = Image.new("RGBA", (720, 180), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle([8, 38, 112, 142], radius=26, fill=accent + (255,))
        mark_font = load_font(DEFAULT_LATIN_FONT, 52)
        box = draw.textbbox((0, 0), "ZC", font=mark_font)
        draw.text((60 - (box[2] - box[0]) / 2 - box[0], 90 - (box[3] - box[1]) / 2 - box[1]), "ZC", font=mark_font, fill=(18, 20, 26, 255))
        engine = TextEngine(spec, draw)
        size, lines = engine.fit(brand, list(range(66, 27, -2)), True, 570, 1, 140)
        engine.draw_line((138, 52), lines[0], size, True, (255, 255, 255, 255))
    canvas.save(logo_path)
    files["logo"] = str(logo_path)

    # Hero: supplied photo gets a scrim; with no photo a branded gradient is
    # still a real image, not a broken <img>.
    hero_w, hero_h = 1600, 900
    images = [Path(str(entry)).expanduser() for entry in (spec.get("images") or []) if str(entry).strip()]
    for image in images:
        if not image.is_file():
            fail(f"image not found: {image}")
    if images:
        hero = cover_image(images[0], hero_w, hero_h)
    else:
        hero = gradient_canvas(hero_w, hero_h, accent, site)
    gradient_band(hero, round(hero_h * 0.62), 226)
    hero_engine = TextEngine(spec, ImageDraw.Draw(hero))
    draw_hero_text(hero, hero_engine, {**spec, "site": site, "accent": accent_value}, margin, hero_w - margin * 2)
    hero_path = out_dir / f"{slug}-hero.jpg"
    hero.convert("RGB").save(hero_path, quality=90, subsampling=1)
    files["hero"] = str(hero_path)

    # OG card reuses the hero so social preview and page agree.
    og = ImageOps.fit(hero, (1200, 630), method=Image.LANCZOS).convert("RGBA")
    og_path = out_dir / f"{slug}-og.jpg"
    og.convert("RGB").save(og_path, quality=90, subsampling=1)
    files["og"] = str(og_path)

    cards: list[str] = []
    for index, image in enumerate(images[1:4], start=1):
        card = cover_image(image, 640, 420)
        card_path = out_dir / f"{slug}-card-{index}.jpg"
        card.convert("RGB").save(card_path, quality=88, subsampling=1)
        cards.append(str(card_path))
    files["cards"] = cards

    fixture = {
        "ok": True,
        "version": VERSION,
        "op": "decorate",
        "site": site,
        "brand": brand,
        "slug": slug,
        "dir": str(out_dir),
        "files": files,
        "hashes": {name: sha256_file(Path(path)) for name, path in files.items() if isinstance(path, str)},
        "card_hashes": [sha256_file(Path(path)) for path in cards],
        "canvas": {"hero": [hero_w, hero_h], "og": [1200, 630], "logo": [720, 180]},
        "fonts": {
            "bengali_bold": hero_engine.bn_bold,
            "bengali_regular": hero_engine.bn_regular,
            "latin_bold": hero_engine.latin_bold,
            "latin_regular": hero_engine.latin_regular,
            "raqm": bool(features.check("raqm")),
        },
        "created": datetime.now(timezone.utc).isoformat(),
    }
    return fixture


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, help="path to the JSON composition spec")
    args = parser.parse_args()
    try:
        spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
        if spec.get("op") == "fit":
            result = fit_image(spec)
        elif spec.get("op") == "decorate":
            result = decorate(spec)
        else:
            result = compose(spec)
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 - surface one JSON error to the MCP caller
        fail(f"{type(error).__name__}: {error}")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""Draw the app icons (a basketball on a scoreboard-navy tile).

    python scripts/make_icons.py

Writes assets/icons/icon-192.png, icon-512.png, maskable-512.png and
apple-touch-icon.png. favicon.svg is the same drawing by hand.
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"
NAVY, ORANGE, SEAM, RIM = (15, 27, 45), (232, 112, 42), (27, 15, 5), (242, 140, 59)


def draw(size: int, ball: float, rounded: bool) -> Image.Image:
    s = 4  # supersample, then shrink for smooth edges
    big = size * s
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=NAVY)
    else:
        d.rectangle([0, 0, big, big], fill=NAVY)
    c, r = big / 2, big * ball / 2
    w = max(2, int(big * 0.022))
    # ball and seams on their own layer, clipped to the circle
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse([c - r, c - r, c + r, c + r], fill=ORANGE)
    ld.line([c - r, c, c + r, c], fill=SEAM, width=w)                   # horizontal seam
    ld.line([c, c - r, c, c + r], fill=SEAM, width=w)                   # vertical seam
    k = r * 0.62                                                        # curved side seams
    ld.arc([c - r - k, c - r, c - r + k * 1.25, c + r], -70, 70, fill=SEAM, width=w)
    ld.arc([c + r - k * 1.25, c - r, c + r + k, c + r], 110, 250, fill=SEAM, width=w)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse([c - r, c - r, c + r, c + r], fill=255)
    img.paste(layer, (0, 0), mask)
    d.ellipse([c - r, c - r, c + r, c + r], outline=SEAM, width=w)
    # orange baseline bar under the ball, like the nav bar's stripe
    bar = big * 0.035
    d.rectangle([c - r * 0.9, c + r + big * 0.05, c + r * 0.9, c + r + big * 0.05 + bar], fill=RIM)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192, 0.60, True).save(OUT / "icon-192.png")
    draw(512, 0.60, True).save(OUT / "icon-512.png")
    draw(512, 0.46, False).save(OUT / "maskable-512.png")   # content inside the 80% safe zone
    draw(180, 0.58, False).convert("RGB").save(OUT / "apple-touch-icon.png")


if __name__ == "__main__":
    main()

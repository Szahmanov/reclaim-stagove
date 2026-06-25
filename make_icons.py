"""Generate Reclaim app icons (no external assets).
Mark: deep-teal rounded square + brass 'recover' arc-arrow around a coin.
Renders at 1024 then downscales for crispness."""
import math
from PIL import Image, ImageDraw

TEAL = (21, 86, 75)      # #15564B
TEAL_DK = (14, 61, 53)   # subtle depth
BRASS = (200, 135, 46)   # #C8872E
PAPER = (244, 243, 239)  # #F4F3EF

def rounded(size, radius_ratio=0.225, full_bleed=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    if full_bleed:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=TEAL)
    else:
        m = int(size * 0.0)  # background fills (we draw glyph inside safe zone)
        d.rounded_rectangle([m, m, size - 1 - m, size - 1 - m], radius=r, fill=TEAL)
    return img, d

def draw_glyph(img, d, size, safe=1.0):
    cx = cy = size / 2
    R = size * 0.30 * safe          # arc radius
    w = max(2, int(size * 0.078))   # stroke width
    box = [cx - R, cy - R, cx + R, cy + R]
    # Open circular arc with a gap at the top -> "return / recover the money"
    # PIL angles: 0deg = 3 o'clock, increasing clockwise (y down). Top = 270deg.
    start = 290
    sweep = 320                      # 40deg gap centred at the top
    end_deg = start + sweep
    d.arc(box, start=start, end=end_deg, fill=BRASS, width=w)
    # Arrowhead at the leading (clockwise) end of the arc
    ang = math.radians(end_deg % 360)
    ex = cx + R * math.cos(ang)
    ey = cy + R * math.sin(ang)
    tdir = ang + math.radians(90)    # clockwise tangent = direction of travel
    perp = tdir + math.radians(90)
    L = size * 0.115                 # arrowhead length
    Wd = size * 0.075                # arrowhead half-width
    tip = (ex + L * math.cos(tdir), ey + L * math.sin(tdir))
    b1 = (ex + Wd * math.cos(perp), ey + Wd * math.sin(perp))
    b2 = (ex - Wd * math.cos(perp), ey - Wd * math.sin(perp))
    d.polygon([tip, b1, b2], fill=BRASS)
    # Coin in the middle (ring)
    cr = size * 0.11
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=BRASS)
    d.ellipse([cx - cr*0.5, cy - cr*0.5, cx + cr*0.5, cy + cr*0.5], fill=TEAL)

def build(size, maskable=False):
    big = 1024
    img, d = rounded(big, full_bleed=True)
    draw_glyph(img, d, big, safe=0.82 if maskable else 1.0)
    return img.resize((size, size), Image.LANCZOS)

for s in (192, 512):
    build(s).save(f"icon-{s}.png")
build(512, maskable=True).save("icon-512-maskable.png")
# Apple touch icon: opaque, no transparency padding
build(180).convert("RGB").save("apple-touch-icon.png")

# Favicon (multi-size ICO)
fav = build(64)
fav.save("favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("icons written")

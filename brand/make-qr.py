"""Generate the Aeras waitlist QR code in the formats we actually share.

    python3 -m venv .venv && .venv/bin/pip install segno Pillow
    .venv/bin/python brand/make-qr.py

Outputs, all pointing at the same URL:
  waitlist-qr.svg          vector, no mark. Give this to a printer.
  waitlist-qr.png          raster, no mark. 1320px.
  waitlist-qr-mark.png     raster with the Aeras mark centred.
  waitlist-qr-card.png     1080px square card. Slides, or a printed 4x4.
  waitlist-qr-story.png    1179x2556, iPhone screen ratio. Stories, Reels.
  waitlist-qr-story-9x16.png  1080x1920, the 9:16 story standard.

The two story sizes carry the dark gradient from the landing page's metrics
section: #15181a under two blue radial glows, ported from `.metrics::before` in
app/landing.css. The code itself always sits on a white plate. Inverted codes
(light modules on dark) are legal but a good share of scanners refuse them, so
the plate is not a style choice.

The URL carries `?waitlist=1`, which the landing page reads to open the
request-access dialog on load (app/page.tsx). Append `&ref=CODE` to attribute
signups to a referral code; WaitlistDialog reads `ref` off the query string and
posts it to /api/waitlist. Every code is ECC H, so the centre mark stays within
the error budget. `pip install zxing-cpp` and the script decodes each output at
full size and downscaled to 300px before it exits, which is the check that
matters if you ever grow the mark.
"""

import io
import os
import numpy as np
import segno
from PIL import Image, ImageDraw, ImageFilter, ImageFont

URL = "https://aeras.finance/?waitlist=1"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "brand")
os.makedirs(OUT, exist_ok=True)

INK = "#15181a"       # --aeras-900
BLUE = "#2973ff"      # --blue
BLUE_MED = "#5792ff"  # --blue-medium
WASH = "#eaf0ff"      # --blue-wash

qr = segno.make(URL, error="h")
print("version", qr.version, "ecc", qr.error, "modules", qr.symbol_size(scale=1, border=0)[0])

# 1. Plain vector. The file to hand a printer.
qr.save(os.path.join(OUT, "waitlist-qr.svg"), scale=10, border=4, dark=INK, light="#ffffff")

# 2. Plain raster at print resolution.
qr.save(os.path.join(OUT, "waitlist-qr.png"), scale=40, border=4, dark=INK, light="#ffffff")


def qr_image(scale, border, dark, light):
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=scale, border=border, dark=dark, light=light)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def with_mark(img, frac=0.20):
    """Knock the Aeras mark into the centre. ECC H tolerates ~30% loss."""
    mark = Image.open(os.path.join(REPO, "app/icon.png")).convert("RGBA")
    # icon.png is the mark on white; drop the white so it sits on our own pad
    flat = Image.new("RGBA", mark.size, (255, 255, 255, 255))
    flat.alpha_composite(mark)
    size = int(img.width * frac)
    flat = flat.resize((size, size), Image.LANCZOS)

    pad = int(size * 1.22)
    plate = Image.new("RGBA", (pad, pad), (0, 0, 0, 0))
    d = ImageDraw.Draw(plate)
    d.rounded_rectangle([0, 0, pad - 1, pad - 1], radius=int(pad * 0.22), fill="#ffffff")
    plate.alpha_composite(flat, ((pad - size) // 2, (pad - size) // 2))

    out = img.copy()
    out.alpha_composite(plate, ((out.width - pad) // 2, (out.height - pad) // 2))
    return out


# 3. Raster with the mark in the middle.
with_mark(qr_image(40, 4, INK, "#ffffff")).save(
    os.path.join(OUT, "waitlist-qr-mark.png")
)


# 4. Square share card: slide, story, or a printed 4x4.
FACES = {"regular": 0, "bold": 1, "medium": 10}


def font(size, weight="regular"):
    path = "/System/Library/Fonts/HelveticaNeue.ttc"
    return ImageFont.truetype(path, size, index=FACES[weight])


def tracked(draw, xy, text, fnt, fill, track):
    """Centre `text` on xy with extra letter-spacing. The landing page eyebrow."""
    widths = [draw.textlength(c, font=fnt) for c in text]
    total = sum(widths) + track * (len(text) - 1)
    x = xy[0] - total / 2
    for c, w in zip(text, widths):
        draw.text((x, xy[1]), c, font=fnt, fill=fill, anchor="lm")
        x += w + track


W = 1080
card = Image.new("RGBA", (W, W), "#ffffff")
d = ImageDraw.Draw(card)

# soft brand band behind the top third
d.rectangle([0, 0, W, 300], fill=WASH)

# wordmark
logo = Image.open(os.path.join(REPO, "public/aeras-logo-black.png")).convert("RGBA")
lw = 250
logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
card.alpha_composite(logo, ((W - lw) // 2, 78))

tracked(d, (W / 2, 200), "REQUEST EARLY ACCESS", font(24, "medium"), BLUE, 5)
d.text((W / 2, 252), "Scan to join the waitlist", font=font(42, "bold"), fill=INK, anchor="mm")

# the code itself
code = with_mark(qr_image(20, 2, INK, "#ffffff"), frac=0.19)
cs = 600
code = code.resize((cs, cs), Image.LANCZOS)
card.alpha_composite(code, ((W - cs) // 2, 350))

d.text((W / 2, 990), "aeras.finance", font=font(36, "medium"), fill=INK, anchor="mm")

card.convert("RGB").save(os.path.join(OUT, "waitlist-qr-card.png"), quality=95)


# 5. Portrait story card on the dark gradient, at phone-screen proportions.
def aurora(w, h):
    """`.metrics::before` from app/landing.css, rendered at poster scale.

    CSS `circle at X% Y%` with no size keyword means farthest-corner, so the
    radius is the distance from the centre to whichever corner is furthest.
    Fading to `transparent` is done on alpha alone, which is how browsers
    interpolate premultiplied colour; fading the RGB too would grey the edge.
    """
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    out = np.zeros((h, w, 3)) + np.array([21, 24, 26])  # --aeras-900

    def glow(cxf, cyf, rgb, stop, alpha):
        cx, cy = cxf * w, cyf * h
        r = max(
            np.hypot(cx - x, cy - y)
            for x, y in ((0, 0), (w, 0), (0, h), (w, h))
        )
        t = np.clip(np.hypot(xx - cx, yy - cy) / (r * stop), 0, 1)
        a = ((1 - t) * alpha)[..., None]
        return out * (1 - a) + np.array(rgb) * a

    out = glow(0.15, 0.20, (41, 115, 255), 0.45, 0.22)   # --blue
    out = glow(0.85, 0.90, (87, 146, 255), 0.50, 0.16)   # --blue-medium
    # A third glow the CSS does not have. The web section is only ~1000px tall;
    # over 2556px the middle reads as flat ink without it.
    out = glow(0.50, 0.52, (41, 115, 255), 0.42, 0.10)
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGB").convert("RGBA")


def grid(w, h, step, alpha=14):
    """`.hero-grid`, inverted for dark and faded out at the edges."""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 255, 255, alpha))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(255, 255, 255, alpha))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    t = np.clip(np.hypot((xx - w / 2) / (w * 0.62), (yy - h * 0.42) / (h * 0.55)), 0, 1)
    a = np.asarray(layer)[..., 3] * (1 - t)
    arr = np.asarray(layer).copy()
    arr[..., 3] = a.astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


def story(w, h, path):
    img = aurora(w, h)
    img.alpha_composite(grid(w, h, int(w / 14)))
    d = ImageDraw.Draw(img)
    s = w / 1179.0  # every measurement below is tuned at 1179 wide

    # wordmark
    logo = Image.open(os.path.join(REPO, "public/aeras-logo-white.png")).convert("RGBA")
    lw = int(330 * s)
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    img.alpha_composite(logo, ((w - lw) // 2, int(h * 0.072)))

    tracked(d, (w / 2, h * 0.150), "REQUEST EARLY ACCESS",
            font(int(30 * s), "medium"), BLUE_MED, 7 * s)

    # The hero h1, set as three lines, one per sentence. `Earn yield.` is the
    # <em>, which the landing page paints --blue; on ink that goes muddy, so it
    # takes --blue-medium, the same substitution `.metrics .eyebrow` makes.
    # Negative tracking approximates the h1's -0.035em.
    lines = [
        ("Hold the assets you love.", "#ffffff"),
        ("Earn yield.", BLUE_MED),
        ("Borrow against them.", "#ffffff"),
    ]
    hf = font(int(78 * s), "bold")
    y = h * 0.202
    for text, fill in lines:
        tracked(d, (w / 2, y), text, hf, fill, -2.5 * s)
        y += 100 * s
    head_end = y - 50 * s

    # The plate and its captions float in whatever room is left between the
    # headline and the URL, so both aspect ratios stay balanced from one set of
    # numbers. Hard-coding a top edge collides with the captions at 9:16.
    url_y = h - 165 * s
    free_top, free_bot = head_end + 70 * s, url_y - 90 * s
    caption_h = 110 * s + 78 * s + 53 * s
    plate = int(min(880 * s, (free_bot - free_top) - caption_h))
    py = int(free_top + ((free_bot - free_top) - (plate + caption_h)) / 2)
    px = (w - plate) // 2

    # White plate: the code stays dark-on-light whatever sits behind it.
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [px, py + int(18 * s), px + plate, py + plate + int(18 * s)],
        radius=int(56 * s), fill=(0, 0, 0, 90),
    )
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(int(30 * s))))
    ImageDraw.Draw(img).rounded_rectangle(
        [px, py, px + plate, py + plate], radius=int(56 * s), fill="#ffffff"
    )

    cs = int(plate - 96 * s)
    code = with_mark(qr_image(20, 0, INK, "#ffffff"), frac=0.19).resize((cs, cs), Image.LANCZOS)
    img.alpha_composite(code, (px + (plate - cs) // 2, py + (plate - cs) // 2))

    d = ImageDraw.Draw(img)
    d.text((w / 2, py + plate + 110 * s), "Scan to join the waitlist",
           font=font(int(52 * s), "bold"), fill="#ffffff", anchor="mm")
    d.text((w / 2, py + plate + 188 * s),
           "Tokenized stocks, treasuries and funds as collateral.",
           font=font(int(33 * s), "regular"), fill="#9c9d9f", anchor="mm")

    tracked(d, (w / 2, url_y), "AERAS.FINANCE", font(int(36 * s), "medium"), "#ffffff", 6 * s)
    img.convert("RGB").save(path, quality=95)


story(1179, 2556, os.path.join(OUT, "waitlist-qr-story.png"))       # iPhone screen
story(1080, 1920, os.path.join(OUT, "waitlist-qr-story-9x16.png"))  # story standard

for f in sorted(os.listdir(OUT)):
    if f.endswith((".png", ".svg")):
        print(f, os.path.getsize(os.path.join(OUT, f)), "bytes")

# Decode every raster we just wrote, full size and at 300px. A code that only
# reads at 2000px is not a code you can put on a slide.
try:
    import zxingcpp
except ImportError:
    print("\nzxing-cpp not installed, skipping decode check")
else:
    print()
    for f in sorted(x for x in os.listdir(OUT) if x.endswith(".png")):
        img = Image.open(os.path.join(OUT, f)).convert("RGB")
        small = img.resize((300, int(img.height * 300 / img.width)), Image.LANCZOS)
        for label, im in (("full", img), ("300px", small)):
            got = [r.text for r in zxingcpp.read_barcodes(im)]
            ok = got == [URL]
            print(f"{'ok ' if ok else 'FAIL'} {f} @{label}: {got or 'no read'}")

"""Tiny pixel-art helpers shared by the draft and placeholder scripts."""
from PIL import Image

from palette import C

FONT = {  # 3x5 bitmap font for placeholder labels
    "A": "010101111101101", "B": "110101110101110", "C": "011100100100011", "D": "110101101101110",
    "E": "111100110100111", "F": "111100110100100", "G": "011100101101011", "H": "101101111101101",
    "I": "111010010010111", "J": "001001001101010", "K": "101101110101101", "L": "100100100100111",
    "M": "101111111101101", "N": "110101101101101", "O": "010101101101010", "P": "110101110100100",
    "Q": "010101101110011", "R": "110101110101101", "S": "011100010001110", "T": "111010010010010",
    "U": "101101101101111", "V": "101101101101010", "W": "101101111111101", "X": "101101010101101",
    "Y": "101101010010010", "Z": "111001010100111", "0": "111101101101111", "1": "010110010010111",
    "2": "110001010100111", "3": "110001010001110", "4": "101101111001001", "5": "111100110001110",
    "6": "011100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001110",
    "-": "000000111000000", ".": "000000000000010", " ": "000000000000000",
}


def rgba(key_or_rgb, a=255):
    rgb = C[key_or_rgb] if isinstance(key_or_rgb, str) else key_or_rgb
    return (*rgb, a)


def mix(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def ramp(base):
    """Light, base, dark. Dark shifts toward navy, per art-direction 2.3."""
    return mix(base, C["highlight"], 0.35), base, mix(base, C["ink-navy"], 0.28)


def canvas(w, h):
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def put(img, x, y, color):
    if 0 <= x < img.width and 0 <= y < img.height:
        img.putpixel((x, y), color)


def rect(img, x0, y0, x1, y1, color):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(img, x, y, color)


def text(img, x, y, s, color):
    for ch in s.upper():
        bits = FONT.get(ch, FONT[" "])
        for i, b in enumerate(bits):
            if b == "1":
                put(img, x + i % 3, y + i // 3, color)
        x += 4


def text_width(s):
    return len(s) * 4 - 1


def ascii_art(img, x, y, rows, colors):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch in colors:
                put(img, x + i, y + j, colors[ch])


def outline(img, color, diagonal=False):
    """Add a 1px outline around opaque pixels, outside the shape."""
    src = img.copy()
    px = src.load()
    w, h = src.size
    offs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if diagonal:
        offs += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    for y in range(h):
        for x in range(w):
            if px[x, y][3] == 0:
                for dx, dy in offs:
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] > 0:
                        img.putpixel((x, y), color)
                        break
    return img


def scale(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def strip(frames):
    w = sum(f.width for f in frames)
    h = max(f.height for f in frames)
    out = canvas(w, h)
    x = 0
    for f in frames:
        out.alpha_composite(f, (x, 0))
        x += f.width
    return out


def grid(tiles, cols, tw, th):
    rows = (len(tiles) + cols - 1) // cols
    out = canvas(cols * tw, rows * th)
    for i, t in enumerate(tiles):
        if t is not None:
            out.alpha_composite(t, ((i % cols) * tw, (i // cols) * th))
    return out

"""Generate a sample 16x16 pixel-art tileset for The Dark Seam."""
import random
from PIL import Image, ImageDraw

T = 16
rng = random.Random(7)

# Palette
ROCK = [(58, 50, 44), (70, 61, 53), (84, 73, 63), (46, 40, 35)]
DIRT = [(92, 78, 62), (100, 85, 68), (86, 72, 57), (108, 92, 74)]
METAL = [(96, 100, 104), (108, 112, 116), (84, 88, 92)]
RESIN = [(62, 44, 84), (76, 54, 102), (52, 36, 70), (96, 70, 128)]
ORE = [(212, 170, 72), (238, 200, 96)]
BLACK = (20, 18, 16)


def noise(img, colors, weights=None):
    px = img.load()
    for y in range(T):
        for x in range(T):
            px[x, y] = rng.choices(colors, weights=weights)[0]


def new():
    return Image.new("RGBA", (T, T), (0, 0, 0, 0))


def rock_wall():
    im = new(); noise(im, ROCK, [3, 3, 2, 2])
    d = ImageDraw.Draw(im)
    for _ in range(3):  # cracks
        x, y = rng.randrange(T), rng.randrange(T)
        d.line([(x, y), (x + rng.randint(-3, 3), y + rng.randint(2, 4))], fill=BLACK)
    d.line([(0, 0), (15, 0)], fill=(104, 92, 80))  # top highlight
    return im


def ore_vein():
    im = rock_wall(); px = im.load()
    for _ in range(9):
        x, y = rng.randrange(2, 14), rng.randrange(2, 14)
        px[x, y] = ORE[0]; px[x + 1, y] = ORE[1]
    return im


def mine_floor():
    im = new(); noise(im, DIRT, [5, 3, 3, 1])
    px = im.load()
    for _ in range(4):
        px[rng.randrange(T), rng.randrange(T)] = (70, 60, 50)
    return im


def colony_floor():
    im = new(); noise(im, METAL[:2], [4, 1])
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 15, 15], outline=METAL[2])
    for p in [(2, 2), (13, 2), (2, 13), (13, 13)]:
        d.point(p, fill=(140, 144, 148))
    return im


def colony_wall():
    im = new(); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 15, 15], fill=(60, 66, 74))
    d.rectangle([0, 0, 15, 3], fill=(86, 94, 104))
    for x in range(0, 16, 4):
        d.line([(x, 4), (x, 15)], fill=(50, 55, 62))
    return im


def door(welded=False):
    im = colony_floor(); d = ImageDraw.Draw(im)
    d.rectangle([1, 6, 14, 9], fill=(150, 120, 60))
    d.line([(7, 6), (7, 9)], fill=(90, 70, 30))
    if welded:
        for x in range(2, 14, 2):
            d.point((x, 7 + (x // 2) % 2), fill=(255, 140, 50))
            d.point((x + 1, 8), fill=(200, 80, 30))
    return im


def resin_floor():
    im = new(); noise(im, RESIN, [4, 3, 2, 1])
    d = ImageDraw.Draw(im)
    for _ in range(3):  # glossy veins
        x, y = rng.randrange(T), rng.randrange(T)
        d.line([(x, y), (x + rng.randint(2, 5), y + rng.randint(-2, 2))], fill=(128, 96, 160))
    return im


def vent():
    im = colony_floor(); d = ImageDraw.Draw(im)
    d.rectangle([3, 3, 12, 12], fill=(40, 42, 46), outline=(130, 134, 138))
    for y in range(5, 12, 2):
        d.line([(4, y), (11, y)], fill=(90, 94, 98))
    return im


def ladder():
    im = new(); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 15, 15], fill=BLACK)
    d.line([(4, 0), (4, 15)], fill=(150, 110, 60)); d.line([(11, 0), (11, 15)], fill=(150, 110, 60))
    for y in range(2, 16, 4):
        d.line([(4, y), (11, y)], fill=(180, 140, 80))
    return im


def elevator():
    im = new(); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 15, 15], fill=(40, 40, 44), outline=(200, 170, 40))
    d.line([(1, 1), (14, 14)], fill=(200, 170, 40)); d.line([(14, 1), (1, 14)], fill=(200, 170, 40))
    return im


def chute():
    im = mine_floor(); d = ImageDraw.Draw(im)
    d.ellipse([2, 2, 13, 13], fill=BLACK, outline=(120, 100, 80))
    d.arc([4, 4, 11, 11], 200, 340, fill=(60, 52, 44))
    return im


def generator():
    im = colony_floor(); d = ImageDraw.Draw(im)
    d.rectangle([2, 3, 13, 13], fill=(70, 90, 70), outline=(40, 50, 40))
    d.polygon([(8, 4), (5, 9), (8, 9), (7, 12), (11, 7), (8, 7)], fill=(250, 220, 60))
    return im


def crate():
    im = colony_floor(); d = ImageDraw.Draw(im)
    d.rectangle([3, 4, 12, 12], fill=(70, 90, 50), outline=(40, 52, 28))
    d.line([(3, 8), (12, 8)], fill=(40, 52, 28)); d.rectangle([6, 6, 9, 7], fill=(220, 200, 80))
    return im


def turret():
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([3, 4, 12, 13], fill=(90, 96, 104), outline=(40, 44, 48))
    d.rectangle([7, 0, 8, 7], fill=(40, 44, 48)); d.point((7, 9), fill=(255, 60, 60))
    return im


def barricade():
    im = new(); d = ImageDraw.Draw(im)
    for i, y in enumerate([3, 7, 11]):
        d.rectangle([1, y, 14, y + 2], fill=(130, 96, 56) if i % 2 else (112, 82, 46), outline=(70, 50, 28))
    d.line([(2, 2), (13, 14)], fill=(150, 150, 156)); d.line([(13, 2), (2, 14)], fill=(150, 150, 156))
    return im


# --- Units (drawn on transparent tiles) ---
def human(shirt, helmet=None, cross=False, weapon=False):
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([3, 12, 12, 15], fill=(0, 0, 0, 90))  # shadow
    d.rectangle([5, 7, 10, 12], fill=shirt, outline=BLACK)  # body
    d.rectangle([6, 2, 9, 6], fill=(222, 182, 142), outline=BLACK)  # head
    if helmet:
        d.rectangle([5, 1, 10, 3], fill=helmet)
    if cross:
        d.line([(7, 8), (7, 11)], fill=(220, 40, 40)); d.line([(6, 9), (8, 9)], fill=(220, 40, 40))
    if weapon:
        d.line([(11, 6), (11, 12)], fill=(40, 40, 40)); d.point((11, 5), fill=(60, 60, 60))
    return im


def taker():
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([2, 12, 13, 15], fill=(0, 0, 0, 90))
    for y in (6, 9, 12):  # legs
        d.line([(2, y - 1), (13, y + 1)], fill=(30, 22, 26))
    d.ellipse([4, 4, 11, 13], fill=(150, 66, 44), outline=(60, 24, 16))  # abdomen
    d.ellipse([5, 1, 10, 6], fill=(170, 80, 54), outline=(60, 24, 16))  # head
    d.point((6, 3), fill=(255, 220, 120)); d.point((9, 3), fill=(255, 220, 120))
    d.line([(6, 0), (5, -1)], fill=(60, 24, 16))
    return im


def spineback():
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([1, 12, 14, 15], fill=(0, 0, 0, 90))
    for y in (5, 9, 13):
        d.line([(0, y - 1), (15, y + 1)], fill=(30, 18, 18))
    d.ellipse([3, 3, 12, 14], fill=(160, 36, 36), outline=(60, 10, 10))
    for x in range(5, 11, 2):  # spines
        d.line([(x, 5), (x, 2)], fill=(230, 210, 190))
    d.point((6, 6), fill=(255, 230, 120)); d.point((9, 6), fill=(255, 230, 120))
    return im


def broodling():
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([4, 11, 11, 14], fill=(0, 0, 0, 90))
    d.ellipse([4, 6, 11, 12], fill=(220, 200, 170), outline=(120, 90, 70))
    for x in (6, 8, 10):
        d.line([(x, 7), (x, 11)], fill=(190, 160, 130))
    return im


def cocoon():
    im = new(); d = ImageDraw.Draw(im)
    d.ellipse([3, 1, 12, 15], fill=(120, 90, 150), outline=(50, 34, 66))
    for y in range(3, 14, 3):
        d.line([(4, y), (11, y + 1)], fill=(80, 56, 104))
    d.rectangle([6, 3, 9, 5], fill=(222, 182, 142))  # trapped face
    return im


def brood_mother():
    """32x32 (2x2 tiles)."""
    im = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([3, 24, 29, 31], fill=(0, 0, 0, 100))
    for y in (10, 15, 20):
        d.line([(0, y - 2), (31, y + 2)], fill=(30, 16, 30), width=2)
    d.ellipse([6, 12, 26, 30], fill=(110, 50, 120), outline=(44, 16, 50))  # egg sac
    for y in range(15, 29, 3):
        d.line([(9, y), (23, y)], fill=(140, 76, 150))
    d.ellipse([9, 3, 23, 15], fill=(150, 46, 46), outline=(60, 12, 12))  # thorax
    d.ellipse([12, 0, 20, 7], fill=(170, 60, 50), outline=(60, 12, 12))  # head
    d.point((14, 3), fill=(255, 230, 120)); d.point((18, 3), fill=(255, 230, 120))
    return im


tiles = [
    ("Rock wall", rock_wall()), ("Ore vein", ore_vein()), ("Mine floor", mine_floor()),
    ("Colony floor", colony_floor()), ("Colony wall", colony_wall()), ("Door", door()),
    ("Welded door", door(True)), ("Resin", resin_floor()), ("Vent", vent()),
    ("Ladder", ladder()), ("Elevator", elevator()), ("Ore chute", chute()),
    ("Generator", generator()), ("Supply crate", crate()), ("Turret", turret()),
    ("Barricade", barricade()),
    ("Civilian", human((70, 110, 170))), ("Armed civ", human((70, 110, 170), weapon=True)),
    ("Soldier", human((70, 96, 50), helmet=(50, 66, 36), weapon=True)),
    ("Medic", human((220, 220, 214), helmet=(50, 66, 36), cross=True)),
    ("Taker", taker()), ("Spineback", spineback()), ("Broodling", broodling()), ("Cocoon", cocoon()),
]

# 1) Real sprite sheet (8 per row, 16x16) + queen sheet
cols = 8
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGBA", (cols * T, rows * T), (0, 0, 0, 0))
for i, (_, im) in enumerate(tiles):
    sheet.paste(im, ((i % cols) * T, (i // cols) * T), im)
sheet.save("tileset.png")
brood_mother().save("brood_mother.png")

# 2) Labeled preview, scaled 4x
S = 4
cell_w, cell_h = T * S + 40, T * S + 26
prev = Image.new("RGB", (cols * cell_w + 20, (rows + 1) * cell_h + 40), (24, 22, 20))
d = ImageDraw.Draw(prev)
for i, (name, im) in enumerate(tiles):
    x = 20 + (i % cols) * cell_w; y = 20 + (i // cols) * cell_h
    bg = Image.new("RGBA", (T, T), (24, 22, 20, 255)); bg.alpha_composite(im)
    prev.paste(bg.resize((T * S, T * S), Image.NEAREST), (x, y))
    d.text((x, y + T * S + 4), name, fill=(220, 210, 190))
bm = Image.new("RGBA", (32, 32), (24, 22, 20, 255)); bm.alpha_composite(brood_mother())
y = 20 + rows * cell_h
prev.paste(bm.resize((32 * 3, 32 * 3), Image.NEAREST), (20, y - 10))
d.text((130, y + 30), "Brood Mother (32x32)", fill=(220, 210, 190))
prev.save("tileset_preview.png")

# 3) Small scene using the tiles
W, H = 24, 14
scene = Image.new("RGBA", (W * T, H * T))
layout = [
    "########################",
    "#####......#############",
    "####........###...######",
    "###...$.......d....RRRR#",
    "###.....##........RRRRR#",
    "####...####....#..RRRRR#",
    "#####.#####..###..RRRRR#",
    "#####....W....##..RRRR##",
    "######.........#...RR###",
    "####.....###...##.RR####",
    "###...C..####......#####",
    "####....######..########",
    "#####..##########.######",
    "########################",
]
cache = {}
def tile(key, fn):
    if key not in cache: cache[key] = [fn() for _ in range(4)]
    return rng.choice(cache[key])
for y, row in enumerate(layout):
    for x, ch in enumerate(row):
        if ch == "#":
            im = tile("rock", ore_vein if rng.random() < 0.07 else rock_wall)
        elif ch == "R":
            im = tile("resin", resin_floor)
        else:
            im = tile("floor", mine_floor)
        scene.paste(im, (x * T, y * T))
        if ch == "$": scene.alpha_composite(crate().crop((0,0,16,16)), (x * T, y * T))
        if ch == "W": scene.alpha_composite(barricade(), (x * T, y * T))
        if ch == "C": scene.alpha_composite(chute(), (x * T, y * T))
        if ch == "d": scene.alpha_composite(turret(), (x * T, y * T))
units = [
    (human((70, 96, 50), helmet=(50, 66, 36), weapon=True), 9, 4),
    (human((70, 96, 50), helmet=(50, 66, 36), weapon=True), 10, 5),
    (human((220, 220, 214), helmet=(50, 66, 36), cross=True), 9, 6),
    (human((70, 110, 170)), 5, 2), (human((70, 110, 170)), 6, 9),
    (taker(), 17, 4), (taker(), 16, 8), (spineback(), 20, 6),
    (cocoon(), 21, 4), (cocoon(), 22, 5), (broodling(), 19, 8),
]
for im, x, y in units:
    scene.alpha_composite(im, (x * T, y * T))
scene.alpha_composite(brood_mother(), (20 * T, 3 * T + 8))
scene.resize((W * T * 3, H * T * 3), Image.NEAREST).save("scene_preview.png")
print("done")

"""ASCII Christmas Tree — 글자로 그린 3D 회전 크리스마스 트리.

실행:  pip install pygame numpy
       python christmas_tree.py

조작:  Space 일시정지 · R 다시 시작 · S 스크린샷 · Esc 종료
"""
import math
import random
import time

import numpy as np
import pygame

# ── window ──────────────────────────────────────────────
TITLE = "ASCII Christmas Tree"
CW, CH, FONT_PX = 9, 14, 15
COLS, ROWS = 88, 74
W, H = COLS * CW, ROWS * CH
MONO = "consolas,menlo,dejavusansmono,couriernew,monospace"
FPS = 30

BG = (8, 10, 18)
DIM = (96, 104, 122)
ACCENT = (255, 196, 90)
GREEN_DARK = (28, 105, 48)
GREEN_LIGHT = (120, 235, 120)
TRUNK = (120, 72, 36)
RED, GOLD, BLUE, WHITE = (235, 60, 60), (255, 200, 60), (80, 150, 255), (240, 240, 255)
LIGHT_COLORS = [RED, GOLD, BLUE, (255, 120, 200), (120, 255, 200)]
RIBBON_RED = ((150, 15, 35), (255, 110, 130))
RIBBON_GOLD = ((150, 105, 20), (255, 235, 140))

# 스프라이트 색 코드
PALETTE = {
    "r": RED, "w": WHITE, "s": (250, 200, 170), "g": GOLD, "b": (150, 95, 50),
    "k": (60, 60, 75), "n": (255, 40, 40), "o": (255, 140, 40), "p": (170, 80, 220),
    "y": (255, 245, 190),
}

MESSAGE = "MERRY CHRISTMAS"
NEEDLES = "*^/\\vYA"
SHADE = "-=+:"

# 트리 화면 배치
CX = COLS // 2
TOP_Y = 14
BASE_Y = 55
TREE_H = BASE_Y - TOP_Y
RADIUS_COLS = 29  # 바닥 반지름 (칸)
TIERS = 6         # 가지 층 수

# ── sprites: (글자, 색 코드) 줄 목록. 공백 = 투명 ──────────
SLEIGH = [
    ("     /^\\o   ", "     rrrw   "),
    ("    (o.o)   ", "    sssss   "),
    (" \\==(WWW)==/", " ggggwwwwggg"),
    ("  \\=======/ ", "  ggrrrrrgg "),
    ("   `-----'  ", "   kkkkkkk  "),
]
REINDEER = [  # 두 프레임 (다리)
    [
        ("    \\/  ", "    bb  "),
        (" ___/o@ ", " bbbbbn "),
        ("(____)  ", "bbbbbb  "),
        (" /\\ /\\ ", " bb bb  "),
    ],
    [
        ("    \\/  ", "    bb  "),
        (" ___/o@ ", " bbbbbn "),
        ("(____)  ", "bbbbbb  "),
        (" |\\ |\\ ", " bb bb  "),
    ],
]
SNOWMAN = [  # 두 프레임 (손 흔들기)
    [
        ("   ___    ", "   kkk    "),
        ("  _|_|_   ", "  kkkkk   "),
        ("  (o>o)  /", "  wwoww  b"),
        (" \\( : )_/ ", " bwwkwwbb "),
        ("  (  :  ) ", "  wwwkwww "),
        (" (   :   )", " wwwwkwwww"),
    ],
    [
        ("   ___    ", "   kkk    "),
        ("  _|_|_   ", "  kkkkk   "),
        ("  (o>o)   ", "  wwoww   "),
        (" \\( : )__ ", " bwwkwwbb "),
        ("  (  :  ) ", "  wwwkwww "),
        (" (   :   )", " wwwwkwwww"),
    ],
]
MOON = [
    ("  _..._ ", "  yyyyy "),
    (".'  .-'`", "yyyyyyyy"),
    ("|  /    ", "yyy     "),
    ("|  |    ", "yyy     "),
    ("'  \\    ", "yyy     "),
    (" '._'-._", " yyyyyyy"),
    ("     ``` ", "     yyy "),
]


def tier_radius(y):
    """높이 y(0=꼭대기, 1=바닥)에서의 원뿔 반지름 (0~1). 층마다 다시 넓어짐."""
    return y * (0.55 + 0.45 * ((y * TIERS) % 1.0))


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def scale(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


class Tree:
    """장식 공·전구·리본의 원뿔 위 위치 (y: 0=꼭대기 … 1=바닥, theta: 각도)."""

    def __init__(self):
        rng = np.random.default_rng()
        m = 40
        self.orn_y = 0.12 + 0.85 * rng.random(m)
        self.orn_r = tier_radius(self.orn_y) * 1.02
        self.orn_t = rng.random(m) * 2 * math.pi
        self.orn_c = [[RED, GOLD, BLUE][i % 3] for i in range(m)]

        k = 150  # 나선형 전구 줄
        self.light_y = np.linspace(0.04, 0.98, k)
        self.light_r = tier_radius(self.light_y) * 1.04
        self.light_t = -self.light_y * 2 * math.pi * 5.5
        self.light_phase = rng.random(k) * 6.28
        self.light_c = [LIGHT_COLORS[i % len(LIGHT_COLORS)] for i in range(k)]

        # 리본 두 줄 (서로 반대편에서 시작)
        self.rib_s = np.linspace(0.08, 0.97, 700)


class Scene:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tree = Tree()
        self.t = 0.0
        self.snow = [[random.uniform(0, COLS), random.uniform(0, ROWS), random.uniform(3, 9),
                      random.choice("*.+")] for _ in range(130)]
        self.stars = [(random.randrange(COLS), random.randrange(0, 22), random.uniform(0, 6.28),
                       random.choice(".+*'")) for _ in range(45)]
        self.sparkles = []   # 산타 반짝이 꼬리 [x, y, 남은 시간, 글자]
        self.shooting = None  # 별똥별 [x, y, 경과]
        self.next_shoot = 4.0
        self.info = {"rotation": 0.0, "lights": 0, "letters": 0, "santa": False}

    # ── 그리기 도구 ─────────────────────────────────
    def put(self, ch, col, row, color, z):
        """화면 버퍼에 글자 찍기 (z가 클수록 앞)."""
        col, row = int(round(col)), int(round(row))
        if 0 <= col < COLS and 0 <= row < ROWS and z >= self.zbuf[row, col]:
            self.zbuf[row, col] = z
            self.chars[row][col] = ch
            self.colors[row][col] = color

    def sprite(self, art, x, y, z, bright=1.0):
        for dy, (chars, codes) in enumerate(art):
            for dx, ch in enumerate(chars):
                if ch != " ":
                    code = codes[dx] if dx < len(codes) else "w"
                    self.put(ch, x + dx, y + dy, scale(PALETTE.get(code, WHITE), bright), z)

    def text(self, s, x, y, color, z):
        for i, ch in enumerate(s):
            if ch != " ":
                self.put(ch, x + i, y, color, z)

    @staticmethod
    def project(y, r, theta, rot):
        a = theta + rot
        col = np.round(CX + r * np.cos(a) * RADIUS_COLS).astype(int)
        row = np.round(TOP_Y + y * TREE_H).astype(int)
        return col, row, r * np.sin(a)  # z>0 = 앞쪽

    # ── 상태 갱신 ───────────────────────────────────
    def update(self, dt):
        self.t += dt
        for f in self.snow:
            f[1] += f[2] * dt
            f[0] += math.sin(self.t * 0.8 + f[2]) * dt * 1.5
            if f[1] >= ROWS - 6:
                f[0], f[1] = random.uniform(0, COLS), 0
        for p in self.sparkles:
            p[1] += dt * 3
            p[2] -= dt
        self.sparkles = [p for p in self.sparkles if p[2] > 0]
        if self.shooting:
            self.shooting[2] += dt
            if self.shooting[2] > 1.4:
                self.shooting = None
        elif self.t > self.next_shoot:
            self.shooting = [random.uniform(10, COLS - 30), random.uniform(1, 8), 0.0]
            self.next_shoot = self.t + random.uniform(5, 10)

    def santa_pos(self):
        """산타 썰매 위치 (14초 주기로 하늘을 가로지름). 화면 밖이면 None."""
        cycle, fly = 14.0, 9.0
        k = (self.t - 3.0) % cycle
        if self.t < 3.0 or k > fly:
            return None
        x = -40 + k / fly * (COLS + 45)
        y = 3 + 1.5 * math.sin(self.t * 1.6)
        return x, y

    # ── 장면 그리기 ─────────────────────────────────
    def render(self):
        t = self.t
        rot = t * 0.7
        self.chars = [[" "] * COLS for _ in range(ROWS)]
        self.colors = [[BG] * COLS for _ in range(ROWS)]
        self.zbuf = np.full((ROWS, COLS), -99.0)
        tr = self.tree

        # 하늘: 반짝이는 별, 달, 별똥별, 눈
        for x, y, ph, c in self.stars:
            b = 0.5 + 0.5 * math.sin(t * 2.2 + ph)
            if b > 0.2:
                self.put(c, x, y, scale((200, 210, 255), 0.3 + 0.6 * b), -60)
        self.sprite(MOON, 3, 1, -55)
        if self.shooting:
            sx, sy, e = self.shooting
            hx, hy = sx + e * 30, sy + e * 9
            for i, ch in enumerate("*=-~-..  "):
                fade = 1 - i / 9
                if ch != " ":
                    self.put(ch, hx - i * 2, hy - i * 0.6, scale((255, 250, 210), fade * (1.4 - e)), -52)
        for x, y, sp, c in self.snow:
            self.put(c, x, y, scale(WHITE, 0.35 + sp / 15), -50)

        # 산타 (달 앞, 별 뒤로 지나감)
        santa = self.santa_pos()
        if santa:
            sx, sy = santa
            leg = int(t * 8) % 2
            for i in range(3):  # 순록 3마리 (앞으로 갈수록 오른쪽)
                rx = sx + 15 + i * 10
                ry = sy + 0.5 * math.sin(t * 6 + i)
                self.sprite(REINDEER[(leg + i) % 2], rx, ry, -5)
            self.text("~" * 4, sx + 12, sy + 2, PALETTE["b"], -5.1)  # 고삐
            self.sprite(SLEIGH, sx, sy, -5)
            if random.random() < 0.8:
                self.sparkles.append([sx + random.uniform(-1, 2), sy + random.uniform(2, 5), 1.2,
                                      random.choice("*+.'")])
            if int(t / 2.2) % 2 == 0:
                self.text("HO HO HO!", sx + 1, sy - 2, scale(WHITE, 0.8 + 0.2 * math.sin(t * 8)), -5)
        for x, y, life, ch in self.sparkles:
            self.put(ch, x, y, scale(GOLD, life), -6)

        # 바닥 눈 언덕
        for col in range(COLS):
            h = int(1.5 + 1.2 * math.sin(col * 0.21) + 0.8 * math.sin(col * 0.07 + 1))
            for row in range(BASE_Y + 4 - h, BASE_Y + 6):
                self.put("~" if row == BASE_Y + 4 - h else ".", col, row, scale(WHITE, 0.55), -40)

        # 줄기
        for row in range(BASE_Y - 1, BASE_Y + 4):
            for dc in range(-3, 4):
                self.put("|#|"[(dc + 3) % 3], CX + dc, row, scale(TRUNK, 0.8 + 0.2 * (dc == 0)), -2)

        # 잎: 실루엣 안의 모든 칸을 원뿔 앞면으로 채움 (무늬가 회전 따라 흐름)
        for row in range(TOP_Y, BASE_Y):
            y = (row - TOP_Y) / TREE_H
            frac = (y * TIERS) % 1.0
            R = tier_radius(y) * RADIUS_COLS + 0.8 * math.sin(row * 1.7 + t * 0.5)
            if R < 0.5:
                continue
            for col in range(int(CX - R), int(CX + R) + 1):
                u = (col - CX) / R
                if abs(u) > 1:
                    continue
                zf = math.sqrt(1 - u * u)
                local = (math.atan2(zf, u) - rot) % (2 * math.pi)  # 트리 기준 각도
                h = (int(local * 9) * 73856093 ^ row * 19349663) & 0xFFFF
                lv = 0.4 + 0.6 * (0.5 + 0.5 * (zf * 0.8 - u * 0.5))  # 왼쪽 앞에서 빛
                lv *= (0.8 + 0.05 * ((h >> 4) % 5)) * (1.0 - 0.15 * frac)
                c = lerp(GREEN_DARK, GREEN_LIGHT, lv)
                if abs(u) > 0.93:
                    ch = "/" if u < 0 else "\\"
                else:
                    ch = NEEDLES[h % len(NEEDLES)] if lv > 0.45 else SHADE[h % len(SHADE)]
                self.put(ch, col, row, c, zf * R / RADIUS_COLS - 0.05)

        # 리본 두 줄: 트리를 감고 내려가며 물결무늬가 흘러감
        s = tr.rib_s
        for offset, (dark, bright) in ((0.0, RIBBON_RED), (math.pi, RIBBON_GOLD)):
            theta = s * 2 * math.pi * 2.6 + offset
            r = tier_radius(s) * 1.07 + 0.025 * np.sin(s * 35 - t * 4)
            col, row, z = self.project(s, r, theta, rot)
            flow = np.sin(s * 90 - t * 7)
            for i in range(len(s)):
                if z[i] < 0:
                    continue
                c = lerp(dark, bright, 0.35 + 0.45 * flow[i] + 0.4 * z[i])
                ch = "~" if flow[i] > 0.3 else ("=" if flow[i] > -0.4 else "-")
                self.put(ch, col[i], row[i], c, z[i] + 0.03)

        # 전구 (깜빡임)
        col, row, z = self.project(tr.light_y, tr.light_r, tr.light_t, rot)
        on = 0
        for i in range(len(tr.light_y)):
            if z[i] < 0:
                continue
            b = 0.5 + 0.5 * math.sin(t * 4 + tr.light_phase[i])
            on += b > 0.35
            self.put("o" if b > 0.6 else ".", col[i], row[i], scale(tr.light_c[i], 0.4 + 0.8 * b), z[i] + 0.05)

        # 장식 공
        col, row, z = self.project(tr.orn_y, tr.orn_r, tr.orn_t, rot)
        for i in range(len(tr.orn_y)):
            if z[i] < 0:
                continue
            shine = 0.75 + 0.35 * z[i]
            self.put("@", col[i], row[i], scale(tr.orn_c[i], shine), z[i] + 0.1)
            self.put("(", col[i] - 1, row[i], scale(tr.orn_c[i], shine * 0.7), z[i] + 0.09)
            self.put(")", col[i] + 1, row[i], scale(tr.orn_c[i], shine * 0.7), z[i] + 0.09)

        # 별 + 그 아래 리본 매듭, 바람에 날리는 꼬리
        pulse = 0.75 + 0.25 * math.sin(t * 3)
        star = ["  .  ", " \\|/ ", "--*--", " /|\\ ", "  '  "]
        for dy, line in enumerate(star):
            for dx, ch in enumerate(line):
                if ch != " ":
                    self.put(ch, CX - 2 + dx, TOP_Y - 6 + dy, scale(GOLD, pulse * (1.3 if ch == "*" else 1)), 5)
        bow_y = TOP_Y - 1
        wob = int(round(math.sin(t * 3)))
        self.text("<<(@)>>" if wob >= 0 else "<(@)>", CX - (3 if wob >= 0 else 2), bow_y, RIBBON_RED[1], 6)
        for side in (-1, 1):
            for k in range(1, 7):
                sway = math.sin(t * 3.5 - k * 0.7 + side) * (0.4 + k * 0.35)
                x = CX + side * (1 + k * 0.6) + sway
                ch = "(" if math.cos(t * 3.5 - k * 0.7 + side) > 0 else ")"
                self.put(ch, x, bow_y + k, lerp(*RIBBON_RED, 0.9 - k * 0.08), 6)

        # 선물 상자 (가운데 상자는 들썩들썩)
        self.gift(CX - 27, BASE_Y + 1, BLUE, GOLD, phase=0.0)
        self.gift(CX + 17, BASE_Y + 1, RED, WHITE, phase=1.7)
        hop = max(0.0, math.sin(t * 5)) * (1 if int(t / 3) % 2 else 0)
        self.gift(CX - 13, BASE_Y + 2, PALETTE["p"], GOLD, w=6, h=3, phase=3.1, lid=hop)

        # 눈사람 (손 흔들기)
        self.sprite(SNOWMAN[int(t * 3) % 2], COLS - 12, BASE_Y - 2, 2)

        # 메시지 (한 글자씩 나타나며 반짝)
        shown = min(len(MESSAGE), int(t * 3))
        x0 = CX - len(MESSAGE)
        for i, ch in enumerate(MESSAGE[:shown]):
            if ch != " ":
                tint = (RED, GOLD, GREEN_LIGHT)[(i // 2 + int(t * 1.5)) % 3]
                self.put(ch, x0 + i * 2, BASE_Y + 10, scale(tint, 0.85 + 0.25 * math.sin(t * 5 + i)), 9)

        self.info = {
            "rotation": math.degrees(rot) % 360,
            "lights": int(on),
            "letters": sum(1 for c in MESSAGE[:shown] if c != " "),
            "santa": santa is not None,
        }

    def gift(self, x, y, box, ribbon, w=8, h=4, phase=0.0, lid=0.0):
        lift = -1 if lid > 0.5 else 0
        for r in range(h):
            for c in range(w):
                mid = c == w // 2 or r == h // 2
                rr = r + (lift if r == 0 else 0)
                self.put("+" if mid else "#", x + c, y + rr, ribbon if mid else box, 3)
        # 리본 매듭이 살랑살랑
        bow = ("<o>", "(o)", "<o)", "(o>")[int(self.t * 4 + phase) % 4]
        self.text(bow, x + w // 2 - 1, y - 1 + lift, ribbon, 3.1)
        if lid > 0.5:
            for k in range(3):
                self.put(random.choice("*+."), x + random.randrange(w), y - 2 - k, GOLD, 3.2)


def draw(screen, scene, glyph):
    screen.fill(BG)
    for r in range(ROWS):
        line, cols = scene.chars[r], scene.colors[r]
        for c in range(COLS):
            if line[c] != " ":
                screen.blit(glyph(line[c], cols[c]), (c * CW, r * CH))


def main():
    pygame.init()
    screen = pygame.display.set_mode((W, H))
    pygame.display.set_caption(TITLE)
    font = pygame.font.SysFont(MONO, FONT_PX)
    small = pygame.font.SysFont(MONO, 13)
    cache = {}

    def glyph(ch, color):
        key = (ch, color[0] >> 3, color[1] >> 3, color[2] >> 3)
        if key not in cache:
            cache[key] = font.render(ch, True, color)
        return cache[key]

    scene = Scene()
    clock = pygame.time.Clock()
    paused = False

    while True:
        dt = clock.tick(FPS) / 1000
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                pygame.quit()
                return
            if e.type == pygame.KEYDOWN:
                if e.key == pygame.K_SPACE:
                    paused = not paused
                elif e.key == pygame.K_r:
                    scene.reset()
                elif e.key == pygame.K_s:
                    name = time.strftime("tree_%Y%m%d_%H%M%S.png")
                    pygame.image.save(screen, name)
                    print("saved", name)
        if not paused:
            scene.update(dt)
        scene.render()
        draw(screen, scene, glyph)

        info = scene.info
        hud = [
            f"rotation {info['rotation']:6.2f}°   lights {info['lights']:3d}   "
            f"letters {info['letters']:2d}/{len(MESSAGE.replace(' ', ''))}   "
            f"santa {'flying' if info['santa'] else '-'}",
            f"{'paused' if paused else 'running'} · {clock.get_fps():4.1f} fps",
            "Space pause · R restart · S screenshot · Esc quit",
        ]
        for i, s in enumerate(hud):
            screen.blit(small.render(s, True, ACCENT if i == 1 else DIM), (10, H - 58 + i * 18))
        pygame.display.flip()


if __name__ == "__main__":
    main()

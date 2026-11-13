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

MESSAGE = "MERRY CHRISTMAS"
NEEDLES = "*^/\\vYA"
SHADE = "-=+:"

# 트리 화면 배치
CX = COLS // 2
TOP_Y = 8
BASE_Y = 52
TREE_H = BASE_Y - TOP_Y
RADIUS_COLS = 30  # 바닥 반지름 (칸)
TIERS = 6         # 가지 층 수


def tier_radius(y):
    """높이 y(0=꼭대기, 1=바닥)에서의 원뿔 반지름 (0~1). 층마다 다시 넓어짐."""
    return y * (0.55 + 0.45 * ((y * TIERS) % 1.0))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def scale(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


class Tree:
    """장식 공과 전구의 원뿔 위 위치 (y: 0=꼭대기 … 1=바닥, theta: 각도)."""

    def __init__(self):
        rng = np.random.default_rng()
        m = 46
        self.orn_y = 0.12 + 0.85 * rng.random(m)
        self.orn_r = tier_radius(self.orn_y) * 1.02
        self.orn_t = rng.random(m) * 2 * math.pi
        self.orn_c = [[RED, GOLD, BLUE][i % 3] for i in range(m)]

        k = 170  # 나선형 전구 줄
        self.light_y = np.linspace(0.04, 0.98, k)
        self.light_r = tier_radius(self.light_y) * 1.04
        self.light_t = self.light_y * 2 * math.pi * 5.5
        self.light_phase = rng.random(k) * 6.28
        self.light_c = [LIGHT_COLORS[i % len(LIGHT_COLORS)] for i in range(k)]


class Scene:
    def __init__(self):
        self.reset()

    def reset(self):
        self.tree = Tree()
        self.t = 0.0
        self.snow = [[random.uniform(0, COLS), random.uniform(0, ROWS), random.uniform(3, 9),
                      random.choice("*.+")] for _ in range(140)]
        self.info = {"rotation": 0.0, "lights": 0, "letters": 0}

    def put(self, ch, col, row, color, z):
        """화면 버퍼에 글자 찍기 (z가 클수록 앞)."""
        if 0 <= col < COLS and 0 <= row < ROWS and z >= self.zbuf[row, col]:
            self.zbuf[row, col] = z
            self.chars[row][col] = ch
            self.colors[row][col] = color

    @staticmethod
    def project(y, r, theta, rot):
        a = theta + rot
        col = np.round(CX + r * np.cos(a) * RADIUS_COLS).astype(int)
        row = np.round(TOP_Y + y * TREE_H).astype(int)
        return col, row, r * np.sin(a)  # z>0 = 앞쪽

    def update(self, dt):
        self.t += dt
        for f in self.snow:
            f[1] += f[2] * dt
            f[0] += math.sin(self.t * 0.8 + f[2]) * dt * 1.5
            if f[1] >= ROWS - 6:
                f[0], f[1] = random.uniform(0, COLS), 0

    def render(self):
        t = self.t
        rot = t * 0.7
        self.chars = [[" "] * COLS for _ in range(ROWS)]
        self.colors = [[BG] * COLS for _ in range(ROWS)]
        self.zbuf = np.full((ROWS, COLS), -99.0)
        tr = self.tree

        # 눈 (맨 뒤)
        for x, y, sp, c in self.snow:
            self.put(c, int(x), int(y), scale(WHITE, 0.35 + sp / 15), -50)

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
                c = lerp(GREEN_DARK, GREEN_LIGHT, min(1.0, lv))
                if abs(u) > 0.93:
                    ch = "/" if u < 0 else "\\"
                else:
                    ch = NEEDLES[h % len(NEEDLES)] if lv > 0.45 else SHADE[h % len(SHADE)]
                self.put(ch, col, row, c, zf * R / RADIUS_COLS - 0.05)

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

        # 별
        pulse = 0.75 + 0.25 * math.sin(t * 3)
        star = ["  .  ", " \\|/ ", "--*--", " /|\\ ", "  '  "]
        for dy, line in enumerate(star):
            for dx, ch in enumerate(line):
                if ch != " ":
                    self.put(ch, CX - 2 + dx, TOP_Y - 4 + dy, scale(GOLD, pulse * (1.3 if ch == "*" else 1)), 5)

        # 선물 상자
        self.gift(CX - 26, BASE_Y + 1, BLUE, GOLD)
        self.gift(CX + 19, BASE_Y + 1, RED, WHITE)
        self.gift(CX - 12, BASE_Y + 2, (150, 60, 200), GOLD, w=6, h=3)

        # 메시지 (한 글자씩 타이핑)
        shown = min(len(MESSAGE), int(t * 3))
        x0 = CX - len(MESSAGE)
        mrow = BASE_Y + 9
        for i, ch in enumerate(MESSAGE[:shown]):
            if ch != " ":
                tint = (RED, GOLD, GREEN_LIGHT)[(i // 2 + int(t * 1.5)) % 3]
                self.put(ch, x0 + i * 2, mrow, scale(tint, 0.85 + 0.25 * math.sin(t * 5 + i)), 9)

        self.info = {
            "rotation": math.degrees(rot) % 360,
            "lights": int(on),
            "letters": sum(1 for c in MESSAGE[:shown] if c != " "),
        }

    def gift(self, x, y, box, ribbon, w=8, h=4):
        for r in range(h):
            for c in range(w):
                mid = c == w // 2 or r == h // 2
                self.put("+" if mid else "#", x + c, y + r, ribbon if mid else box, 3)
        self.put("&", x + w // 2, y - 1, ribbon, 3)


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
            f"letters {info['letters']:2d}/{len(MESSAGE.replace(' ', ''))}",
            f"{'paused' if paused else 'running'} · {clock.get_fps():4.1f} fps",
            "Space pause · R restart · S screenshot · Esc quit",
        ]
        for i, s in enumerate(hud):
            screen.blit(small.render(s, True, ACCENT if i == 1 else DIM), (10, H - 58 + i * 18))
        pygame.display.flip()


if __name__ == "__main__":
    main()

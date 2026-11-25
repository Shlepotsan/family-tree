# -*- coding: utf-8 -*-
"""
rings_concept.py — чертёж концепта «годичных колец рода».

Древо как срез ствола: центр — сейчас (2026) и пара, от которой считаем род,
каждое кольцо — десять лет назад. Человек — точка на своём году;
угол = линия рода, радиус = год. Где дат нет — место считается
от родни, точка пустая, в подписи «≈».

Правила раскладки (те же, что должны быть на сайте):
 1. сектор задаёт линия рода (три ветви от пары в центре);
 2. внутри сектора люди идут по поколению, ветви-фамилии и году;
 3. год берётся точный, иначе считается от детей/родителей/супруга
    (ребёнок − 28, родитель + 27, супруг ± 2);
 4. человек без связей падает в медианный год семьи.

Скрипт читает I:/Семья/Древо/data.js (через node) и рисует PNG.
Запуск:  python rings_concept.py
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.normpath(os.path.join(ROOT, '..', 'data.js'))
OUT_PNG = os.path.join(ROOT, 'rings_concept.png')

NOW = 2026
S = 2
W, H = 2560, 1700

PAPER = (246, 241, 230)
PAPER_D = (237, 229, 212)
INK = (36, 31, 25)
INK_2 = (92, 82, 68)
INK_3 = (146, 134, 114)
LINE = (219, 207, 184)
LINE_S = (231, 222, 203)
ACCENT = (138, 63, 42)
GREEN = (47, 93, 80)

FONTS = {
    'serif': r'C:\Windows\Fonts\georgia.ttf',
    'serifb': r'C:\Windows\Fonts\georgiab.ttf',
    'serifi': r'C:\Windows\Fonts\georgiai.ttf',
    'ui': r'C:\Windows\Fonts\segoeui.ttf',
    'uib': r'C:\Windows\Fonts\segoeuib.ttf',
    'uisb': r'C:\Windows\Fonts\seguisb.ttf',
    'uil': r'C:\Windows\Fonts\segoeuil.ttf',
    'mono': r'C:\Windows\Fonts\consola.ttf',
}
_fc = {}


def F(name, size):
    k = (name, size)
    if k not in _fc:
        _fc[k] = ImageFont.truetype(FONTS[name], int(round(size * S)))
    return _fc[k]


class Cv:
    def __init__(self, w, h, bg=PAPER):
        self.w, self.h = w, h
        self.img = Image.new('RGB', (w * S, h * S), bg)
        self.d = ImageDraw.Draw(self.img, 'RGBA')

    def _box(self, b):
        return [b[0] * S, b[1] * S, b[2] * S, b[3] * S]

    def _p(self, p):
        return (p[0] * S, p[1] * S)

    def line(self, pts, fill=INK, width=1):
        self.d.line([self._p(p) for p in pts], fill=fill, width=max(1, int(round(width * S))))

    def ellipse(self, box, fill=None, outline=None, width=1):
        self.d.ellipse(self._box(box), fill=fill, outline=outline,
                       width=max(1, int(round(width * S))) if outline else 0)

    def rect(self, box, fill=None, outline=None, width=1):
        self.d.rectangle(self._box(box), fill=fill, outline=outline,
                         width=max(1, int(round(width * S))) if outline else 0)

    def rrect(self, box, r, fill=None, outline=None, width=1):
        self.d.rounded_rectangle(self._box(box), radius=r * S, fill=fill, outline=outline,
                                 width=max(1, int(round(width * S))) if outline else 0)

    def arc(self, box, a0, a1, fill=INK, width=1):
        self.d.arc(self._box(box), start=-a1, end=-a0, fill=fill,
                   width=max(1, int(round(width * S))))

    def dash_arc(self, box, a0, a1, fill=INK, width=1, dash=4.0, gap=3.0):
        n = max(2, int(abs(a1 - a0) / (dash + gap) * 2))
        step = (a1 - a0) / n
        for i in range(0, n - 1, 2):
            self.arc(box, a0 + i * step, a0 + (i + 1) * step, fill=fill, width=width)

    def text(self, xy, s, font, fill=INK, anchor='la'):
        self.d.text((xy[0] * S, xy[1] * S), s, font=font, fill=fill, anchor=anchor)

    def tw(self, s, font):
        return self.d.textlength(s, font=font) / S

    def paste(self, im, center):
        self.img.paste(im, (int(center[0] * S - im.width / 2),
                            int(center[1] * S - im.height / 2)), im)

    def save(self, path):
        out = self.img.resize((self.w, self.h), Image.LANCZOS)
        out.convert('RGB').save(path)


def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy - r * math.sin(a))


def dash_seg(cv, p0, p1, width, color, dash=5.0, gap=4.0):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < 0.5:
        return
    ux, uy = dx / L, dy / L
    t = 0.0
    while t < L:
        e = min(t + dash, L)
        cv.line([(p0[0] + ux * t, p0[1] + uy * t),
                 (p0[0] + ux * e, p0[1] + uy * e)], fill=color, width=width)
        t = e + gap


# ---------------------------------------------------------------- данные
def find_node():
    for c in (shutil.which('node'),
              r'C:\Users\mrshl\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'):
        if c and os.path.exists(c):
            return c
    return None


JS = r"""
global.window = global;
require(%s);
const F = window.FAMILY;
const pick = p => ({id:p.id, first:p.first||'', middle:p.middle||'', last:p.last||'',
  maiden:p.maiden||'', sex:p.sex||'', branch:p.branch||'other', born:p.born||'',
  died:p.died||'', isSelf:!!p.isSelf});
process.stdout.write(JSON.stringify({meta:F.meta, branches:F.branches,
  people:F.people.map(pick),
  unions:F.unions.map(u=>({id:u.id, partners:u.partners.slice(),
  children:(u.children||[]).slice(), type:u.type||''}))}));
"""


def load_data():
    node = find_node()
    if not node:
        sys.exit('Не найден node — им читается data.js')
    js = JS % json.dumps(DATA_JS.replace('\\', '/'), ensure_ascii=False)
    res = subprocess.run([node, '-e', js], capture_output=True)
    if res.returncode != 0:
        sys.exit(res.stderr.decode('utf-8', 'replace'))
    return json.loads(res.stdout.decode('utf-8'))


YEAR_RE = re.compile(r'\b(1[6-9]\d\d|20[0-2]\d)\b')


def year_of(s):
    if not s:
        return None
    if 'войн' in s.lower():
        return 1943
    m = YEAR_RE.search(s)
    return int(m.group(1)) if m else None


def estimate(fam):
    P = {p['id']: p for p in fam['people']}
    for p in P.values():
        p['b'] = year_of(p['born'])
        p['d'] = year_of(p['died'])
        p['b_known'] = p['b'] is not None
        p['d_known'] = p['d'] is not None
        p['alive'] = False

    parents, kids, spouses = {}, {}, {}
    for u in fam['unions']:
        mem = u['partners']
        for c in u['children']:
            parents.setdefault(c, set()).update(mem)
            for m in mem:
                kids.setdefault(m, set()).add(c)
        for a in mem:
            for b in mem:
                if a != b:
                    spouses.setdefault(a, set()).add(b)

    # годы вверх-вниз по родне, пока есть что уточнять
    for _ in range(10):
        changed = False
        for pid, p in P.items():
            if p['b'] is not None:
                continue
            cand = []
            for q in parents.get(pid, ()):
                if P[q]['b']:
                    cand.append(P[q]['b'] + 27)
            for q in kids.get(pid, ()):
                if P[q]['b']:
                    cand.append(P[q]['b'] - 28)
            if cand:
                cand.sort()
                p['b'] = cand[len(cand) // 2]
                changed = True
        if not changed:
            break

    for pid, p in P.items():
        if p['b'] is None:
            for q in spouses.get(pid, ()):
                if P[q]['b']:
                    p['b'] = P[q]['b'] + 2
                    break

    known_b = sorted(p['b'] for p in P.values() if p['b'] is not None)
    fallback = known_b[len(known_b) // 2] if known_b else 1945
    for pid, p in P.items():
        if p['b'] is None:
            p['b'] = (p['d'] - 62) if p['d'] else fallback - 10

    for p in P.values():
        if p['d'] is None:
            if p['b'] <= NOW - 96:
                p['d'] = p['b'] + 76
            else:
                p['d'] = NOW
                p['alive'] = True
    return P, parents, kids


# ---------------------------------------------------------------- раскладка
SECTORS = {'pat': (88.0, 178.0), 'mat': (182.0, 272.0), 'kat': (-44.0, 44.0)}
ROOTS = {'pat': 'shlepov-alexander', 'mat': 'shlepova-svetlana', 'kat': 'usacheva-ekaterina'}


def side_of(P, parents, kids):
    side = {}
    for key in ('pat', 'mat', 'kat'):
        stack = [ROOTS[key]]
        while stack:
            pid = stack.pop()
            if pid in side:
                continue
            side[pid] = key
            stack.extend(q for q in parents.get(pid, ()))
            stack.extend(q for q in kids.get(pid, ()))
    for pid in P:
        side.setdefault(pid, 'other')
    return side


def gender_of(P, parents, kids):
    gen = {}
    dq = deque()
    for pid in ('shlepov-leonid', 'usacheva-ekaterina'):
        gen[pid] = 0
        dq.append(pid)
    while dq:
        cur = dq.popleft()
        for q in list(parents.get(cur, ())) + list(kids.get(cur, ())):
            if q not in gen:
                gen[q] = gen[cur] + (1 if q in parents.get(cur, ()) else -1)
                dq.append(q)
    # то, что не связано с парой, — по цепочке от ближайшего известного
    for _ in range(6):
        for pid in P:
            if pid in gen:
                continue
            nb = [gen[q] for q in list(parents.get(pid, ())) + list(kids.get(pid, ())) if q in gen]
            if nb:
                gen[pid] = sum(nb) // len(nb)
    for pid in P:
        gen.setdefault(pid, -4)
    return gen


def layout(P, fam, side, gen):
    order = list(fam['branches'].keys())
    bidx = {b: i for i, b in enumerate(order)}
    placed = {}
    COUPLE = ('shlepov-leonid', 'usacheva-ekaterina')
    for key, (a0, a1) in SECTORS.items():
        mem = [p for p in P.values() if side[p['id']] == key and p['id'] not in COUPLE]
        if not mem:
            continue
        mem.sort(key=lambda p: (gen[p['id']], bidx.get(p['branch'], 99), p['b']))
        step = (a1 - a0) / len(mem)
        for i, p in enumerate(mem):
            placed[p['id']] = {'ang': a0 + step * (i + 0.5), 'sector': key}
    placed['shlepov-leonid'] = {'ang': 180.0, 'sector': 'self'}
    placed['usacheva-ekaterina'] = {'ang': 0.0, 'sector': 'self'}
    # одиночки вне рода
    oth = [p for p in P.values() if side[p['id']] == 'other']
    for i, p in enumerate(oth):
        placed[p['id']] = {'ang': 280.0 + i * 5.0, 'sector': 'other'}
    return placed


# ---------------------------------------------------------------- рисование
def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def draw_rings(cv, cx, cy, R, y_old, with_labels=True):
    span = NOW - y_old

    def r_of(y):
        return R * (NOW - y) / span

    y = (int(y_old) // 10 + 1) * 10
    while y <= NOW:
        r = r_of(y)
        if 12 < r <= R + 0.5:
            box = [cx - r, cy - r, cx + r, cy + r]
            width = 1.6 if y % 100 == 0 else 1.0
            col = (216, 204, 182) if y % 100 else (186, 170, 143)
            cv.ellipse(box, outline=col, width=width)
            if with_labels and r > 84:
                q = polar(cx, cy, r - 9, 66)
                t = str(y)
                f = F('ui', 11)
                w = cv.tw(t, f)
                cv.rect((q[0] - w / 2 - 3, q[1] - 8, q[0] + w / 2 + 3, q[1] + 8), fill=PAPER)
                cv.text(q, t, f, INK_2 if y % 100 == 0 else INK_3, anchor='mm')
        y += 10
    return r_of


def sector_badge(cv, cx, cy, R, ang, num):
    r = R + 21
    q = polar(cx, cy, r, ang)
    cv.line([polar(cx, cy, R + 4, ang), polar(cx, cy, r - 10, ang)], fill=(200, 186, 160), width=0.8)
    cv.ellipse([q[0] - 9.5, q[1] - 9.5, q[0] + 9.5, q[1] + 9.5], fill=PAPER,
               outline=(200, 186, 160), width=0.9)
    cv.text(q, num, F('uisb', 9), INK_2, anchor='mm')


def draw_sector_marks(cv, cx, cy, R, sectors, r_in=10):
    for key, (a0, a1) in sectors.items():
        for a in (a0, a1):
            p0 = polar(cx, cy, 34, a)
            p1 = polar(cx, cy, R + 4, a)
            dash_seg(cv, p0, p1, 0.9, (206, 194, 172), dash=6, gap=6)
    for key, num in (('kat', 'I'), ('pat', 'II'), ('mat', 'III')):
        a0, a1 = sectors[key]
        sector_badge(cv, cx, cy, R, (a0 + a1) / 2, num)


def bezier(cv, p0, p1, p2, color, width, steps=16):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    cv.line(pts, fill=color, width=width)


def draw_links(cv, cx, cy, r_of, placed, P, parents, y_old, R):
    """Тонкие дуги «родители → ребёнок»: чтобы читалось родство, а не россыпь."""
    col = mix(INK, PAPER, 0.74)
    for cid, pars in parents.items():
        if cid not in placed:
            continue
        cp = P[cid]
        if cp['b'] < y_old - 3:
            continue
        pa = placed[cid]['ang']
        pts = []
        for q in pars:
            if q not in placed:
                continue
            d = ((placed[q]['ang'] - pa + 180) % 360) - 180
            if abs(d) > 52:
                continue
            pts.append(polar(cx, cy, min(R, r_of(P[q]['b'])), placed[q]['ang']))
        if not pts:
            continue
        p0 = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        p2 = polar(cx, cy, min(R, r_of(cp['b'])), pa)
        mid_r = (math.hypot(p0[0] - cx, p0[1] - cy) + math.hypot(p2[0] - cx, p2[1] - cy)) / 2
        ang0 = math.degrees(math.atan2(cy - p0[1], p0[0] - cx))
        p1 = polar(cx, cy, mid_r, (ang0 + pa) / 2)
        bezier(cv, p0, p1, p2, col, 1.05)


def draw_people(cv, cx, cy, r_of, placed, P, brand, y_old, cd, k=1.0, R=None, lines=True):
    R = R if R is not None else 1e9
    items = sorted(((P[pid]['b'], pid) for pid in placed), reverse=True)
    accent_ids = ('shlepov-leonid', 'usacheva-ekaterina')

    def col_of(pid):
        if pid in accent_ids:
            return ACCENT
        return brand.get(P[pid]['branch'], (120, 110, 95))

    # линия жизни — только когда известны оба года
    for _, pid in items:
        p = P[pid]
        if not lines or not (p['b_known'] and p['d_known']) or p['b'] < y_old - 45:
            continue
        ang = placed[pid]['ang']
        col = col_of(pid)
        r1 = min(R, r_of(p['b']))
        r0 = max(cd + 5, r_of(min(p['d'], NOW)))
        if r0 >= r1 - 3:
            continue
        cv.line([polar(cx, cy, r0, ang), polar(cx, cy, r1, ang)],
                fill=mix(col, PAPER, 0.22), width=2.0 * k)
        q = polar(cx, cy, r0, ang)
        cv.ellipse([q[0] - 2 * k, q[1] - 2 * k, q[0] + 2 * k, q[1] + 2 * k],
                   fill=mix(col, PAPER, 0.05))

    # точки: залитая — год рождения точный, контур — посчитан
    for _, pid in items:
        p = P[pid]
        if p['b'] < y_old - 3:
            continue
        ang = placed[pid]['ang']
        col = col_of(pid)
        q = polar(cx, cy, r_of(p['b']), ang)
        if pid in accent_ids:
            rr = 6.4 * k
            cv.ellipse([q[0] - rr - 2.6, q[1] - rr - 2.6, q[0] + rr + 2.6, q[1] + rr + 2.6], fill=PAPER)
            cv.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=col)
        elif p['b_known']:
            rr = 4.5 * k
            cv.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=col)
        else:
            rr = 4.3 * k
            cv.ellipse([q[0] - rr, q[1] - rr, q[0] + rr, q[1] + rr], fill=PAPER,
                       outline=mix(col, INK, 0.15), width=1.3 * k)


def label_jobs(cv, cx, cy, placed, P, ids, r_of, font):
    jobs = []
    for pid in ids:
        p = P.get(pid)
        if pid not in placed or p is None:
            continue
        ang = placed[pid]['ang']
        r1 = r_of(p['b']) + 13
        px, py = polar(cx, cy, r1, ang)
        s = p['first'] + ' ' + (p['middle'][:1] + '.' if p.get('middle') else '') + ' ' + p['last']
        s = s.replace('  ', ' ')
        if not (p['b_known'] and p['d_known']):
            s = '≈ ' + s
        side = -1 if math.cos(math.radians(ang)) < 0 else 1
        jobs.append({'pid': pid, 'x': px, 'y': py, 'side': side, 's': s})
    return jobs


def place_labels(cv, jobs, font, colour_of, obstacles=()):
    out = []
    h = 17.0
    for j in jobs:
        w = cv.tw(j['s'], font)
        x = j['x'] - 10 if j['side'] < 0 else j['x'] + 10
        ax = 'r' if j['side'] < 0 else 'l'
        rect = (x - w, j['y'] - h / 2, x, j['y'] + h / 2) if j['side'] < 0 else \
               (x, j['y'] - h / 2, x + w, j['y'] + h / 2)
        for k in range(0, 11):
            dy = 0 if k == 0 else ((-1) ** k) * ((k + 1) // 2) * (h + 2.5)
            r2 = (rect[0], rect[1] + dy, rect[2], rect[3] + dy)
            if any(not (r2[2] < a[0] - 2 or r2[0] > a[2] + 2 or r2[3] < a[1] - 2 or r2[1] > a[3] + 2)
                   for a in out):
                continue
            if any(not (r2[2] < a[0] or r2[0] > a[2] or r2[3] < a[1] or r2[1] > a[3]) for a in obstacles):
                continue
            cv.rrect((r2[0] - 3, r2[1] - 1, r2[2] + 3, r2[3] + 1), 3, fill=PAPER)
            cv.line([(j['x'], j['y']), (x, j['y'] + dy)], fill=(178, 164, 140), width=0.8)
            cv.text((x, j['y'] + dy), j['s'], font, colour_of(j['pid']), anchor=ax + 'm')
            out.append(r2)
            break
    return out


def wrap(cv, s, font, width):
    lines, cur = [], ''
    for w in s.split():
        t = (cur + ' ' + w).strip()
        if not cur or cv.tw(t, font) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_frame(cv, box=(40, 40, 2520, 1660)):
    cv.rect(box, outline=(213, 200, 177), width=1)
    for (x, y, dx, dy) in ((box[0], box[1], 1, 1), (box[2], box[1], -1, 1),
                           (box[0], box[3], 1, -1), (box[2], box[3], -1, -1)):
        cv.line([(x, y + dy * 28), (x, y), (x + dx * 28, y)], fill=(190, 175, 148), width=1)


def draw_header(cv):
    x = 96
    cv.text((x, 88), 'КОНЦЕПТ-ЧЕРТЁЖ', F('uisb', 11), INK_3)
    cv.line([(x + 128, 96), (x + 186, 96)], fill=(198, 184, 158), width=0.9)
    cv.text((x + 198, 88), '26 · 11 · 2026', F('ui', 11), INK_3)
    cv.text((x, 116), 'Годичные кольца рода', F('serifb', 50), INK)
    cv.text((x + 2, 190), 'Древо как срез ствола: в центре — пара, от которой считаем род; каждое кольцо — десять лет назад.', F('ui', 18), INK_2)
    cv.text((x + 2, 216), 'Люди стоят на своих годах; где дат нет — место посчитано от родни и обведено контуром.', F('ui', 18), INK_2)


def draw_chart(cv, cx, cy, R, y_old, placed, P, fam, label_ids=(), ring_labels=True,
               sector_labels=True, label_font=13.5, center_caption=True, k=1.0, parents=None,
               lines=True, links=True):
    brand = {k: hex2rgb(v['color']) for k, v in fam['branches'].items()}
    r_of = draw_rings(cv, cx, cy, R, y_old, with_labels=ring_labels)
    if sector_labels:
        draw_sector_marks(cv, cx, cy, R, SECTORS)

    cd = max(9.0, R * 0.05)
    if parents and links:
        draw_links(cv, cx, cy, r_of, placed, P, parents, y_old, R)
    draw_people(cv, cx, cy, r_of, placed, P, brand, y_old, cd, k=k, R=R, lines=lines)
    cv.ellipse([cx - cd, cy - cd, cx + cd, cy + cd], fill=PAPER, outline=(205, 190, 165), width=1)
    cv.ellipse([cx - 2.4, cy - 2.4, cx + 2.4, cy + 2.4], fill=INK)
    if center_caption:
        cv.text((cx, cy + cd + 15), 'центр · пара', F('serifi', 12.5), INK_2, anchor='ma')

    if label_ids:
        font = F('ui', label_font)
        jobs = label_jobs(cv, cx, cy, placed, P, label_ids, r_of, font)

        def col_of(pid):
            p = P[pid]
            if pid in ('shlepov-leonid', 'usacheva-ekaterina'):
                return ACCENT
            return INK if (p['b_known'] and p['d_known']) else INK_2
        place_labels(cv, jobs, font, col_of)
    return r_of


def draw_legend(cv, x, y):
    f = F('ui', 13)
    cv.text((x, y - 30), 'ЧТЕНИЕ', F('uisb', 9.5), INK_3)
    x += 78

    cv.ellipse([x, y - 4.8, x + 9.6, y + 4.8], fill=GREEN)
    cv.text((x + 17, y), 'год рождения точный', f, INK_2, anchor='lm')
    x += 17 + cv.tw('год рождения точный', f) + 26

    cv.ellipse([x, y - 4.8, x + 9.6, y + 4.8], fill=PAPER, outline=mix(GREEN, INK, 0.15), width=1.4)
    cv.text((x + 17, y), 'посчитан от родни', f, INK_2, anchor='lm')
    x += 17 + cv.tw('посчитан от родни', f) + 26

    cv.line([(x, y), (x + 26, y)], fill=mix(GREEN, PAPER, 0.22), width=2)
    cv.ellipse([x + 24, y - 2, x + 28, y + 2], fill=mix(GREEN, PAPER, 0.05))
    cv.text((x + 36, y), 'линия жизни', f, INK_2, anchor='lm')
    x += 36 + cv.tw('линия жизни', f) + 26

    r = 12
    cv.arc([x - r, y - r, x + r, y + r], 200, 340, fill=(190, 175, 148), width=1)
    cv.arc([x - r + 6, y - r + 6, x + r - 6, y + r - 6], 200, 340, fill=(190, 175, 148), width=1)
    cv.text((x + 20, y), 'кольцо = 10 лет', f, INK_2, anchor='lm')


def draw_key(cv, x, y):
    f = F('ui', 12.5)
    cv.text((x, y - 30), 'ЛИНИИ', F('uisb', 9.5), INK_3)
    x += 78
    items = [('I', 'линия партнёра'),
             ('II', 'линия отца'),
             ('III', 'линия матери')]
    for num, text in items:
        cv.ellipse([x, y - 8, x + 16, y + 8], fill=PAPER, outline=(200, 186, 160), width=0.9)
        cv.text((x + 8, y), num, F('uisb', 7.5), INK_2, anchor='mm')
        cv.text((x + 24, y), text, f, INK_2, anchor='lm')
        x += 24 + cv.tw(text, f) + 30


def draw_phone(cv, x0, y0, placed, P, fam, parents):
    DW, DH = 390, 844
    for i, k in enumerate((14, 8, 3)):
        cv.rrect((x0 - k, y0 - k + 6, x0 + DW + k, y0 + DH + k + 6), 48 + k,
                 fill=mix(PAPER, (120, 106, 86), 0.05 + i * 0.03))
    cv.rrect((x0, y0, x0 + DW, y0 + DH), 46, fill=(38, 33, 27))
    cv.rrect((x0 + 8, y0 + 8, x0 + DW - 8, y0 + DH - 8), 39, fill=PAPER)

    # статус-бар
    cv.text((x0 + 30, y0 + 28), '9:41', F('uib', 10), INK)
    for i in range(4):
        h = 3 + i * 1.6
        cv.rect((x0 + DW - 74 + i * 5, y0 + 36 - h, x0 + DW - 71 + i * 5, y0 + 36), fill=INK)
    cv.rect((x0 + DW - 40, y0 + 27, x0 + DW - 26, y0 + 36), outline=INK, width=1)
    cv.rect((x0 + DW - 39, y0 + 28, x0 + DW - 30, y0 + 35), fill=INK)

    cv.text((x0 + 24, y0 + 60), 'Древо рода', F('uib', 14.5), INK)
    cv.text((x0 + 24, y0 + 82), '83 человека · 3 линии · кольца', F('ui', 9.5), INK_3)

    # фильтры
    chips = [('все', True), ('моя линия', False), ('линия партнёра', False)]
    xx = x0 + 24
    for s, on in chips:
        w = cv.tw(s, F('ui', 9)) + 20
        cv.rrect((xx, y0 + 104, xx + w, y0 + 126), 11,
                 fill=GREEN if on else (247, 242, 232), outline=None if on else (222, 210, 189), width=1)
        cv.text((xx + w / 2, y0 + 115), s, F('ui', 9), (250, 246, 236) if on else INK_2, anchor='mm')
        xx += w + 7

    cx, cy, R = x0 + 195, y0 + 318, 162
    draw_chart(cv, cx, cy, R, 1950, placed, P, fam, ring_labels=False, parents=parents,
               sector_labels=False, label_font=7, center_caption=False, k=0.6, lines=False,
               links=False)
    cv.text((cx, y0 + 500), 'кольцо = 10 лет · центр — сейчас', F('ui', 8.5), INK_3, anchor='ma')

    # карточка снизу
    cv.rrect((x0 + 8, y0 + 556, x0 + DW - 8, y0 + DH - 8), 26, fill=(255, 253, 248))
    cv.rect((x0 + 8, y0 + DH - 40, x0 + DW - 8, y0 + DH - 8), fill=(255, 253, 248))
    cv.rrect((cx - 19, y0 + 570, cx + 19, y0 + 574), 2, fill=(216, 204, 184))
    cv.text((x0 + 26, y0 + 596), 'Екатерина Алексеевна', F('uib', 15), INK)
    cv.text((x0 + 26, y0 + 618), 'Усачева · линия партнёра', F('ui', 10.5), INK_2)
    cv.text((x0 + 26, y0 + 642), '≈ 2004 — сейчас · рядом с Леонидом', F('ui', 10.5), ACCENT)
    cv.rrect((x0 + 26, y0 + 672, x0 + 210, y0 + 706), 10, fill=GREEN)
    cv.text((x0 + 118, y0 + 689), 'Открыть карточку', F('uib', 10.5), (250, 246, 236), anchor='mm')
    cv.rrect((x0 + 220, y0 + 672, x0 + 300, y0 + 706), 10, outline=(214, 201, 179), width=1)
    cv.text((x0 + 260, y0 + 689), 'Родня', F('ui', 10.5), INK_2, anchor='mm')
    cv.text((x0 + 26, y0 + 726), 'годы жизни правятся здесь же: минимум и максимум', F('ui', 8.5), INK_3)

    # кнопка «плюс»
    cv.ellipse([x0 + DW - 74, y0 + 512, x0 + DW - 26, y0 + 560], fill=ACCENT)
    cv.line([(x0 + DW - 58, y0 + 536), (x0 + DW - 42, y0 + 536)], fill=(250, 246, 236), width=2.2)
    cv.line([(x0 + DW - 50, y0 + 528), (x0 + DW - 50, y0 + 544)], fill=(250, 246, 236), width=2.2)


def draw_notes(cv, x, y):
    items = [
        ('Кольцо = 10 лет', 'Центр — 2026 год. Чем дальше от центра, тем раньше: 1990, 1980, 1970…'),
        ('Человек — дуга', 'Угол держит линию рода, радиус — год. Дуга идёт от рождения до смерти.'),
        ('Пусто в датах — считаем', 'Минимум и максимум жизни плюс ориентир «рядом с…»: место встаёт само, контуром.'),
        ('Что уже есть', '83 человека, 26 браков. Подписи — только у прямых предков.'),
    ]
    yy = y
    for i, (head, body) in enumerate(items, 1):
        cv.ellipse([x, yy - 1, x + 22, yy + 21], outline=(206, 192, 168), width=1)
        cv.text((x + 11, yy + 10), str(i), F('uib', 10), ACCENT, anchor='mm')
        cv.text((x + 34, yy), head, F('uisb', 13), INK)
        lines = wrap(cv, body, F('ui', 14), 400)
        for k, ln in enumerate(lines):
            cv.text((x + 34, yy + 22 + k * 19), ln, F('ui', 14), INK_2)
        yy += 26 + len(lines) * 19 + 20


def draw_form(cv, x, y):
    box = (x, y, x + 404, y + 296)
    cv.rrect(box, 14, fill=(255, 253, 248), outline=(226, 215, 196), width=1)
    cv.text((x + 22, y + 20), 'новый человек', F('uisb', 13), INK)
    cv.text((x + 22, y + 52), 'ГОДЫ ЖИЗНИ', F('uisb', 9), INK_3)
    cv.text((x + 404 - 22, y + 52), 'обязательно', F('ui', 9), ACCENT, anchor='ra')
    for i, (lab, val) in enumerate((('от', '1890'), ('до', '1965'))):
        bx = x + 22 + i * 142
        cv.rrect((bx, y + 66, bx + 132, y + 98), 8, outline=(222, 210, 189), width=1)
        cv.text((bx + 10, y + 74), lab, F('ui', 8.5), INK_3)
        cv.text((bx + 10, y + 82), val, F('uib', 13), INK)
    cv.text((x + 22, y + 118), 'РЯДОМ С', F('uisb', 9), INK_3)
    cv.text((x + 404 - 22, y + 118), 'можно не указывать', F('ui', 9), INK_3, anchor='ra')
    cv.rrect((x + 22, y + 132, x + 382, y + 164), 8, outline=(222, 210, 189), width=1)
    cv.text((x + 32, y + 140), 'Иван Дмитриевич Пушкин', F('ui', 12.5), INK)
    cv.line([(x + 358, y + 144), (x + 364, y + 149), (x + 370, y + 144)], fill=INK_3, width=1.2)
    cv.text((x + 22, y + 180), 'угол — от родни, радиус — от годов;', F('ui', 11), INK_2)
    cv.text((x + 22, y + 196), 'место встанет само, без перетаскивания', F('ui', 11), INK_2)
    cv.rrect((x + 22, y + 228, x + 382, y + 268), 9, fill=GREEN)
    cv.text((x + 202, y + 248), 'Добавить', F('uib', 12), (250, 246, 236), anchor='mm')


def finish(cv, path):
    """Уменьшение, лёгкая виньетка и зерно бумаги."""
    import numpy as np
    out = cv.img.resize((cv.w, cv.h), Image.LANCZOS)
    a = np.asarray(out).astype(np.float32)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    v = 1.0 - 0.055 * np.clip(d - 0.62, 0, 1.4)
    a *= v[..., None]
    rng = np.random.default_rng(11)
    a += rng.normal(0, 2.2, (h, w, 1))
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(path)


def main():
    fam = load_data()
    P, parents, kids = estimate(fam)
    side = side_of(P, parents, kids)
    gen = gender_of(P, parents, kids)
    placed = layout(P, fam, side, gen)

    cv = Cv(W, H)
    draw_frame(cv)
    draw_header(cv)

    labels = ['shlepov-leonid', 'usacheva-ekaterina',
              'shlepov-alexander', 'shlepova-svetlana', 'usachev-alexey', 'usacheva-nadezhda',
              'shlepov-sergey', 'shlepova-natalya', 'volodin-mikhail', 'volodina-nadezhda',
              'deyanov-vladimir', 'deyanova-praskovya', 'pushkin-ivan', 'pushkina-evdokia',
              'shlepov-alexey', 'shlepova-lidiya', 'murzin-vladimir', 'lysova-marya',
              'volodin-vasily', 'volodina-valentina', 'morozov-mikhail', 'morozova-marya',
              'shlepova-arina', 'shlepov-lev']
    draw_chart(cv, 800, 905, 555, 1844, placed, P, fam, labels, label_font=13, parents=parents)
    draw_legend(cv, 96, 1522)
    draw_key(cv, 96, 1562)

    draw_phone(cv, 1600, 200, placed, P, fam, parents)
    draw_notes(cv, 2032, 214)
    draw_form(cv, 1600, 1060)

    f = F('ui', 12.5)
    yy = 1400
    for line in wrap(cv, 'Телефон — основной экран. Кольца не мельчают: подписи прячутся в точки, '
                         'касание открывает карточку снизу. Палец в любом месте — перенос, '
                         'два пальца — масштаб, клавиатура не сдвигает кольца.', f, 860):
        cv.text((1600, yy), line, f, INK_2)
        yy += 20

    cv.text((1600, 1608), 'данные: data.js (83 человека, 26 браков) · чертёж: Python + Pillow',
            F('ui', 10), INK_3)
    finish(cv, OUT_PNG)
    print('ok', OUT_PNG)


if __name__ == '__main__':
    main()


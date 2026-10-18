# Builds driver/routes.json for the driver assistant (강서04/05/06) from the
# main site's data: stops/routes in index.html, road shapes in route-shapes.js
# (the same TOPIS line the main map draws), signal intersections in
# traffic-intersections.js.  Run from the repo root:  python driver/build_data.py
import json, math, re, os, datetime

ROUTE_NAMES = ['강서04', '강서05', '강서06']
# Official timetable (Seoul bus info, 2026-10-18): first/last bus and headway in minutes.
SCHEDULE = {
    '강서04': {'first': '05:50', 'last': '23:10', 'headway': {'weekday': 12, 'saturday': 12, 'holiday': 12}},
    '강서05': {'first': '05:30', 'last': '23:20', 'headway': {'weekday': 10, 'saturday': 10, 'holiday': 11}},
    '강서06': {'first': '05:45', 'last': '23:10', 'headway': {'weekday': 11, 'saturday': 18, 'holiday': 18}},
}
SIGNAL_SNAP_M = 35        # intersection must be this close to the road shape
REPASS_GAP_M = 250        # a second pass of the same intersection on loop routes
CAND_M = 250              # stop-to-shape candidates considered for the alignment

def hav(a, b, c, d):
    R = 6371000; p1 = math.radians(a); p2 = math.radians(c)
    dp = math.radians(c - a); dl = math.radians(d - b)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def bearing(a, b, c, d):
    p1 = math.radians(a); p2 = math.radians(c); dl = math.radians(d - b)
    y = math.sin(dl)*math.cos(p2); x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def js_value(src, name):
    m = re.search(r'(?:const|let|var)\s+' + name + r'\s*=\s*', src)
    if not m: raise SystemExit('missing ' + name)
    i = m.end(); depth = 0; instr = None; esc = False
    for j in range(i, len(src)):
        ch = src[j]
        if instr:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == instr: instr = None
            continue
        if ch in '"\'': instr = ch
        elif ch in '[{': depth += 1
        elif ch in ']}':
            depth -= 1
            if depth == 0: return json.loads(src[i:j+1])
    raise SystemExit('unterminated ' + name)

def seg_project(lat, lng, pts, cum):
    """distance and along-position of (lat,lng) on every segment of the polyline"""
    kx = math.cos(math.radians(lat)) * 111320; ky = 110540; out = []
    for i in range(len(pts) - 1):
        ax = (pts[i][1] - lng) * kx; ay = (pts[i][0] - lat) * ky
        bx = (pts[i+1][1] - lng) * kx; by = (pts[i+1][0] - lat) * ky
        dx = bx - ax; dy = by - ay; l2 = dx*dx + dy*dy
        t = 0 if not l2 else max(0, min(1, -(ax*dx + ay*dy) / l2))
        out.append((math.hypot(ax + t*dx, ay + t*dy), cum[i] + t*(cum[i+1] - cum[i])))
    return out

def align(stops, pts, cum):
    """stop positions along the line, in route order, minimising total offset"""
    cands = []
    for s in stops:
        pr = seg_project(s['lat'], s['lng'], pts, cum)
        local = [pr[i] for i in range(len(pr))
                 if pr[i][0] <= CAND_M and (i == 0 or pr[i][0] <= pr[i-1][0]) and (i == len(pr)-1 or pr[i][0] <= pr[i+1][0])]
        local.append(min(pr))
        cands.append(sorted(set((round(d, 2), round(a, 2)) for d, a in local), key=lambda x: x[1]))
    INF = float('inf'); prev = [(d, None) for d, a in cands[0]]; back = [prev]
    for k in range(1, len(stops)):
        cur = []
        for d, a in cands[k]:
            best = (INF, None)
            for j, (pd, pa) in enumerate(cands[k-1]):
                if pa <= a + 5 and back[-1][j][0] + d < best[0]: best = (back[-1][j][0] + d, j)
            cur.append(best)
        back.append(cur)
    j = min(range(len(back[-1])), key=lambda t: back[-1][t][0]); res = []
    for k in range(len(stops) - 1, -1, -1):
        res.append(cands[k][j]); j = back[k][j][1] if back[k][j][1] is not None else j
    return res[::-1]

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(root, 'index.html'), encoding='utf8').read()
STOPS = js_value(html, 'STOPS'); ROUTES = js_value(html, 'ROUTES')
shapes_src = open(os.path.join(root, 'route-shapes.js'), encoding='utf8').read()
sig_src = open(os.path.join(root, 'traffic-intersections.js'), encoding='utf8').read()
SIGNALS = js_value(sig_src.replace('window.STATIC_TRAFFIC_INTERSECTIONS', 'const STATIC_TRAFFIC_INTERSECTIONS'), 'STATIC_TRAFFIC_INTERSECTIONS')
stop_by_node = {str(s['node']): s for s in STOPS}

out = []
for name in ROUTE_NAMES:
    route = next(r for r in ROUTES if r['name'] == name)
    m = re.search(r'"' + re.escape(str(route['id'])) + r'":(\[\[.*?\]\])', shapes_src)
    pts = json.loads(m.group(1))
    cum = [0.0]
    for a, b in zip(pts, pts[1:]): cum.append(cum[-1] + hav(a[0], a[1], b[0], b[1]))
    route_stops = [stop_by_node[str(n)] for n in route['nodes'] if str(n) in stop_by_node]
    pos = align(route_stops, pts, cum)
    stops = [{'name': s['name'], 'ars': s.get('ars', ''), 'node': str(s['node']), 'lat': s['lat'], 'lng': s['lng'],
              'along': round(a, 1), 'off': round(d, 1), 'virtual': '(가상)' in s['name']} for s, (d, a) in zip(route_stops, pos)]
    lats = [p[0] for p in pts]; lngs = [p[1] for p in pts]
    box = (min(lats) - .001, max(lats) + .001, min(lngs) - .001, max(lngs) + .001)
    signals = []
    for row in SIGNALS:
        std, cid, la, ln, nm = str(row[0]), str(row[1]), float(row[2]), float(row[3]), row[4] if len(row) > 4 else '교차로'
        if not std.startswith('11') or not (box[0] <= la <= box[1] and box[2] <= ln <= box[3]): continue
        pr = seg_project(la, ln, pts, cum)
        i = 0
        while i < len(pr):
            if pr[i][0] <= SIGNAL_SNAP_M:
                j = i
                while j + 1 < len(pr) and pr[j+1][0] <= SIGNAL_SNAP_M: j += 1
                mi = min(range(i, j + 1), key=lambda t: pr[t][0]); along = pr[mi][1]
                a = pts[max(0, mi - 3)]; b = pts[min(len(pts) - 1, mi + 4)]
                h = bearing(a[0], a[1], b[0], b[1])
                a2 = pts[max(0, mi - 5)]; c2 = pts[min(len(pts) - 1, mi + 6)]
                h1 = bearing(a2[0], a2[1], pts[mi][0], pts[mi][1]); h2 = bearing(pts[mi+1][0], pts[mi+1][1], c2[0], c2[1])
                turn = ((h2 - h1 + 540) % 360) - 180
                if not signals or not (signals[-1]['id'] == cid and along - signals[-1]['along'] < REPASS_GAP_M):
                    signals.append({'id': cid, 'std': std, 'name': nm, 'lat': la, 'lng': ln, 'along': round(along, 1),
                                    'heading': round(h, 1), 'turn': round(turn, 1)})
                i = j + 1
            else:
                i += 1
    signals.sort(key=lambda x: x['along'])
    out.append({'id': str(route['id']), 'name': name, 'length': round(cum[-1], 1), 'schedule': SCHEDULE[name],
                'shape': [[round(p[0], 6), round(p[1], 6)] for p in pts], 'stops': stops, 'signals': signals})
    offs = sorted(s['off'] for s in stops)
    print(name, 'stops', len(stops), 'signals', len(signals), 'length %.1fkm' % (cum[-1] / 1000),
          'stop offset median %.0fm max %.0fm' % (offs[len(offs)//2], offs[-1]),
          'monotonic', all(x['along'] <= y['along'] + 5 for x, y in zip(stops, stops[1:])))

json.dump({'built': datetime.date.today().isoformat(), 'source': 'TOPIS route shape (same as the main map)', 'routes': out},
          open(os.path.join(root, 'driver', 'routes.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))

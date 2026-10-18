# Builds driver/routes.json for the driver assistant (강서04/05/06) from the
# main site's data: stops/routes in index.html, road shapes in route-shapes.js,
# signal intersections in traffic-intersections.js.
# Run from the repo root:  python driver/build_data.py
import json, math, re, os

ROUTE_NAMES = ['강서04', '강서05', '강서06']
SIGNAL_SNAP_M = 35        # intersection must be this close to the road shape
REPASS_GAP_M = 250        # a second pass of the same intersection on loop routes

def hav(a, b, c, d):
    R = 6371000; p1 = math.radians(a); p2 = math.radians(c)
    dp = math.radians(c - a); dl = math.radians(d - b)
    x = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(x))

def bearing(a, b, c, d):
    p1 = math.radians(a); p2 = math.radians(c); dl = math.radians(d - b)
    y = math.sin(dl)*math.cos(p2); x = math.cos(p1)*math.sin(p2) - math.sin(p1)*math.cos(p2)*math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def js_array(src, name):
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

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(root, 'index.html'), encoding='utf8').read()
STOPS = js_array(html, 'STOPS'); ROUTES = js_array(html, 'ROUTES')
shapes_src = open(os.path.join(root, 'route-shapes.js'), encoding='utf8').read()
sig_src = open(os.path.join(root, 'traffic-intersections.js'), encoding='utf8').read()
SIGNALS = js_array(sig_src.replace('window.STATIC_TRAFFIC_INTERSECTIONS', 'const STATIC_TRAFFIC_INTERSECTIONS'), 'STATIC_TRAFFIC_INTERSECTIONS')
stop_by_node = {str(s['node']): s for s in STOPS}

def shape_for(route_id):
    m = re.search(r'"' + re.escape(route_id) + r'":(\[\[.*?\]\])', shapes_src)
    return json.loads(m.group(1)) if m else None

out = []
for name in ROUTE_NAMES:
    route = next(r for r in ROUTES if r['name'] == name)
    route_stops = [stop_by_node[str(n)] for n in route['nodes'] if str(n) in stop_by_node]
    # The TOPIS shapes of these village routes skip whole sections, so the road
    # path is routed through every stop in order (OSRM, car profile).
    coords = ';'.join(f"{s['lng']},{s['lat']}" for s in route_stops)
    url = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' + coords + '?overview=full&geometries=geojson&continue_straight=true'
    import urllib.request
    data = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'dreamstation1-led-driver-build'}), timeout=60))
    r0 = data['routes'][0]
    pts = [[c[1], c[0]] for c in r0['geometry']['coordinates']]
    cum = [0.0]
    for a, b in zip(pts, pts[1:]): cum.append(cum[-1] + hav(a[0], a[1], b[0], b[1]))
    legs = [leg['distance'] for leg in r0['legs']]
    scale = cum[-1] / max(1, sum(legs))
    stops = []; acc = 0.0
    for idx, s in enumerate(route_stops):
        if idx: acc += legs[idx - 1] * scale
        snap = data['waypoints'][idx]
        stops.append({'name': s['name'], 'ars': s.get('ars', ''), 'node': str(s['node']), 'lat': s['lat'], 'lng': s['lng'],
                      'along': round(acc, 1), 'off': round(snap.get('distance', 0), 1), 'virtual': '(가상)' in s['name']})
    # signals along the shape (each pass separately)
    lats = [p[0] for p in pts]; lngs = [p[1] for p in pts]
    box = (min(lats) - .001, max(lats) + .001, min(lngs) - .001, max(lngs) + .001)
    signals = []
    for row in SIGNALS:
        std, cid, la, ln, nm = str(row[0]), str(row[1]), float(row[2]), float(row[3]), row[4] if len(row) > 4 else '교차로'
        if not std.startswith('11') or not (box[0] <= la <= box[1] and box[2] <= ln <= box[3]): continue
        dists = [hav(la, ln, p[0], p[1]) for p in pts]
        i = 0
        while i < len(pts):
            if dists[i] <= SIGNAL_SNAP_M:
                j = i
                while j + 1 < len(pts) and dists[j + 1] <= SIGNAL_SNAP_M: j += 1
                m = min(range(i, j + 1), key=lambda t: dists[t])
                a = pts[max(0, m - 4)]; b = pts[min(len(pts) - 1, m + 4)]
                h = bearing(a[0], a[1], b[0], b[1])
                a2 = pts[max(0, m - 7)]; c2 = pts[min(len(pts) - 1, m + 7)]
                h1 = bearing(a2[0], a2[1], pts[m][0], pts[m][1]); h2 = bearing(pts[m][0], pts[m][1], c2[0], c2[1])
                turn = ((h2 - h1 + 540) % 360) - 180
                if not signals or not (signals[-1]['id'] == cid and cum[m] - signals[-1]['along'] < REPASS_GAP_M):
                    signals.append({'id': cid, 'std': std, 'name': nm, 'lat': la, 'lng': ln, 'along': round(cum[m], 1),
                                    'heading': round(h, 1), 'turn': round(turn, 1)})
                i = j + 1
            else:
                i += 1
    signals.sort(key=lambda x: x['along'])
    out.append({'id': str(route['id']), 'name': name, 'length': round(cum[-1], 1),
                'shape': [[round(p[0], 6), round(p[1], 6)] for p in pts], 'stops': stops, 'signals': signals})
    print(name, 'stops', len(stops), 'signals', len(signals), 'length %.1fkm' % (cum[-1] / 1000),
          'max stop offset %.0fm' % max(s['off'] for s in stops))

json.dump({'built': __import__('datetime').date.today().isoformat(), 'routes': out},
          open(os.path.join(root, 'driver', 'routes.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))

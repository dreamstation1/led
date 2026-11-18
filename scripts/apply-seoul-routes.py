# check-seoul-routes.py 결과(seoul-route-check.json)를 index.html 의 ROUTES/STOPS 와
# route-shapes.js(BUS_ROUTE_SHAPES)에 반영한다. 노선 모양은 m.bus.go.kr getRoutePath 에서 받는다.
# 사용: python scripts/apply-seoul-routes.py
import json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = dict(ensure_ascii=False, separators=(",", ":"))


def post(path, **kw):
    req = urllib.request.Request("http://m.bus.go.kr/mBus/bus/" + path, data=urllib.parse.urlencode(kw).encode(),
                                 headers={"User-Agent": "Mozilla/5.0"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read()).get("resultList") or []


def span(s, name):
    i = s.index("const %s=" % name) + len("const %s=" % name)
    val, end = json.JSONDecoder().raw_decode(s, i)
    assert s[i:end] == json.dumps(val, **DUMP), name + " 다시 쓰면 모양이 바뀜"
    return val, i, end


check = json.load(open(os.path.join(ROOT, "scripts", "seoul-route-check.json"), encoding="utf-8"))
upd = check["new"] + check["changed"]
path = os.path.join(ROOT, "index.html")
s = open(path, encoding="utf-8", newline="").read()
routes, ri, re_ = span(s, "ROUTES")
by_id = {r["id"]: r for r in routes}
for u in upd:
    if u["id"] in by_id:
        by_id[u["id"]]["nodes"] = u["nodes"]
        by_id[u["id"]]["name"] = u["name"]
    else:
        r = {"id": u["id"], "name": u["name"], "nodes": u["nodes"]}
        routes.append(r)
        by_id[u["id"]] = r
s = s[:ri] + json.dumps(routes, **DUMP) + s[re_:]

stops, si, se = span(s, "STOPS")
by_node = {st["node"]: st for st in stops}
added = 0
for u in upd:
    want = set(u["nodes"])
    for st in stops:  # 이 노선에서 빠진 정류소에서는 노선 지우기
        if st["node"] not in want and any(x["id"] == u["id"] for x in st["routes"]):
            st["routes"] = [x for x in st["routes"] if x["id"] != u["id"]]
    for n in u["stops"]:
        st = by_node.get(n["node"])
        if st is None:
            st = {"node": n["node"], "ars": n["ars"], "name": n["name"], "lng": n["lng"], "lat": n["lat"], "routes": []}
            stops.append(st)
            by_node[n["node"]] = st
            added += 1
        st["routes"] = [x for x in st["routes"] if x["id"] != u["id"]] + [{"id": u["id"], "name": u["name"]}]
        st["routes"].sort(key=lambda x: x["name"])
s = s[:si] + json.dumps(stops, **DUMP) + s[se:]
open(path, "w", encoding="utf-8", newline="").write(s)

sp = os.path.join(ROOT, "route-shapes.js")
t = open(sp, encoding="utf-8", newline="").read()
shapes, hi, he = span(t, "BUS_ROUTE_SHAPES")
for u in upd:
    pts = []
    for p in post("getRoutePath.bms", busRouteId=u["id"]):
        q = [round(float(p["gpsY"]), 5), round(float(p["gpsX"]), 5)]
        if not pts or pts[-1] != q:
            pts.append(q)
    if pts:
        shapes[u["id"]] = pts
    time.sleep(0.3)
t = t[:hi] + json.dumps(shapes, **DUMP) + t[he:]
open(sp, "w", encoding="utf-8", newline="").write(t)
print("routes", len(upd), "(new", len(check["new"]), ") stops added", added)

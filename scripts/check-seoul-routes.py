# 서울 노선 데이터(index.html 의 ROUTES/STOPS)를 서울 버스 공개 조회(m.bus.go.kr)와 비교한다.
# 결과: scripts/seoul-route-check.json (새 노선, 정류소 순서가 바뀐 노선, 없어진 노선 + 최신 정류소 목록)
# 사용: python scripts/check-seoul-routes.py
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "http://m.bus.go.kr/mBus/bus/"


def post(path, **kw):
    for attempt in range(3):
        try:
            req = urllib.request.Request(API + path, data=urllib.parse.urlencode(kw).encode(),
                                         headers={"User-Agent": "Mozilla/5.0"})
            return json.loads(urllib.request.urlopen(req, timeout=30).read()).get("resultList") or []
        except Exception as e:
            err = e
            time.sleep(2 + attempt * 3)
    raise err


def load(name):
    s = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    i = s.index("const %s=" % name) + len("const %s=" % name)
    return json.JSONDecoder().raw_decode(s, i)[0]


routes = load("ROUTES")
known = {r["id"]: r for r in routes}
# 서울 노선 전체 목록: 번호 앞자리로 나눠 검색 (빈 검색어는 결과가 없음)
found = {}
for q in [str(d) for d in range(10)] + ["N", "급행", "강", "관", "광", "구", "금", "노", "도", "동", "마", "서", "성", "송", "양", "영", "용", "은", "종", "중"]:
    for x in post("getBusRouteList.bms", strSrch=q):
        if str(x.get("busRouteId", "")).startswith(("1", "0")) and x.get("routeType") not in ("7", "8"):
            found[x["busRouteId"]] = x["busRouteNm"]
    time.sleep(0.3)
print("API routes", len(found), "data routes", len(known), flush=True)
# 검색에 안 걸린 기존 노선도 ID 로 직접 확인 (없어진 노선이면 정류소 목록이 비어 있음)
for rid, r in known.items():
    found.setdefault(rid, r["name"])
out = {"checked": time.strftime("%Y-%m-%d %H:%M"), "new": [], "changed": [], "missing": []}
gone = set()
for rid, nm in sorted(found.items()):
    st = post("getStaionByRoute.bms", busRouteId=rid)
    time.sleep(0.25)
    if not st:
        gone.add(rid)
        continue
    nodes = [a["station"] for a in st]
    stops = [{"node": a["station"], "ars": a["arsId"], "name": a["stationNm"], "lng": float(a["gpsX"]), "lat": float(a["gpsY"])} for a in st]
    if rid not in known:
        out["new"].append({"id": rid, "name": nm, "nodes": nodes, "stops": stops})
        print("NEW", rid, nm, len(nodes), flush=True)
    elif known[rid]["nodes"] != nodes:
        out["changed"].append({"id": rid, "name": nm, "old_name": known[rid]["name"], "nodes": nodes, "stops": stops,
                               "old_len": len(known[rid]["nodes"])})
        print("CHANGED", rid, nm, len(known[rid]["nodes"]), "->", len(nodes), flush=True)
out["missing"] = [{"id": r["id"], "name": r["name"]} for r in routes if r["id"] in gone]
json.dump(out, open(os.path.join(ROOT, "scripts", "seoul-route-check.json"), "w", encoding="utf-8"), ensure_ascii=False)
print("new", len(out["new"]), "changed", len(out["changed"]), "missing", len(out["missing"]))

# index.html 의 정류소(STOPS) 이름·ARS 번호를 서울 버스 공개 조회(m.bus.go.kr)의 노선별 정류소 목록과 비교한다.
# 결과: scripts/stop-name-check.json  {"renamed":[{node, ars, old, new}], "ars_changed":[...]}
# 사용: python scripts/check-stop-names.py
import json, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def post(path, **kw):
    for attempt in range(3):
        try:
            req = urllib.request.Request("http://m.bus.go.kr/mBus/bus/" + path, data=urllib.parse.urlencode(kw).encode(),
                                         headers={"User-Agent": "Mozilla/5.0"})
            return json.loads(urllib.request.urlopen(req, timeout=30).read()).get("resultList") or []
        except Exception as e:
            err = e
            time.sleep(2 + attempt * 3)
    raise err


s = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
dec = json.JSONDecoder()
routes = dec.raw_decode(s, s.index("const ROUTES=") + len("const ROUTES="))[0]
stops = dec.raw_decode(s, s.index("const STOPS=") + len("const STOPS="))[0]
live = {}
for k, r in enumerate(routes):
    for a in post("getStaionByRoute.bms", busRouteId=r["id"]):
        live[a["station"]] = (a["stationNm"], a["arsId"])
    time.sleep(0.25)
    if k % 100 == 0:
        print(k, len(live), flush=True)
out = {"checked": time.strftime("%Y-%m-%d %H:%M"), "renamed": [], "ars_changed": []}
for st in stops:
    if st["node"] not in live:
        continue
    nm, ars = live[st["node"]]
    if nm != st["name"]:
        out["renamed"].append({"node": st["node"], "ars": st["ars"], "old": st["name"], "new": nm})
    if ars != st["ars"] and ars not in ("", "0"):
        out["ars_changed"].append({"node": st["node"], "name": nm, "old": st["ars"], "new": ars})
json.dump(out, open(os.path.join(ROOT, "scripts", "stop-name-check.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("checked stops", sum(1 for st in stops if st["node"] in live), "of", len(stops))
print("renamed", len(out["renamed"]), "ars changed", len(out["ars_changed"]))
for x in out["renamed"]:
    print(x["old"], "->", x["new"])

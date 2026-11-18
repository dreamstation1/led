# check-stop-names.py 결과(stop-name-check.json)로 index.html STOPS 의 정류소 이름을 새 이름으로 바꾼다.
# 지금 녹음이 있는데(옛 이름) 새 이름 녹음은 없는 정류소는 STOP_AUDIO_KEEP(node -> 녹음 이름)에 넣어
# 옛 녹음을 계속 쓴다 (없는 AI 보다 있는 녹음이 낫다).
# 사용: python scripts/apply-stop-names.py
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = dict(ensure_ascii=False, separators=(",", ":"))
check = json.load(open(os.path.join(ROOT, "scripts", "stop-name-check.json"), encoding="utf-8"))
recorded = {re.sub(r"\s", "", f.rsplit(".", 1)[0].split("/")[-1])
            for f in json.load(open(os.path.join(ROOT, "audio-files.json"), encoding="utf-8"))}

path = os.path.join(ROOT, "index.html")
s = open(path, encoding="utf-8", newline="").read()
i = s.index("const STOPS=") + len("const STOPS=")
stops, end = json.JSONDecoder().raw_decode(s, i)
assert s[i:end] == json.dumps(stops, **DUMP)
override = dict(re.findall(r"'([^']+)':'([^']+)'", s[s.index("const STOP_NAME_OVERRIDE={"):s.index("};", s.index("const STOP_NAME_OVERRIDE={"))]))


def audio_key(name):  # index.html 의 표시명/음성 이름 보정과 같은 순서
    n = re.sub(r"\(\d+번홈\)\s*$", "", name).strip()
    if re.fullmatch(r"영등포구청(?:\.우리은행)?", re.sub(r"\s+", "", n)):
        n = "영등포구청"
    return override.get(re.sub(r"\s+", "", n), name if n == name else name)


def plays(name):
    k = re.sub(r"\s+", "", re.sub(r"\(\d+번홈\)\s*$", "", name).strip())
    return override.get(k, name)


by_node = {st["node"]: st for st in stops}
keep = {}
for r in check["renamed"]:
    st = by_node[r["node"]]
    old_key = plays(st["name"])
    if re.sub(r"\s", "", old_key) in recorded and re.sub(r"\s", "", plays(r["new"])) not in recorded:
        keep[r["node"]] = old_key
    st["name"] = r["new"]
s = s[:i] + json.dumps(stops, **DUMP) + s[end:]

anchor = """    // 보정된 표시명과 같은 이름의 녹음 파일을 사용해 옛 명칭 TTS가 나오지 않게 한다.
    s.audioName=s.name;
  }
});
"""
assert s.count(anchor) == 1
old_block = re.search(r"\n// 서울시 데이터에서 이름이 바뀌었지만.*?\nSTOPS\.forEach\(s=>\{if\(STOP_AUDIO_KEEP.*?\n", s, re.S)
if old_block:
    s = s[:old_block.start()] + "\n" + s[old_block.end():]
block = ("// 서울시 데이터에서 이름이 바뀌었지만 녹음은 옛 이름으로만 있는 정류소 (node -> 녹음 이름).\n"
         "// 없는 AI 음성보다 있는 녹음이 나아서 옛 녹음을 계속 쓴다. scripts/apply-stop-names.py 가 만든다.\n"
         "const STOP_AUDIO_KEEP=" + json.dumps(keep, **DUMP) + ";\n"
         "STOPS.forEach(s=>{if(STOP_AUDIO_KEEP[s.node])s.audioName=STOP_AUDIO_KEEP[s.node];});\n")
s = s.replace(anchor, anchor + block)
open(path, "w", encoding="utf-8", newline="").write(s)
print("renamed", len(check["renamed"]), "stops; keep old recording for", len(keep))
for n, k in keep.items():
    print(" ", by_node[n]["ars"], by_node[n]["name"], "<- plays", k)

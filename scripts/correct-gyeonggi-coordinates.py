"""Repair the legacy snapshot using shared node IDs as surveyed control points.

Requires pyproj. Run once against the original, incorrectly converted snapshot.
This is an empirical correction, not a claim about the unknown source CRS.
"""
import json
import re
import statistics
from pathlib import Path
from pyproj import Transformer

root = Path(__file__).resolve().parents[1]
path = root / 'gyeonggi-data.js'
source = path.read_text(encoding='utf-8')
if 'Control-point corrected' in source:
    raise SystemExit('Snapshot already corrected')
match = re.search(r'const GYEONGGI_STOPS=(\[.*?\]);', source)
stops = json.loads(match[1])
seoul = {s['node']: s for s in json.loads(re.search(
    r'const STOPS=(\[.*?\]);', (root / 'index.html').read_text(encoding='utf-8'))[1])}
project = Transformer.from_crs(4326, 5174, always_xy=True)
unproject = Transformer.from_crs(5174, 4326, always_xy=True)
offsets = []
for node, name, lat, lng, *rest in stops:
    if node in seoul:
        x, y = project.transform(lng, lat)
        sx, sy = project.transform(seoul[node]['lng'], seoul[node]['lat'])
        offsets.append((x - sx, y - sy))
dx, dy = (statistics.median(v[i] for v in offsets) for i in (0, 1))
errors = sorted(((x-dx)**2 + (y-dy)**2)**.5 for x, y in offsets)
assert len(offsets) > 1000 and statistics.median(errors) < 10
for s in stops:
    if s[0] in seoul:
        s[2], s[3] = seoul[s[0]]['lat'], seoul[s[0]]['lng']
    else:
        x, y = project.transform(s[3], s[2])
        s[3], s[2] = unproject.transform(x-dx, y-dy)
        s[2], s[3] = round(s[2], 7), round(s[3], 7)
source = source[:match.start(1)] + json.dumps(stops, ensure_ascii=False, separators=(',', ':')) + source[match.end(1):]
source = '// Control-point corrected; see scripts/correct-gyeonggi-coordinates.py.\n' + source
path.write_text(source, encoding='utf-8')
print(f'{len(offsets)} shared nodes; offset {dx:.3f}, {dy:.3f} m; median residual {statistics.median(errors):.2f} m')

#!/usr/bin/env python3
"""손님용 전광판 제어 사이트 생성기.

원본 제어 사이트(index.html)를 복사해서
  - API를 쓰는 기능(도착정보, 실시간 버스 위치, 배차 이력, 신호등, CCTV, 돌발정보,
    길찾기, 지하철, 경기 노선(OSRM))과 API 키를 빼고
  (구글 번역은 영어 안내방송·전광판 영어 이름에 필요해서 남긴다)
  - 이용권 옵션(안내방송 / 와이파이)에 맞게 기능을 켜고 끈
app/<폴더>/index.html 을 만든다.

원본을 고친 뒤 다시 실행하면 손님용도 같이 갱신된다:
    python3 scripts/build-customer.py
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 폴더 이름은 추측하기 어렵게 무작위로 정했다. 이 주소가 곧 이용권이다.
TIERS = [
    # (폴더, 이름, 안내방송, 와이파이)
    ("ae8b783a", "기본 (USB)", False, False),
    ("edb44a61", "AI 안내방송 (USB)", True, False),
    ("43c3650e", "와이파이", False, True),
    ("2477f79e", "AI 안내방송 + 와이파이", True, True),
]

# 원본에서 이름을 바꿔 죽이고 아래 STUBS로 대체할 함수들 (전부 외부 API 호출)
API_FUNCS = [
    "fetchStopArrivals", "annotateArrivalTimes", "refreshSelectedStopArrivals",
    "startStopArrivalPolling", "fetchBusPositions", "busPosTick", "startBusPosPolling",
    "loadRouteDispatchSummary", "fetchRouteTimes", "renderOtherRegionRoutes",
    "refreshCctvLayer", "startTrafficLightPolling", "loadSubwayMeta",
]
STUBS = """
/* ---------- 손님용: API 기능 제거 (scripts/build-customer.py) ---------- */
async function fetchStopArrivals(){return [];}
function annotateArrivalTimes(){}
async function refreshSelectedStopArrivals(){}
function startStopArrivalPolling(){}
async function fetchBusPositions(){return [];}
async function busPosTick(){}
function startBusPosPolling(){}
async function loadRouteDispatchSummary(){}
async function fetchRouteTimes(){return null;}
async function renderOtherRegionRoutes(){}
async function refreshCctvLayer(){}
function startTrafficLightPolling(){}
async function loadSubwayMeta(){}
"""
NO_WIFI_FUNCS = ["ledConnectWifi", "openLedWifiAddress"]
NO_WIFI_STUBS = """
async function ledConnectWifi(){}
function openLedWifiAddress(){}
"""
NO_VOICE_FUNCS = ["announceArrival"]
NO_VOICE_STUBS = """
async function announceArrival(){}
"""

# 값을 비울 API 키·주소
SECRETS = [
    ("'https://super-mud-117e.oseungjae0417.workers.dev'", "''"),
    ("const ITS_CCTV_DEFAULT_KEY='b28e6942f09b43b986e733dd86b11583';", "const ITS_CCTV_DEFAULT_KEY='';"),
    (re.compile(r"const TRAFFIC_SERVICE_KEY='[^']*';"), "const TRAFFIC_SERVICE_KEY='';"),
    (re.compile(r"const SEOUL_TDATA_KEY='[^']*';"), "const SEOUL_TDATA_KEY='';"),
    ("window.open('https://168-110-38-243.sslip.io/','_blank','noopener')", "void 0"),
]

DROP_SCRIPTS = ["traffic-intersections.js", "gyeonggi-data.js", "planner.js", "traffic-map-patch.js",
                "utic-map-patch.js", "gyeonggi-stops-patch.js", "subway-routing.js", "subway-api.js", "subway.js"]
SHARED_SCRIPTS = ["route-shapes.js", "route-geometry.js", "mobile-patch.js", "ios-touch-patch.js"]

HIDE_CSS = """
#plannerBtn,#ttsSiteBtn,#stopArrivalAutoToggle,#busPosToggle,#busPosLowToggle,#announceMakerBtn,#driverModeBtn,
#busRefreshCountdown,#busPosStatus,#trafficWidget,#plannerPanel,#plannerDetail,#uticSettingsBlock,
.setting-block:has(#trafficLightToggle),.setting-block:has(#busPosProxyInput),.setting-block:has(#cctvToggle),
.setting-block:has(a[href="./audio-library.html"]){display:none!important}
"""
NO_VOICE_CSS = "#guideTtsBtn,.guide-speed:has(#guideVolumeSlider){display:none!important}\n"
NO_WIFI_CSS = ".guide-speed-row:has(#ledWifiHostInput),.guide-led>div.guide-led-status{display:none!important}\n"


def sub1(text, old, new, label):
    if isinstance(old, re.Pattern):
        text, n = old.subn(new, text)
    else:
        n = text.count(old)
        text = text.replace(old, new)
    if n < 1:
        sys.exit(f"원본에서 찾지 못함: {label}")
    return text


def kill_func(text, name):
    pat = re.compile(r"(\n(?:async )?function )" + name + r"\(")
    text, n = pat.subn(r"\g<1>__api_" + name + "(", text)
    if n != 1:
        sys.exit(f"함수 {name}: {n}개 발견 (1개여야 함)")
    return text


def build(slug, label, voice, wifi):
    src = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    t = src

    # 제목
    t = sub1(t, "<title>서울 버스 정류소 지도", "<title>버스 전광판 제어", "title")
    t = sub1(t, 'title="처음 화면으로">서울 버스 정류소 지도<', 'title="처음 화면으로">버스 전광판 제어<', "homeTitle")
    t = sub1(t, 'content="버스 정류소 지도"', 'content="버스 전광판 제어"', "app title")

    # 공용 파일은 저장소 루트(../../)에서 읽는다
    css = HIDE_CSS + ("" if voice else NO_VOICE_CSS) + ("" if wifi else NO_WIFI_CSS)
    head = ('<meta name="robots" content="noindex,nofollow">\n'
            f'<script>window.LED_BASE="../../";window.CUSTOMER_TIER={{voice:{str(voice).lower()},wifi:{str(wifi).lower()}}};</script>\n'
            f'<style>{css}</style>\n')
    t = sub1(t, '<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + head, "head")
    t = sub1(t, "document.write('<link rel=\"manifest\" href=\"manifest.webmanifest\">');\n", "", "manifest")
    t = sub1(t, 'href="apple-touch-icon.png"', 'href="../../apple-touch-icon.png"', "touch icon")
    t = sub1(t, 'href="icon.png"', 'href="../../icon.png"', "icon")

    # 스크립트 태그
    for name in DROP_SCRIPTS:
        t = sub1(t, re.compile(r'<script src="(?:\./)?' + re.escape(name) + r'(?:\?[^"]*)?"></script>\n?'), "", name)
    for name in SHARED_SCRIPTS:
        t = sub1(t, re.compile(r'<script src="(?:\./)?(' + re.escape(name) + r'(?:\?[^"]*)?)"></script>'),
                 r'<script src="../../\1"></script>', name)
    gap = re.compile(r'<script src="(?:\./)?gapless-patch\.js(?:\?[^"]*)?"></script>\n?')
    t = sub1(t, gap, '<script src="../gapless-customer.js?v=1"></script>\n' if voice else "", "gapless")

    # 서비스 워커(원본 사이트용) 등록 안 함
    t = sub1(t, "if('serviceWorker' in navigator && location.protocol.startsWith('http')){",
             "if(false){", "service worker")

    # API 키·주소 비우기
    for old, new in SECRETS:
        t = sub1(t, old, new, f"secret {str(old)[:30]}")

    # 기본으로 꺼 둘 것
    t = sub1(t, "let trafficLightOn=lsGet('trafficLightOn')!=='0';", "let trafficLightOn=false;", "trafficLightOn")
    t = sub1(t, "cctvOn=savedCctvSetting==null?true:savedCctvSetting==='1'", "cctvOn=false", "cctvOn")
    if not voice:
        t = sub1(t, "guideUserMarker=null, guideTtsOn=true;", "guideUserMarker=null, guideTtsOn=false;", "tts off")

    # 음성 파일 경로를 저장소 루트 기준으로
    t = sub1(t, "const AUDIO_BASE='audio/';", "const AUDIO_BASE=(window.LED_BASE||'')+'audio/';", "AUDIO_BASE")
    t = sub1(t, "decodeURIComponent(p.replace(/^audio\\//,''))", "decodeURIComponent(p.slice(AUDIO_BASE.length))",
             "manifest filter")

    # API 함수 제거
    funcs = API_FUNCS + ([] if wifi else NO_WIFI_FUNCS) + ([] if voice else NO_VOICE_FUNCS)
    for f in funcs:
        t = kill_func(t, f)
    stubs = STUBS + ("" if wifi else NO_WIFI_STUBS) + ("" if voice else NO_VOICE_STUBS)
    # 메인 스크립트 블록 끝(</script> 바로 다음이 공용/패치 스크립트)에 대체 함수 삽입
    m = re.search(r"\n</script>\n<script src=\"\.\./\.\./mobile-patch\.js", t)
    if not m:
        sys.exit("메인 스크립트 끝을 찾지 못함")
    t = t[:m.start()] + "\n" + stubs + t[m.start():]

    # 남은 비밀값 검사
    for bad in ["b28e6942", "ed4ccf31", "QZaklqvK", "super-mud-117e"]:
        if bad in t:
            sys.exit(f"비밀값이 남아 있음: {bad}")

    out = os.path.join(ROOT, "app", slug)
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(t)
    print(f"app/{slug}/  {label}")


def build_gapless():
    g = open(os.path.join(ROOT, "gapless-patch.js"), encoding="utf-8").read()
    # 녹음 파일 경로를 저장소 루트 기준으로
    g = sub1(g, ".map(name=>'audio/'+name", ".map(name=>(window.LED_BASE||'')+'audio/'+name", "gapless formats")
    g = sub1(g, "return ['audio/'+s+'.wav','audio/'+s+'.mp3','audio/'+category+'/'+s+'.wav','audio/'+category+'/'+s+'.mp3'];",
             "const B=(window.LED_BASE||'')+'audio/';return [B+s+'.wav',B+s+'.mp3',B+category+'/'+s+'.wav',B+category+'/'+s+'.mp3'];",
             "gapless fallback")
    os.makedirs(os.path.join(ROOT, "app"), exist_ok=True)
    open(os.path.join(ROOT, "app", "gapless-customer.js"), "w", encoding="utf-8").write(g)


if __name__ == "__main__":
    build_gapless()
    for tier in TIERS:
        build(*tier)

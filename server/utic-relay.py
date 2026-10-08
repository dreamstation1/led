#!/usr/bin/env python3
import json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qsl, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

KEY=os.environ['UTIC_API_KEY']
ORIGIN='https://www.utic.go.kr'
CACHE={}
ALLOWED_ORIGINS={'https://dreamstation1.github.io','http://localhost','http://127.0.0.1'}
ROUTES={
 '/utic/incidents':('/guide/imsOpenData.do',120),
 '/utic/cctv-stream':('/jsp/map/openDataCctvStream.jsp',0),
 '/utic/cctv-open':('/guide/cctvOpenData.do',60),
 '/utic/safety':('/guide/getSafeOpenJson.do',86400),
 '/utic/road-risk':('/guide/getRoadAccJson.do',1800),
 '/map/getCctvInfoById.do':('/map/getCctvInfoById.do',0),
}

def fetch(path,query,ttl):
    pairs=[(k,v) for k,v in parse_qsl(query,keep_blank_values=True) if k.lower() not in {'key','apikey','servicekey'}]
    pairs.append(('key',KEY))
    url=ORIGIN+path+'?'+urlencode(pairs)
    cache_key=url
    old=CACHE.get(cache_key)
    if ttl and old and time.time()-old[0]<ttl:return old[1:]
    req=Request(url,headers={'User-Agent':'dreamstation1-led-utic-relay/1.0','Accept':'*/*'})
    try:
      with urlopen(req,timeout=25) as res:
        body=res.read(); status=res.status; ctype=res.headers.get('Content-Type','application/octet-stream')
    except HTTPError as e:
      body=e.read(); status=e.code; ctype=e.headers.get('Content-Type','application/json')
    if ttl and status==200:CACHE[cache_key]=(time.time(),status,ctype,body)
    return status,ctype,body

class Handler(BaseHTTPRequestHandler):
  server_version='UTICRelay/1.0'
  def cors(self):
    origin=self.headers.get('Origin','')
    self.send_header('Access-Control-Allow-Origin',origin if origin in ALLOWED_ORIGINS else 'https://dreamstation1.github.io')
    self.send_header('Vary','Origin')
    self.send_header('Access-Control-Allow-Methods','GET,OPTIONS')
    self.send_header('Access-Control-Allow-Headers','Accept,Content-Type')
  def do_OPTIONS(self):
    self.send_response(204);self.cors();self.end_headers()
  def do_GET(self):
    u=urlsplit(self.path)
    if u.path=='/health':
      body=json.dumps({'ok':True,'service':'utic-relay'}).encode()
      self.send_response(200);self.send_header('Content-Type','application/json');self.cors();self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
    route=ROUTES.get(u.path)
    if not route:
      self.send_response(404);self.cors();self.end_headers();return
    try:status,ctype,body=fetch(route[0],u.query,route[1])
    except Exception as e:
      body=json.dumps({'error':'upstream_failed','message':str(e)}).encode();status=502;ctype='application/json'
    self.send_response(status);self.send_header('Content-Type',ctype);self.cors();self.send_header('Cache-Control','no-store' if not route[1] else f'public, max-age={route[1]}');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  def log_message(self,fmt,*args):
    print('%s - %s'%(self.address_string(),fmt%args),flush=True)

ThreadingHTTPServer(('127.0.0.1',8090),Handler).serve_forever()

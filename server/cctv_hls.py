#!/usr/bin/env python3
import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path('/tmp/bus-cctv-hls')
FFMPEG = '/usr/bin/ffmpeg'
IDLE_SECONDS = 90
MAX_STREAMS = 2
ALLOWED_ORIGIN = 'https://dreamstation1.github.io'
streams = {}
lock = threading.Lock()


def token_for(ch, camera_id):
    return hashlib.sha256(f'{ch}:{camera_id}'.encode()).hexdigest()[:16]


def stop_stream(token):
    info = streams.pop(token, None)
    if info:
        process = info['process']
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        shutil.rmtree(info['directory'], ignore_errors=True)


def cleanup_loop():
    while True:
        time.sleep(15)
        now = time.time()
        with lock:
            stale = [token for token, info in streams.items()
                     if now - info['last_access'] > IDLE_SECONDS or info['process'].poll() is not None]
            for token in stale:
                stop_stream(token)


def start_stream(ch, camera_id):
    token = token_for(ch, camera_id)
    with lock:
        current = streams.get(token)
        if current and current['process'].poll() is None:
            current['last_access'] = time.time()
            return token, current['directory']
        while len(streams) >= MAX_STREAMS:
            oldest = min(streams, key=lambda item: streams[item]['last_access'])
            stop_stream(oldest)
        directory = ROOT / token
        shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)
        source = f'rtmp://210.179.218.{ch}:1935/live/{camera_id}.stream'
        playlist = directory / 'index.m3u8'
        command = [
            FFMPEG, '-nostdin', '-hide_banner', '-loglevel', 'warning',
            '-rw_timeout', '10000000', '-i', source,
            '-map', '0:v:0', '-an', '-c:v', 'copy',
            '-f', 'hls', '-hls_time', '2', '-hls_list_size', '5',
            '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments',
            '-hls_segment_filename', str(directory / 'seg-%06d.ts'), str(playlist),
        ]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        streams[token] = {'process': process, 'directory': directory, 'last_access': time.time()}
    deadline = time.time() + 12
    while time.time() < deadline:
        if playlist.exists() and playlist.stat().st_size:
            return token, directory
        if process.poll() is not None:
            break
        time.sleep(.25)
    with lock:
        stop_stream(token)
    raise RuntimeError('CCTV 원본 스트림에 연결하지 못했습니다')


class Handler(BaseHTTPRequestHandler):
    server_version = 'BusCctvHls/1.0'

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
        self.send_header('Vary', 'Origin')

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.cors()
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.end_headers()

    def do_GET(self):
        request = urlsplit(self.path)
        if request.path == '/health':
            self.send_json(200, {'ok': True, 'streams': len(streams)})
            return
        if request.path == '/start':
            query = parse_qs(request.query)
            ch = query.get('ch', [''])[0]
            camera_id = query.get('id', [''])[0]
            if not ch.isdigit() or not camera_id.isdigit() or not 1 <= int(ch) <= 254:
                self.send_json(400, {'error': 'invalid_camera'})
                return
            try:
                token, _ = start_stream(ch, camera_id)
                self.send_json(200, {'playlist': f'/cctv/hls/{token}/index.m3u8'})
            except Exception as error:
                self.send_json(502, {'error': 'stream_failed', 'message': str(error)})
            return
        prefix = '/hls/'
        if request.path.startswith(prefix):
            parts = request.path[len(prefix):].split('/')
            if len(parts) != 2 or not all(parts):
                self.send_error(404)
                return
            token, filename = parts
            if filename != 'index.m3u8' and not (filename.startswith('seg-') and filename.endswith('.ts')):
                self.send_error(404)
                return
            with lock:
                info = streams.get(token)
                if info:
                    info['last_access'] = time.time()
            if not info:
                self.send_error(404)
                return
            path = info['directory'] / filename
            if not path.exists():
                self.send_error(404)
                return
            body = path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/vnd.apple.mpegurl' if filename.endswith('.m3u8') else 'video/mp2t')
            self.send_header('Cache-Control', 'no-store')
            self.cors()
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        print(f'{self.address_string()} - {fmt % args}', flush=True)


ROOT.mkdir(parents=True, exist_ok=True)
threading.Thread(target=cleanup_loop, daemon=True).start()
ThreadingHTTPServer(('127.0.0.1', 9881), Handler).serve_forever()

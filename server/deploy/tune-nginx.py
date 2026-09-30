#!/usr/bin/env python3
"""给 zuoyexiang 站点补上 gzip / HTTP2 / 分层缓存（幂等，可重复执行）。"""
import re, sys, pathlib

path = pathlib.Path('/etc/nginx/sites-available/zuoyexiang')
src = path.read_text(encoding='utf-8')
orig = src

GZIP = '''    # nginx 默认只压 text/html；JS/CSS/JSON 也要压上
    gzip on;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss image/svg+xml;

'''
if 'gzip_types' not in src:
    src = src.replace('    root /opt/zuoyexiang/dist;', GZIP + '    root /opt/zuoyexiang/dist;', 1)

if not re.search(r'^\s*http2 on;', src, re.M):
    src = re.sub(r'(\n\s*listen 443 ssl;)', r'\n    http2 on;\1', src, count=1)

OLD = re.compile(r'    location ~\* \\\.\(mp4\|ttf\|woff2\?\|png\|jpg\|jpeg\|svg\|css\|js\)\$\s*\{[^}]*\}\n', re.S)
NEW = '''    # 带内容指纹的构建产物：一年不可变
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # 素材（视频/字体/图片）：7 天
    location /input-assets/ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri =404;
    }
'''
if 'location /input-assets/' not in src:
    src, n = OLD.subn(NEW, src)
    if n == 0:
        print('警告：未找到旧的静态 location 块', file=sys.stderr)

if src != orig:
    path.write_text(src, encoding='utf-8')
    print('已更新 nginx 配置')
else:
    print('无需修改')

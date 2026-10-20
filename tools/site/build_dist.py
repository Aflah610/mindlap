"""Copies only the public website into dist/ for Cloudflare Pages.

    python tools/site/build_dist.py

Everything else (worker/, tools/, docs/, README) stays private.
Only files tracked by git are published, so local scratch files never leak.
"""
import os
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DIST = os.path.join(ROOT, 'dist')

PUBLIC_DIRS = ('assets/', 'book/', 'account/', 'services/', 'online-counselling-kerala/')
PUBLIC_FILES = ('index.css', 'index.js', 'pages.css', 'manifest.json', 'favicon.ico', 'robots.txt', 'sitemap.xml')

HEADERS = """/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=2592000

/*.css
  Cache-Control: public, max-age=31536000, immutable

/*.js
  Cache-Control: public, max-age=31536000, immutable
"""

# Cloudflare Pages already serves /rashin for rashin.html and redirects
# /rashin.html -> /rashin. These cover a few old addresses explicitly.
REDIRECTS = """/index.html  /  301
"""


def public(path):
    if path.startswith(PUBLIC_DIRS) or path in PUBLIC_FILES:
        return True
    return '/' not in path and path.endswith('.html')


def main():
    files = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split('\n')
    files = [f for f in files if f and public(f) and os.path.exists(os.path.join(ROOT, f))]
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    for f in files:
        dest = os.path.join(DIST, f)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(ROOT, f), dest)
    with open(os.path.join(DIST, '_headers'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(HEADERS)
    with open(os.path.join(DIST, '_redirects'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(REDIRECTS)
    print(f'dist/: {len(files)} files')


if __name__ == '__main__':
    main()

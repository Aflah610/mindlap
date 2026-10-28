"""Rewrites links to clean URLs: /rashin.html -> /rashin, index.html#x -> /#x.
The host (GitHub Pages) serves /rashin from rashin.html, so the files stay as they are.
Safe to run more than once."""
import glob
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)

PAGES = ['rashin', 'theresa', 'christine', 'jasmin', 'fathima', 'privacy', 'terms']
NAMES = '|'.join(PAGES)

files = [f for f in glob.glob('**/*.html', recursive=True) + glob.glob('**/*.xml', recursive=True)
         + ['index.js']
         if 'node_modules' not in f and 'worker' not in f.split(os.sep)[0] and not f.endswith('clean_urls.py')]

for f in files:
    s = open(f, encoding='utf-8').read()
    t = s
    # Full URLs (canonical, og:url, schema, sitemap)
    t = re.sub(r'https://mindlap\.in/(%s)\.html' % NAMES, r'https://mindlap.in/\1', t)
    t = t.replace('https://mindlap.in/index.html', 'https://mindlap.in/')
    # Root-relative and relative links
    t = re.sub(r'(["\'(=])/?(%s)\.html(?=[#"\'?)])' % NAMES, r'\1/\2', t)
    t = re.sub(r'(["\'(=])/?index\.html#', r'\1/#', t)
    t = re.sub(r'(["\'(=])/?index\.html(?=["\'])', r'\1/', t)
    # Python builders that format f"/{slug}.html" or '/'+path
    t = t.replace('/{t[\'slug\']}.html', '/{t[\'slug\']}').replace("f'/{n}.html'", "f'/{n}'")
    if t != s:
        open(f, 'w', encoding='utf-8', newline='').write(t)
        print('cleaned', f)

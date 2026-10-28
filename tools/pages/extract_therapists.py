"""One-off: pull the psychologist details out of the old profile pages into
therapists.json (the new profiles are generated from that file)."""
import html
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SLUGS = ['rashin', 'theresa', 'christine', 'jasmin', 'fathima']


def text(fragment):
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', fragment))).strip()


def one(pattern, s, flags=re.S):
    m = re.search(pattern, s, flags)
    return m.group(1) if m else ''


out = []
for slug in SLUGS:
    s = open(os.path.join(ROOT, slug + '.html'), encoding='utf-8').read()
    focus = re.findall(r'<div class="profile-focus-details">\s*<strong>(.*?)</strong>\s*<span>(.*?)</span>', s, re.S)
    approach = re.findall(r'<div class="profile-style-item">\s*<strong>(.*?)</strong>\s*<p>(.*?)</p>', s, re.S)
    quals = re.findall(r'<p[^>]*>(.*?)</p>', one(r'<div class="profile-bg-text">(.*?)</div>', s), re.S)
    out.append({
        'slug': slug,
        'name': text(one(r'<h1>(.*?)</h1>', s)),
        'role': text(one(r'<span class="profile-hero-role">(.*?)</span>', s)),
        'education': text(one(r'<p class="profile-hero-edu">(.*?)</p>', s)),
        'methods': [text(t) for t in re.findall(r'<span class="profile-hero-tag">(.*?)</span>', s, re.S)],
        'photo': one(r'src="(assets/[^"]+)"[^>]*class="profile-hero-img"', s).split('?')[0],
        'focus': [[text(a), text(b)] for a, b in focus],
        'approach': [[text(a), text(b)] for a, b in approach],
        'qualifications': [text(q) for q in quals],
        'languages': ['Malayalam'],
        'fee': '₹1,000',
    })

with open(os.path.join(os.path.dirname(__file__), 'therapists.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
for t in out:
    print(t['name'], '|', len(t['focus']), 'focus |', t['methods'], '|', t['photo'])

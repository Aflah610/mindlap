"""Builds the service pages, the services hub and the Kerala landing page.

    python tools/pages/build.py

Text lives in content.py. The site header/footer are taken from privacy.html,
so they always match the rest of the site.
"""
import html
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.dirname(__file__))
from content import SERVICES, HUB_LIST, WHY  # noqa: E402

SITE = 'https://mindlap.in'
WA = 'https://wa.me/917594000774?text='
PHONE_TEL = '+917594000774'
PHONE_SHOW = '+91 75940 00774'
BY_SLUG = {s['slug']: s for s in SERVICES}

e = html.escape


def wa(text):
    from urllib.parse import quote
    return WA + quote(text)


def read(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def write(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def absolute(fragment):
    """Root-relative links so the shell works from /services/x/ too."""
    fragment = re.sub(r'(href|src)="index\.html', r'\1="/', fragment)
    fragment = re.sub(r'(href|src)="(assets/|manifest\.json|index\.js|index\.css)', r'\1="/\2', fragment)
    fragment = re.sub(r'href="/?([a-z]+)\.html', r'href="/\1', fragment)  # clean URLs: /privacy
    return fragment


def shell():
    src = read('privacy.html')
    nav_start = src.index('<!-- Header / Navbar -->')
    nav_end = src.index('</header>', nav_start) + len('</header>')
    foot_start = src.index('<!-- Footer Section -->')
    foot_end = src.index('</body>')
    css_v = re.search(r'index\.css\?v=(\d+)', src).group(1)
    nav = absolute(src[nav_start:nav_end])
    nav = nav.replace('<a href="/services/" class="nav-link">', '<a href="/services/" class="nav-link active">')
    return nav, absolute(src[foot_start:foot_end]), css_v


NAV, FOOT, CSS_V = shell()


def page(path, title, desc, body, schema):
    url = SITE + '/' + path.replace('index.html', '')
    if url.endswith('.html'):
        url = url[:-5]  # clean URLs: /rashin, not /rashin.html
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{e(title)}</title>
    <meta name="description" content="{e(desc)}">
    <link rel="canonical" href="{url}">
    <link rel="icon" type="image/webp" href="/assets/favicon.webp">
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.json">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{url}">
    <meta property="og:title" content="{e(title)}">
    <meta property="og:description" content="{e(desc)}">
    <meta property="og:image" content="{SITE}/assets/logo.webp">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/index.css?v={CSS_V}">
    <link rel="stylesheet" href="/pages.css?v=5">
    <script type="application/ld+json">{json.dumps(schema, ensure_ascii=False)}</script>
</head>
<body class="sv-page">
    {NAV}

{body}

    {FOOT}</body>
</html>
'''


def crumbs(items):
    parts = []
    for name, href in items:
        parts.append(f'<a href="{href}">{e(name)}</a>' if href else f'<span aria-current="page">{e(name)}</span>')
    return '<nav class="sv-crumbs" aria-label="Breadcrumb">' + '<span class="sv-sep">/</span>'.join(parts) + '</nav>'


def crumb_schema(items):
    return {
        '@type': 'BreadcrumbList',
        'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': SITE + (h or '')}
            for i, (n, h) in enumerate(items)
        ],
    }


def wa_button(label, message, cls='sv-btn'):
    return (f'<a class="{cls}" href="{e(wa(message))}" target="_blank" rel="noopener">{e(label)}'
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>')


def aside(service_name):
    msg = f'Hello Mindlap, I would like to book {service_name}.'
    return f'''<aside class="sv-aside">
            <div class="sv-aside-card">
                <p class="sv-aside-kicker">Book a session</p>
                <p class="sv-aside-text">Message our coordinator. Tell us a little about what you are looking for and we will suggest a psychologist and a time that suits you.</p>
                {wa_button('Chat on WhatsApp', msg, 'sv-btn sv-btn-block')}
                <a class="sv-aside-call" href="tel:{PHONE_TEL}">or call {PHONE_SHOW}</a>
                <ul class="sv-aside-facts">
                    <li>Online video sessions</li>
                    <li>In Malayalam</li>
                    <li>From anywhere, Kerala or abroad</li>
                </ul>
            </div>
        </aside>'''


def section_html(heading, paras, items):
    out = []
    if heading:
        out.append(f'<h2>{e(heading)}</h2>')
    for p in paras:
        out.append(f'<p>{e(p)}</p>')
    if items:
        out.append('<ul class="sv-list">' + ''.join(f'<li>{e(i)}</li>' for i in items) + '</ul>')
    return '\n                '.join(out)


def faqs_html(faqs):
    rows = ''.join(
        f'<details class="sv-faq"><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in faqs)
    return f'<h2>Frequently Asked Questions</h2>\n                <div class="sv-faqs">{rows}</div>'


def close_band(heading, paras, label, message):
    ps = ''.join(f'<p>{e(p)}</p>' for p in paras)
    return f'''<section class="sv-close">
        <div class="sv-wrap sv-close-inner">
            <div>
                <h2>{e(heading)}</h2>
                {ps}
            </div>
            {wa_button(label, message, 'sv-btn sv-btn-light')}
        </div>
    </section>'''


def related(current_slug):
    seen, links = set(), []
    for name, slug, _ in HUB_LIST:
        if slug == current_slug or slug in seen:
            continue
        seen.add(slug)
        links.append(f'<li><a href="/services/{slug}/">{e(BY_SLUG[slug]["title"])}</a></li>')
    return f'''<section class="sv-related">
        <div class="sv-wrap">
            <h2>Other ways we can help</h2>
            <ul>{''.join(links)}</ul>
        </div>
    </section>'''


def build_service(s):
    path = f'services/{s["slug"]}/index.html'
    items = [('Home', '/'), ('Services', '/services/'), (s['short'], None)]
    sections = '\n                '.join(section_html(*sec) for sec in s['sections'])
    intro = ''.join(f'<p>{e(p)}</p>' for p in s['intro'])
    body = f'''    <main>
    <header class="sv-head">
        <div class="sv-wrap">
            {crumbs(items)}
            <h1>{e(s['title'])}</h1>
            <p class="sv-lead">{e(s['lead'])}</p>
        </div>
    </header>

    <div class="sv-wrap sv-body">
        <article class="sv-article">
                {intro}
                {sections}
                {faqs_html(s['faqs'])}
        </article>
        {aside(s['short'])}
    </div>

    {close_band(s['close'][0], s['close'][1], s['close'][2], f"Hello Mindlap, I would like to book {s['short']}.")}

    {related(s['slug'])}
    </main>'''
    schema = {
        '@context': 'https://schema.org',
        '@graph': [
            crumb_schema([(n, h or f'/services/{s["slug"]}/') for n, h in items]),
            {'@type': 'FAQPage', 'mainEntity': [
                {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in s['faqs']]},
            {'@type': 'Service', 'name': s['title'], 'serviceType': s['short'], 'areaServed': ['Kerala', 'India', 'Worldwide'],
             'availableLanguage': ['Malayalam', 'English'], 'provider': {'@type': 'Organization', 'name': 'MindLap', 'url': SITE}},
        ],
    }
    write(path, page(path, f'{s["title"]} | MindLap', s['meta'], body, schema))
    return path


def why_html():
    cols = ''.join(f'<div><h3>{e(t)}</h3><p>{e(d)}</p></div>' for t, d in WHY)
    return f'<div class="sv-why">{cols}</div>'


def build_hub():
    path = 'services/index.html'
    items = [('Home', '/'), ('Services', None)]
    rows = ''.join(
        f'''<li><a href="/services/{slug}/">
                <span class="sv-num">{i + 1:02d}</span>
                <span class="sv-row-text"><span class="sv-row-title">{e(name)}</span><span class="sv-row-desc">{e(desc)}</span></span>
                <span class="sv-row-go">Learn more</span>
            </a></li>''' for i, (name, slug, desc) in enumerate(HUB_LIST))
    body = f'''    <main>
    <header class="sv-head">
        <div class="sv-wrap">
            {crumbs(items)}
            <h1>Mental Health &amp; Psychological Services for Malayalees</h1>
            <p class="sv-lead">Professional psychological support, made more accessible, affordable and comfortable for Malayalees.</p>
        </div>
    </header>

    <div class="sv-wrap sv-body">
        <article class="sv-article">
                <p>Life can sometimes feel difficult to manage. You may be experiencing anxiety, stress, depression, relationship problems, emotional struggles, or difficult past experiences. Sometimes, you may simply feel overwhelmed and not know where to start.</p>
                <p>Our online psychological consultation services provide a confidential and comfortable space where you can talk about what you are going through and receive professional support.</p>
                <p>Whether you are in Kerala, another part of India, or living abroad, MindLap makes online mental health support more accessible to Malayalees.</p>
        </article>
        {aside('a consultation')}
    </div>

    <section class="sv-services">
        <div class="sv-wrap">
            <h2>Our Services</h2>
            <ol class="sv-rows">{rows}</ol>
        </div>
    </section>

    <section class="sv-band-plain">
        <div class="sv-wrap">
            <h2>Why choose MindLap?</h2>
            {why_html()}
        </div>
    </section>

    <section class="sv-wrap sv-prose">
        <h2>Psychological Support for Malayalees, Wherever You Are</h2>
        <p>You may be living in Kerala, another part of India, or outside the country. You may be a student, working professional, parent, or someone simply trying to understand what you are feeling.</p>
        <p>Mental health support should be accessible wherever you are. MindLap is committed to making online psychological consultation and mental health support more accessible to Malayalees.</p>
    </section>

    {close_band('Need Support?', ['You do not have to wait until things become overwhelming before seeking support.', 'If something is affecting your thoughts, emotions, relationships, or everyday life, talking to a professional can be a positive step.'], 'Book an online consultation', 'Hello Mindlap, I would like to book an online psychological consultation.')}
    </main>'''
    schema = {'@context': 'https://schema.org', '@graph': [
        crumb_schema([('Home', '/'), ('Services', '/services/')]),
        {'@type': 'ItemList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': n, 'url': f'{SITE}/services/{slug}/'} for i, (n, slug, _) in enumerate(HUB_LIST)]},
    ]}
    write(path, page(path, 'Mental Health & Psychological Services for Malayalees | MindLap',
                     'Online counselling and therapy in Malayalam: anxiety, depression, stress, relationships, couple therapy, trauma, ADHD and panic attacks. Confidential support from MindLap.',
                     body, schema))
    return path


def build_kerala():
    path = 'online-counselling-kerala/index.html'
    items = [('Home', '/'), ('Online Counselling in Kerala', None)]
    support = [('Anxiety and stress', 'anxiety-counselling-malayalam'), ('Depression', 'depression-therapy-malayalam'),
               ('Individual therapy', 'individual-therapy-malayalam'), ('Relationship difficulties', 'relationship-counselling-malayalam'),
               ('Couple concerns', 'couple-therapy-malayalam'), ('Childhood trauma', 'trauma-counselling-malayalam'),
               ('Emotional well-being', 'emotional-support-malayalam'), ('ADHD-related concerns', 'adhd-consultation-malayalam'),
               ('Panic attacks', 'panic-attack-counselling-malayalam'), ('Personal and emotional challenges', 'online-psychological-consultation-malayalam')]
    links = ''.join(f'<li><a href="/services/{s}/">{e(n)}</a></li>' for n, s in support)
    steps = [('Contact MindLap', 'Reach out to our team and let us know that you are interested in an online counselling session.'),
             ('Share your requirements', 'Tell our coordinator about the type of support you are looking for and your preferred consultation details.'),
             ('Schedule your consultation', 'The MindLap team will help you with the available consultation options and suitable timing.'),
             ('Attend your online session', 'Once your consultation is scheduled, attend the session online from a suitable private space.')]
    step_html = ''.join(f'<li><span class="sv-step-n">{i + 1}</span><div><h3>{e(t)}</h3><p>{e(d)}</p></div></li>' for i, (t, d) in enumerate(steps))
    faqs = [('Is online counselling available in Malayalam?', 'Yes. MindLap provides online counselling in Malayalam, subject to professional and service availability.'),
            ('What if I am not sure which service I need?', 'You can contact our team and discuss your requirements. Our coordinator can help you with the next steps.'),
            ('Can I attend from outside Kerala?', 'Yes. Whether you live in Kerala, another part of India, or abroad, online counselling can make professional support easier to access.')]
    body = f'''    <main>
    <header class="sv-head">
        <div class="sv-wrap">
            {crumbs(items)}
            <h1>Online Counselling in Kerala</h1>
            <p class="sv-lead">Looking for professional psychological support from the comfort of your home?</p>
        </div>
    </header>

    <div class="sv-wrap sv-body">
        <article class="sv-article">
                <p>MindLap provides <strong>online counselling in Kerala</strong> for individuals looking for professional support with anxiety, stress, depression, relationships, emotional well-being, trauma, ADHD, and other personal concerns. Our online consultations are designed to make psychological support more accessible, comfortable, and convenient for Malayalees.</p>
                <h2>Book an Online Counselling Session</h2>
                <p>Taking the first step towards your mental well-being does not have to be difficult. Whether you are dealing with a specific concern or simply feel that you need someone to talk to, you can reach out to the MindLap team.</p>
                <p>Tell us what kind of support you are looking for, and our coordinator can help you with the next steps and consultation details.</p>
                <h2>Online Counselling in Malayalam</h2>
                <p>For many Malayalees, talking about personal and emotional concerns in Malayalam feels more natural and comfortable. MindLap provides <strong>online counselling in Malayalam</strong> so you can express your thoughts, feelings, and experiences in a language you are comfortable with, subject to professional and service availability.</p>
                <h2>What Can You Seek Support For?</h2>
                <ul class="sv-list sv-list-links">{links}</ul>
                <p>If you are unsure which service is right for you, you can contact our team and discuss your requirements.</p>
        </article>
        {aside('an online counselling session')}
    </div>

    <section class="sv-band-plain">
        <div class="sv-wrap">
            <h2>How does online counselling work?</h2>
            <ol class="sv-steps">{step_html}</ol>
        </div>
    </section>

    <section class="sv-wrap sv-prose">
        <h2>Why choose MindLap?</h2>
        {why_html()}
        <h2>Online Counselling for Malayalees</h2>
        <p>Whether you live in Kerala, another part of India, or abroad, online counselling can make professional support easier to access. For Malayalees who prefer communicating in Malayalam, MindLap aims to provide a comfortable language environment for discussing personal and emotional concerns.</p>
        {faqs_html(faqs)}
    </section>

    {close_band('Book Your Consultation', ['You do not need to wait until everything feels overwhelming before asking for support.', 'If something has been affecting your thoughts, emotions, relationships, or everyday life, taking the first step can make a difference.'], 'Book an online counselling session', 'Hello Mindlap, I would like to book an online counselling session.')}
    </main>'''
    schema = {'@context': 'https://schema.org', '@graph': [
        crumb_schema([('Home', '/'), ('Online Counselling in Kerala', '/online-counselling-kerala/')]),
        {'@type': 'FAQPage', 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faqs]},
    ]}
    write(path, page(path, 'Online Counselling in Kerala, in Malayalam | MindLap',
                     'Online counselling in Kerala and in Malayalam for anxiety, stress, depression, relationships, trauma and ADHD. Talk to a psychologist from home. Book with MindLap.',
                     body, schema))
    return path


def build_sitemap(paths):
    today = '2026-10-21'
    urls = ['/', '/privacy', '/terms'] + ['/' + p.replace('index.html', '') for p in paths]
    urls += [f'/{n}' for n in ('rashin', 'anasooya', 'theresa', 'christine', 'jasmin', 'fathima')]
    rows = ''.join(
        f'''  <url>
    <loc>{SITE}{u}</loc>
    <lastmod>{today}</lastmod>
    <priority>{'1.0' if u == '/' else '0.8' if 'services' in u or 'kerala' in u else '0.5'}</priority>
  </url>
''' for u in urls)
    write('sitemap.xml', f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{rows}</urlset>\n')


def build_404():
    path = '404.html'
    links = ''.join(f'<li><a href="{h}">{e(n)}</a></li>' for n, h in [
        ('Home', '/'), ('Our psychologists', '/#therapists'), ('All services', '/services/'),
        ('Online counselling in Kerala', '/online-counselling-kerala/')])
    body = f'''    <main>
    <header class="sv-head">
        <div class="sv-wrap">
            <h1>We couldn't find that page</h1>
            <p class="sv-lead">The link may be old or mistyped. These might help:</p>
        </div>
    </header>
    <section class="sv-related">
        <div class="sv-wrap"><ul>{links}</ul></div>
    </section>
    </main>'''
    out = page(path, 'Page not found | MindLap', 'This page could not be found.', body, {'@context': 'https://schema.org', '@type': 'WebPage', 'name': 'Page not found'})
    out = out.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n    <meta name="viewport"', 1)
    out = out.replace('class="nav-link active">Services', 'class="nav-link">Services')
    write(path, out)


if __name__ == '__main__':
    built = [build_hub(), build_kerala()] + [build_service(s) for s in SERVICES]
    build_sitemap(built)
    build_404()
    for p in built:
        print('built', p)

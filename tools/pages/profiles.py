"""Builds the psychologist profile pages (/rashin.html etc.) from therapists.json.

    python tools/pages/profiles.py
"""
import json
import os

import build as b
from build import e

HERE = os.path.dirname(__file__)
PEOPLE = json.load(open(os.path.join(HERE, 'therapists.json'), encoding='utf-8'))

METHODS = {
    'CBT': 'Cognitive Behavioural Therapy',
    'DBT': 'Dialectical Behaviour Therapy',
    'ACT': 'Acceptance and Commitment Therapy',
    'SFBT': 'Solution-Focused Brief Therapy',
    'ERP': 'Exposure and Response Prevention',
    'JPMR': "Jacobson's Progressive Muscle Relaxation",
    'MBCT': 'Mindfulness-Based Cognitive Therapy',
    'EMDR': 'Eye Movement Desensitisation and Reprocessing',
    'Narrative Therapy': 'Narrative Therapy',
}

# Focus area -> matching service page (first keyword that matches wins)
SERVICE_MATCH = [
    ('couple', 'couple-therapy-malayalam'), ('marital', 'relationship-counselling-malayalam'),
    ('relationship', 'relationship-counselling-malayalam'), ('trauma', 'trauma-counselling-malayalam'),
    ('ptsd', 'trauma-counselling-malayalam'), ('anxiety', 'anxiety-counselling-malayalam'),
    ('depression', 'depression-therapy-malayalam'), ('mood', 'depression-therapy-malayalam'),
    ('adhd', 'adhd-consultation-malayalam'), ('stress', 'stress-counselling-malayalam'),
    ('emotional', 'emotional-support-malayalam'), ('anger', 'emotional-support-malayalam'),
    ('mindfulness', 'emotional-support-malayalam'), ('self-awareness', 'emotional-support-malayalam'),
]


def service_for(area):
    low = area.lower()
    for key, slug in SERVICE_MATCH:
        if key in low:
            return slug
    return None


def first_name(t):
    return t['name'].split()[0]


def joined(items):
    items = list(items)
    return items[0] if len(items) == 1 else ', '.join(items[:-1]) + ' and ' + items[-1]


def about(t):
    first = first_name(t)
    areas = joined(a.lower() if a.lower() not in ('ocd', 'adhd', 'ptsd') else a for a, _ in t['focus'][:4])
    methods = joined(t['methods'])
    return [
        f"{t['name']} is a {t['role'].lower()} at MindLap, offering online counselling and therapy in Malayalam. "
        f"Sessions with {first} focus on {areas}.",
        f"{first} works with evidence-based methods including {methods}. Sessions are held online over video, "
        f"so clients across Kerala, from Kozhikode and Malappuram to Kochi and Thiruvananthapuram, and Malayalees "
        f"living in other parts of India or abroad can attend from home.",
    ]


def faqs(t):
    first = first_name(t)
    return [
        (f'Does {first} offer counselling in Malayalam?',
         f'Yes. Sessions with {first} are held in Malayalam, online, so you can attend from anywhere.'),
        (f'How do I book a session with {first}?',
         f'Message MindLap on WhatsApp or call {b.PHONE_SHOW}. Our coordinator will share available times with {first} and confirm your session.'),
        (f'How much does a session with {first} cost?',
         f"A session costs {t['fee']}. Ask our coordinator about session packages if you plan to continue therapy."),
        ('Can I attend if I live outside Kerala?',
         'Yes. Sessions are online, so Malayalees living elsewhere in India or abroad can attend, subject to availability.'),
    ]


def others(current):
    cards = []
    for t in PEOPLE:
        if t['slug'] == current:
            continue
        cards.append(f'''<li><a href="/{t['slug']}.html">
                    <img src="/assets/{t['slug']}-card.webp" alt="" width="56" height="56" loading="lazy">
                    <span><strong>{e(t['name'])}</strong><small>{e(t['role'])}</small></span>
                </a></li>''')
    return f'''<section class="sv-related pf-others">
        <div class="sv-wrap">
            <h2>Other psychologists at MindLap</h2>
            <ul>{''.join(cards)}</ul>
        </div>
    </section>'''


def build_profile(t):
    first = first_name(t)
    path = f"{t['slug']}.html"
    msg = f"Hello Mindlap, I would like to book a therapy session with {t['name']}."
    items = [('Home', '/'), ('Psychologists', '/#therapists'), (t['name'], None)]

    focus_rows = ''
    for area, desc in t['focus']:
        slug = service_for(area)
        title = f'<a href="/services/{slug}/">{e(area)}</a>' if slug else e(area)
        focus_rows += f'<div class="pf-row"><dt>{title}</dt><dd>{e(desc)}</dd></div>'

    approach_rows = ''.join(f'<div class="pf-row"><dt>{e(a)}</dt><dd>{e(d)}</dd></div>' for a, d in t['approach'])
    method_items = ''.join(
        f'<li><strong>{e(m)}</strong>' + (f' <span>{e(METHODS[m])}</span>' if METHODS.get(m, m) != m else '') + '</li>'
        for m in t['methods'])
    quals = ''.join(f'<p>{e(q)}</p>' for q in t['qualifications'])
    q_and_a = faqs(t)

    body = f'''    <main>
    <header class="sv-head pf-head">
        <div class="sv-wrap">
            {b.crumbs(items)}
            <div class="pf-intro">
                <img class="pf-photo" src="/{t['photo']}" alt="{e(t['name'])}, {e(t['role'])} at MindLap" width="260" height="260">
                <div class="pf-intro-text">
                    <p class="pf-role">{e(t['role'])}</p>
                    <h1>{e(t['name'])}</h1>
                    <p class="pf-edu">{e(t['education'])}</p>
                    <ul class="pf-meta">
                        <li>Online sessions</li>
                        <li>{e(', '.join(t['languages']))}</li>
                        <li>{e(t['fee'])} per session</li>
                    </ul>
                    <div class="pf-actions">
                        {b.wa_button(f'Book a session with {first}', msg)}
                        <a class="pf-call" href="tel:{b.PHONE_TEL}">Call {b.PHONE_SHOW}</a>
                    </div>
                </div>
            </div>
        </div>
    </header>

    <div class="sv-wrap pf-body">
        <article class="sv-article">
                {''.join(f'<p>{e(p)}</p>' for p in about(t))}

                <h2>What {e(first)} helps with</h2>
                <dl class="pf-list">{focus_rows}</dl>

                <h2>How {e(first)} works</h2>
                <dl class="pf-list">{approach_rows}</dl>
                <ul class="pf-methods">{method_items}</ul>

                <h2>Qualifications</h2>
                <div class="pf-quals">{quals}</div>

                {b.faqs_html(q_and_a)}
        </article>
    </div>

    {b.close_band(f'Talk to {first}', [f'Tell our coordinator a little about what you are looking for, and we will find a time that suits you for an online session with {first}.'], f'Book with {first}', msg)}

    {others(t['slug'])}
    </main>'''

    url = f"{b.SITE}/{path}"
    schema = {'@context': 'https://schema.org', '@graph': [
        b.crumb_schema([('Home', '/'), ('Psychologists', '/#therapists'), (t['name'], '/' + path)]),
        {'@type': 'Person', '@id': url + '#person', 'name': t['name'], 'jobTitle': t['role'], 'url': url,
         'image': f"{b.SITE}/{t['photo']}", 'knowsLanguage': t['languages'],
         'knowsAbout': [a for a, _ in t['focus']] + [METHODS.get(m, m) for m in t['methods']],
         'hasCredential': t['education'],
         'worksFor': {'@id': f'{b.SITE}/#medicalbusiness', '@type': 'MedicalBusiness', 'name': 'MindLap counselling'}},
        {'@type': 'FAQPage', 'mainEntity': [
            {'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in q_and_a]},
    ]}
    top = joined(a for a, _ in t['focus'][:3])
    title = f"{t['name']}, {t['role']} | Online Counselling in Malayalam | MindLap"
    desc = (f"{t['name']} is a {t['role'].lower()} at MindLap offering online counselling in Malayalam for {top.lower()}. "
            f"{t['education']}. Book an online session from Kerala or abroad.")
    html_out = b.page(path, title, desc, body, schema)
    html_out = html_out.replace('class="nav-link active">Services', 'class="nav-link">Services')
    html_out = html_out.replace('<body class="sv-page">', '<body class="sv-page pf-page">')
    b.write(path, html_out)
    return path


if __name__ == '__main__':
    for person in PEOPLE:
        print('built', build_profile(person))

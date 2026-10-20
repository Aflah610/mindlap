"""One-off edits to the existing pages: Services in the menu, footer links,
View profile on therapist cards, home 'How we can help', new privacy text.
Safe to run more than once."""
import glob
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
os.chdir(ROOT)

FOOTER_SERVICES = '''<h4>Services</h4>
                <ul class="footer-links">
                    <li><a href="/services/individual-therapy-malayalam/">Individual Therapy</a></li>
                    <li><a href="/services/couple-therapy-malayalam/">Couple Therapy</a></li>
                    <li><a href="/services/anxiety-counselling-malayalam/">Anxiety Counselling</a></li>
                    <li><a href="/services/depression-therapy-malayalam/">Depression Counselling</a></li>
                    <li><a href="/services/trauma-counselling-malayalam/">Trauma Counselling</a></li>
                    <li><a href="/services/">All services</a></li>
                </ul>'''

FOOTER_COMPANY = '''<h4>Company</h4>
                <ul class="footer-links">
                    <li><a href="/#therapists">Our psychologists</a></li>
                    <li><a href="/online-counselling-kerala/">Online counselling in Kerala</a></li>
                    <li><a href="/#contact">Contact us</a></li>
                </ul>'''

PROFILES = {
    'Rashin PK': '/rashin', 'Anasooya Pramod': '/anasooya', 'Theresa P Thomas': '/theresa',
    'Christine': '/christine', 'Jasmin': '/jasmin', 'Fathima Sidhyc': '/fathima',
}

for path in sorted(glob.glob('*.html')):
    s = open(path, encoding='utf-8').read()
    before = s
    # Menu: Services after Therapists
    if '/services/" class="nav-link' not in s:
        s = re.sub(r'(<a href="(?:index\.html)?#therapists" class="nav-link[^"]*">Therapists</a>)',
                   r'\1\n                <a href="/services/" class="nav-link">Services</a>', s, count=1)
    # Footer columns
    s = re.sub(r'<h4>Services</h4>\s*<ul class="footer-links">.*?</ul>', FOOTER_SERVICES, s, count=1, flags=re.S)
    s = re.sub(r'<h4>Company</h4>\s*<ul class="footer-links">.*?</ul>', FOOTER_COMPANY, s, count=1, flags=re.S)
    if s != before:
        open(path, 'w', encoding='utf-8', newline='').write(s)
        print('menu/footer:', path)

# ---- Home: View profile + How we can help ----
s = open('index.html', encoding='utf-8').read()
for name, href in PROFILES.items():
    m = re.search(r'<h3 class="tc-name">' + re.escape(name) + r'</h3>', s)
    if not m:
        print('card not found:', name)
        continue
    btn = re.compile(r'(<a href="[^"]+"(?: target="_blank")? class="btn btn-primary tc-view-btn">[^<]+</a>)')
    b = btn.search(s, m.end())
    if b and 'tc-actions' not in s[m.end():b.start()][-200:]:
        s = s[:b.start()] + ('<div class="tc-actions">\n                            <a href="%s" class="btn tc-profile-btn">View profile</a>\n                            %s\n                        </div>'
                             % (href, b.group(1))) + s[b.end():]

HELP = '''    <!-- How we can help (links to the service pages) -->
    <section class="help-section" id="help">
        <div class="container">
            <div class="help-head">
                <h2 class="section-title">How we can <span class="text-gradient">help</span></h2>
                <p>Online sessions in Malayalam, from wherever you are. Not sure where you fit? <a href="/services/online-psychological-consultation-malayalam/">Start with a consultation.</a></p>
            </div>
            <ul class="help-list">
                <li><a href="/services/anxiety-counselling-malayalam/">Anxiety &amp; overthinking</a></li>
                <li><a href="/services/depression-therapy-malayalam/">Depression &amp; low mood</a></li>
                <li><a href="/services/stress-counselling-malayalam/">Stress &amp; pressure</a></li>
                <li><a href="/services/relationship-counselling-malayalam/">Relationship problems</a></li>
                <li><a href="/services/couple-therapy-malayalam/">Couple therapy</a></li>
                <li><a href="/services/trauma-counselling-malayalam/">Trauma &amp; childhood experiences</a></li>
                <li><a href="/services/adhd-consultation-malayalam/">ADHD consultation</a></li>
                <li><a href="/services/panic-attack-counselling-malayalam/">Panic attacks</a></li>
                <li><a href="/services/emotional-support-malayalam/">Emotional well-being</a></li>
            </ul>
            <a class="help-all" href="/services/">See all services</a>
        </div>
    </section>

'''
if 'class="help-section"' not in s:
    s = s.replace('    <section class="faq-section" id="faqs">', HELP + '    <section class="faq-section" id="faqs">', 1)
open('index.html', 'w', encoding='utf-8', newline='').write(s)
print('home: profiles + help section')

# ---- Privacy policy: marketer text ----
p = open('privacy.html', encoding='utf-8').read()
NEW = '''  <header class="page-header">
    <h1 class="section-title">Privacy Policy</h1>
    <p>Last updated: October 2026</p>
  </header>

  <section class="page-content">
    <p>MindLap respects your privacy and is committed to protecting your personal information. This Privacy Policy explains how we collect, use, store, and protect information when you use our website, services, and online psychological consultation platform.</p>
    <p>By using the MindLap website or services, you agree to the practices described in this Privacy Policy.</p>

    <h2>1. Information We Collect</h2>
    <p>Depending on how you interact with MindLap, we may collect information such as:</p>
    <ul>
      <li>Name</li>
      <li>Phone number</li>
      <li>Email address</li>
      <li>Age or basic personal details</li>
      <li>Information provided while booking a consultation</li>
      <li>Details about the type of support you are looking for</li>
      <li>Payment and transaction details</li>
      <li>Information you voluntarily provide through forms, messages, or other communication</li>
      <li>Website usage and technical information such as browser type, device information, IP address, and pages visited</li>
    </ul>
    <p>We only collect information that is reasonably required to provide, manage, improve, and communicate about our services.</p>

    <h2>2. Mental Health Information</h2>
    <p>Information related to your mental health, emotional well-being, personal experiences, or concerns may be shared by you when requesting psychological support.</p>
    <p>We treat such information as confidential and use it only for appropriate service-related purposes, subject to applicable laws and professional obligations.</p>
    <p>Please avoid sharing highly sensitive information through public areas of the website.</p>

    <h2>3. How We Use Your Information</h2>
    <p>We may use your information to:</p>
    <ul>
      <li>Process consultation requests and bookings</li>
      <li>Connect you with the appropriate professional or coordinator</li>
      <li>Provide and manage our services</li>
      <li>Communicate with you about appointments and service-related information</li>
      <li>Process payments where applicable</li>
      <li>Respond to your questions and requests</li>
      <li>Improve our website and services</li>
      <li>Maintain service records</li>
      <li>Prevent misuse, fraud, or security issues</li>
      <li>Comply with applicable legal requirements</li>
    </ul>

    <h2>4. Confidentiality</h2>
    <p>MindLap aims to maintain a confidential and respectful environment for individuals seeking psychological support.</p>
    <p>However, confidentiality may have legal or professional limitations in certain situations, including circumstances where disclosure may be required by applicable law or where there is a serious safety concern.</p>

    <h2>5. Sharing of Information</h2>
    <p>MindLap does not intend to sell your personal information.</p>

    <h2>6. Data Security</h2>
    <p>We use administrative, technical, and physical security measures to help protect your personal information. While we have taken reasonable steps to secure the personal information you provide to us, please be aware that no security measures are perfect or impenetrable.</p>

    <h2>7. Changes to This Privacy Policy</h2>
    <p>We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated date.</p>

    <h2>8. Contact Us</h2>
    <p>If you have questions about this Privacy Policy, please contact us at <a href="mailto:Officialmindlap@gmail.com">Officialmindlap@gmail.com</a>.</p>
  </section>
'''
if 'Clients Under 18' in p:
    raise SystemExit('privacy already up to date')  # don't overwrite the finished policy
a = p.index('  <header class="page-header">')
b = p.index('    <!-- Footer Section -->')
p = p[:a] + NEW + '\n' + p[b:]
p = p.replace('content="Read the Privacy Policy of Mindlap to understand how we protect, handle, and secure your personal and session consultation information."',
              'content="How MindLap collects, uses, stores and protects your personal and mental health information when you use our website and online psychological consultation services."')
open('privacy.html', 'w', encoding='utf-8', newline='').write(p)
print('privacy updated')

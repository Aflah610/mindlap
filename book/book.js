/* -------------------------------------------------------------
   Mindlap - Book Online, one page per step:
     /book/               verify phone (WhatsApp OTP)
     /book/credits/       prepaid sessions found (Zoho CRM)
     (therapist)          chosen on the site's own therapist cards / profile pages
     /book/session-type/  individual or couple
     /book/plan/          package or single session
     /book/schedule/      date and time
     /book/details/       name, email, notes
     /book/checkout/      review + pay (Razorpay) or confirm (prepaid)
     /book/confirmation/  outcome
   Progress lives in sessionStorage, so it survives moving between pages
   and the round trip to Razorpay, but not closing the tab.
   ------------------------------------------------------------- */

(function () {
    'use strict';

    const API = 'https://mindlap-booking-api.nasheel.workers.dev';
    const STORE_KEY = 'mindlapBooking';
    const WHATSAPP_URL = 'https://wa.me/917594000774?text=Hello%20Mindlap%2C%20I%20would%20like%20to%20book%20a%20therapy%20session.';

    const PATHS = {
        verify: '/book/',
        credits: '/book/credits/',
        therapist: '/#therapists',
        type: '/book/session-type/',
        plan: '/book/plan/',
        schedule: '/book/schedule/',
        details: '/book/details/',
        checkout: '/book/checkout/',
        confirmation: '/book/confirmation/',
        account: '/account/'
    };

    // The login (verified phone + signed token) is kept in localStorage so it
    // lasts across tabs and visits until the token expires (24h). Booking
    // progress stays in sessionStorage (this tab only).
    const AUTH_KEY = 'mindlapAuth';

    function loadAuth() {
        try {
            const auth = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
            return tokenValid(auth.token) ? auth : {};
        } catch (err) {
            return {};
        }
    }

    function saveAuth(token, phone) {
        try {
            localStorage.setItem(AUTH_KEY, JSON.stringify({ token, phone }));
        } catch (err) { /* login then lasts for this tab only */ }
    }

    /** Remembers whether the logged-in client gets the account page (drives "My account" in the menu). */
    function saveAuthAccount(hasAccount, name) {
        try {
            const auth = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
            if (!auth.token) return;
            auth.account = !!hasAccount;
            // Keep the name entered during booking; the account name only fills a gap.
            if (name && !auth.name) auth.name = String(name).slice(0, 60);
            localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        } catch (err) { /* menu just shows "Log In" */ }
    }

    /**
     * A booking with a time picked (details page onwards) is kept for 48 hours, so the
     * home page can offer "Resume your booking" (index.js) - prepaid ones too,
     * which have nothing in Creator until they are confirmed.
     */
    const DRAFT_KEY = 'mindlapDraft';
    const DRAFT_FIELDS = ['staffId', 'staffName', 'staffPhoto', 'staffProfile', 'sessionType', 'creditMode', 'credits',
        'serviceId', 'serviceName', 'price', 'currency', 'duration', 'date', 'time', 'name', 'email', 'notes'];

    function saveDraft(state) {
        try {
            const draft = { phone: state.phone, savedAt: Date.now() };
            DRAFT_FIELDS.forEach((k) => { if (state[k] !== undefined) draft[k] = state[k]; });
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        } catch (err) { /* no resume card on this device */ }
    }

    function clearDraft() {
        try { localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
    }

    /** Name entered during booking - shows as initials on the profile badge. */
    function saveAuthName(name) {
        try {
            const auth = JSON.parse(localStorage.getItem(AUTH_KEY)) || {};
            if (!auth.token || !name) return;
            auth.name = String(name).slice(0, 60);
            localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        } catch (err) { /* badge falls back to an icon */ }
    }

    /** Prepaid credits + booked sessions for the logged-in client. Returns null if the login expired. */
    async function loadAccount(token) {
        const [sessions, credits] = await Promise.all([
            post('/api/sessions', { session_token: token }).catch(() => null),
            post('/api/credits/check', { session_token: token }).catch(() => null)
        ]);
        if ((sessions && handleAuthError(sessions.res, sessions.data)) || (credits && handleAuthError(credits.res, credits.data))) return null;
        const data = sessions && sessions.res.ok ? sessions.data : null;
        const creditCount = credits && credits.res.ok && credits.data.has_credits ? Number(credits.data.credits) || 0 : 0;
        const wallet = credits && credits.res.ok ? Number(credits.data.wallet_credit) || 0 : 0;
        const booked = data ? (data.upcoming || []).length + (data.past || []).length : 0;
        return {
            data,
            name: data && data.customer && data.customer.name,
            credits: creditCount,
            wallet,
            known: !!data || !!(credits && credits.res.ok),
            hasAccount: creditCount > 0 || wallet > 0 || booked > 0
        };
    }

    /**
     * After logging in: the account page is for clients who have booked a
     * session or have prepaid credits. New clients go to the therapists.
     */
    async function goAfterLogin(token) {
        const account = await loadAccount(token);
        if (!account) return;
        saveAuthAccount(account.hasAccount, account.name);
        window.location.replace(account.hasAccount || !account.known ? PATHS.account : '/?welcome=new#therapists');
    }

    // -----------------------------------------------------------------
    // State
    // -----------------------------------------------------------------

    function load() {
        let state = {};
        try {
            state = JSON.parse(sessionStorage.getItem(STORE_KEY)) || {};
        } catch (err) { /* empty */ }
        if (!tokenValid(state.token)) {
            const auth = loadAuth();
            if (auth.token) Object.assign(state, { token: auth.token, phone: auth.phone });
        }
        return state;
    }

    function save(patch) {
        const next = Object.assign(load(), patch);
        if (patch.token) saveAuth(patch.token, next.phone);
        try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch (err) {
            // Private mode with storage disabled - the flow still works
            // within a page, it just can't carry state to the next one.
        }
        return next;
    }

    const SCHEDULE_KEYS = ['serviceId', 'serviceName', 'price', 'currency', 'staffId', 'staffName', 'date', 'time'];

    function clearFrom(keys) {
        const state = load();
        keys.forEach((k) => delete state[k]);
        try {
            sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (err) { /* see save() */ }
    }

    /** Forgets the booking in progress and the login. */
    function signOut() {
        try {
            sessionStorage.removeItem(STORE_KEY);
            localStorage.removeItem(AUTH_KEY);
        } catch (err) { /* see save() */ }
    }

    /** The session token is "<base64url payload>.<signature>"; the payload holds its expiry. */
    function tokenValid(token) {
        if (!token) return false;
        try {
            const payload = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
            const exp = JSON.parse(atob(payload + '==='.slice((payload.length + 3) % 4))).exp;
            return Number(exp) > Date.now() + 60 * 1000;
        } catch (err) {
            return false;
        }
    }

    function go(path) {
        window.location.href = path;
    }

    /** Redirects to an earlier step when this page's prerequisites are missing. Returns state or null. */
    function guard(requirements) {
        const state = load();
        if (!tokenValid(state.token)) {
            signOut();
            go(PATHS.verify);
            return null;
        }
        for (const [keys, fallback] of requirements || []) {
            if (keys.some((k) => state[k] === undefined || state[k] === null || state[k] === '')) {
                go(fallback);
                return null;
            }
        }
        return state;
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    const $ = (id) => document.getElementById(id);

    function setStatus(el, message, type) {
        if (!el) return;
        el.textContent = message || '';
        el.className = 'booking-status' + (type ? ' ' + type : '');
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    async function post(path, body) {
        const res = await fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    }

    async function get(path, params) {
        const url = new URL(API + path);
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
        });
        const res = await fetch(url.toString());
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data && data.error) || 'Request failed');
        return (data && data.response && data.response.returnvalue && data.response.returnvalue.data) || [];
    }

    function money(amount, currency) {
        const value = Number(amount) || 0;
        if ((currency || 'INR') === 'INR') {
            return '₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
        }
        return currency + ' ' + value.toLocaleString('en', { maximumFractionDigits: 2 });
    }

    function parseIsoDate(iso) {
        const [y, m, d] = String(iso || '').split('-').map(Number);
        return y && m && d ? new Date(y, m - 1, d) : null;
    }

    function longDate(iso) {
        const date = parseIsoDate(iso);
        return date ? date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : iso;
    }

    function shortDate(iso) {
        const date = parseIsoDate(iso);
        return date ? date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : iso;
    }

    /** The time this customer is holding, if it matches their chosen slot and hasn't run out. */
    function activeHold(state) {
        const h = state.hold;
        if (!h || h.staffId !== String(state.staffId) || h.date !== state.date || h.time !== state.time) return null;
        return h.until > Date.now() ? h : null;
    }

    function clock(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
    }

    let holdTimer = null;

    /** Ticks a countdown into `render(msLeft)` until the hold ends, then calls `onEnd`. */
    function runHoldCountdown(until, render, onEnd) {
        clearInterval(holdTimer);
        const tick = () => {
            const left = until - Date.now();
            if (left <= 0) {
                clearInterval(holdTimer);
                onEnd();
                return;
            }
            render(left);
        };
        tick();
        holdTimer = setInterval(tick, 1000);
    }

    /** "We're holding 11:00 AM for you" banner on the details and checkout pages. */
    function showHoldBanner(state) {
        const card = document.querySelector('.book-card');
        if (!card || !state.hold) return;
        const banner = document.createElement('div');
        banner.className = 'hold-banner';
        banner.setAttribute('role', 'status');
        card.insertBefore(banner, card.firstChild);
        const time = String(state.time).replace(/^0/, '');
        const ended = () => {
            banner.classList.add('ended');
            banner.innerHTML = '<span class="hold-dot"></span><span>Your hold on ' + escapeHtml(time) +
                ' has ended. We\'ll check it\'s still free when you continue.</span>';
        };
        const hold = activeHold(state);
        if (!hold) {
            ended();
            return;
        }
        runHoldCountdown(hold.until, (left) => {
            banner.innerHTML = '<span class="hold-dot"></span><span>We\'re holding <strong>' + escapeHtml(time) +
                '</strong> for you</span><span class="hold-clock">' + clock(left) + '</span>';
        }, ended);
    }

    /** Fills the "Your booking" card in the side panel with whatever has been chosen so far. */
    function renderSummary(state) {
        const box = $('book-summary');
        const list = $('book-summary-list');
        if (!box || !list) return;
        const typeLabel = state.sessionType === 'couple' ? 'Couple therapy'
            : state.sessionType === 'individual' ? 'Individual therapy' : '';
        const typeText = state.creditMode ? (typeLabel ? typeLabel + ' (prepaid)' : 'Prepaid session') : typeLabel;
        const rows = [
            ['Type', typeText],
            ['Session', state.serviceName],
            ['Therapist', state.staffName],
            ['When', state.date && state.time ? shortDate(state.date) + ', ' + String(state.time).replace(/^0/, '') : '']
        ].filter(([, value]) => value);
        let total = '';
        if (state.rebookOrderId && state.serviceName) total = 'Already paid';
        else if (state.creditMode && state.serviceName) total = 'Prepaid';
        else if (state.serviceName && state.price !== undefined && state.price !== null) total = money(state.price, state.currency);

        box.hidden = !rows.length;
        list.innerHTML = rows.map(([label, value]) =>
            '<div><dt>' + label + '</dt><dd>' + escapeHtml(value) + '</dd></div>'
        ).join('') + (total ? '<div class="book-summary-total"><dt>Total</dt><dd>' + escapeHtml(total) + '</dd></div>' : '');
    }

    function localIso(date) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function renderStepper(activeIndex) {
        const el = $('book-stepper');
        if (!el) return;
        const labels = ['Verify', 'Therapist', 'Session', 'Plan', 'Date & time', 'Details', 'Payment'];
        el.innerHTML = labels.map((label, i) => {
            const cls = i < activeIndex ? 'done' : i === activeIndex ? 'active' : '';
            const mark = i < activeIndex ? '&#10003;' : String(i + 1);
            return '<li class="' + cls + '"' + (i === activeIndex ? ' aria-current="step"' : '') + '>' +
                '<span class="book-step-dot">' + mark + '</span>' + label + '</li>';
        }).join('');
    }

    function showVerifiedChip(state) {
        const chip = $('book-verified-chip');
        if (!chip || !state.phone) return;
        chip.hidden = false;
        chip.querySelector('[data-phone]').textContent = state.phone;
        chip.querySelector('button').addEventListener('click', () => {
            signOut();
            go(PATHS.verify);
        });
    }

    /** Server said the verification expired - start over at /book/. */
    function handleAuthError(res, data) {
        if (res.status === 401 || (data && data.reverify)) {
            signOut();
            go(PATHS.verify + '?expired=1');
            return true;
        }
        return false;
    }

    // -----------------------------------------------------------------
    // Step 1: /book/ - verify phone
    // -----------------------------------------------------------------

    function initVerify() {
        renderStepper(0);

        const params = new URLSearchParams(window.location.search);
        const forAccount = params.get('next') === 'account';
        const wanted = params.get('therapist');
        if (wanted) {
            // Booking from a therapist's own button: that therapist is fixed.
            save({ preferredTherapist: wanted.slice(0, 60) });
        } else if (!forAccount && !load().rebookOrderId) {
            // Plain "Book Online": start fresh and choose the therapist on the site.
            clearFrom(SCHEDULE_KEYS.concat(['hold', 'staffPhoto', 'staffProfile', 'sessionType', 'preferredTherapist', 'resumeBookingId']));
        }
        if (forAccount) {
            const title = document.querySelector('.book-title');
            const lead = document.querySelector('.book-lead');
            if (title) title.textContent = 'Log in to Mindlap';
            if (lead) lead.textContent = 'Enter your WhatsApp number and we\'ll send you a code. No password needed.';
            document.body.classList.add('login-mode');
            const asideTitle = document.querySelector('.book-aside-title');
            if (asideTitle) asideTitle.textContent = 'See your sessions and prepaid credits in one place';
        }

        const state = load();
        if (tokenValid(state.token)) {
            // Already logged in: no number to type, just move on.
            document.documentElement.classList.add('auth-skip');
            if (state.phone) $('otp-continuing-phone').textContent = ', ' + state.phone;
            if (forAccount) goAfterLogin(state.token);
            else routeAfterVerify(state.token);
            return;
        }
        document.documentElement.classList.remove('auth-skip');

        const phoneStep = $('otp-phone-step');
        const codeStep = $('otp-code-step');
        const nameInput = $('otp-name');
        const phoneInput = $('otp-phone');
        const countrySelect = $('otp-country');
        const codeInput = $('otp-code');
        const sendBtn = $('otp-send-btn');
        const verifyBtn = $('otp-verify-btn');
        const resendBtn = $('otp-resend-btn');
        const changeBtn = $('otp-change-btn');
        const statusEl = $('otp-status');
        const sentTo = $('otp-sent-to');
        const title = document.querySelector('.book-title');
        const lead = document.querySelector('.book-lead');
        const phoneTitle = title.textContent;
        const codeBanner = $('otp-code-banner');
        const digitBoxes = document.querySelectorAll('.otp-digit');
        let resendTimer = null;
        let verifying = false;

        // One real input keeps paste, keyboard editing and SMS/WhatsApp autofill together.
        function syncCodeDigits() {
            const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
            codeInput.value = digits;
            const active = Math.min(codeInput.selectionStart ?? digits.length, 5);
            digitBoxes.forEach((box, i) => {
                box.textContent = digits[i] || '';
                box.classList.toggle('is-active', i === active && digits.length < 6);
            });
            verifyBtn.disabled = verifying || digits.length !== 6;
        }

        // Verification needs only a number; the details step collects the client's name.
        $('otp-name-field').hidden = true;
        nameInput.value = state.name || '';
        const typedName = () => nameInput.value.trim().replace(/\s+/g, ' ');
        const countryDisplay = $('otp-country-display');
        const countryToggle = $('otp-country-toggle');
        const countryPicker = $('otp-country-picker');
        const countrySearch = $('otp-country-search');
        const countryResults = $('otp-country-results');
        // Shared ISO/calling-code data from the booking app. ISO stays distinct for shared codes.
        const countryCodes = 'AF93 AX358 AL355 DZ213 AS1 AD376 AO244 AI1 AG1 AR54 AM374 AW297 AU61 AT43 AZ994 BS1 BH973 BD880 BB1 BY375 BE32 BZ501 BJ229 BM1 BT975 BO591 BQ599 BA387 BW267 BR55 IO246 VG1 BN673 BG359 BF226 BI257 KH855 CM237 CA1 CV238 KY1 CF236 TD235 CL56 CN86 CX61 CC61 CO57 KM269 CG242 CD243 CK682 CR506 CI225 HR385 CU53 CW599 CY357 CZ420 DK45 DJ253 DM1 DO1 EC593 EG20 SV503 GQ240 ER291 EE372 SZ268 ET251 FK500 FO298 FJ679 FI358 FR33 GF594 PF689 GA241 GM220 GE995 DE49 GH233 GI350 GR30 GL299 GD1 GP590 GU1 GT502 GG44 GN224 GW245 GY592 HT509 HN504 HK852 HU36 IS354 IN91 ID62 IR98 IQ964 IE353 IM44 IL972 IT39 JM1 JP81 JE44 JO962 KZ7 KE254 KI686 XK383 KW965 KG996 LA856 LV371 LB961 LS266 LR231 LY218 LI423 LT370 LU352 MO853 MG261 MW265 MY60 MV960 ML223 MT356 MH692 MQ596 MR222 MU230 YT262 MX52 FM691 MD373 MC377 MN976 ME382 MS1 MA212 MZ258 MM95 NA264 NR674 NP977 NL31 NC687 NZ64 NI505 NE227 NG234 NU683 NF672 KP850 MK389 MP1 NO47 OM968 PK92 PW680 PS970 PA507 PG675 PY595 PE51 PH63 PL48 PT351 PR1 QA974 RE262 RO40 RU7 RW250 BL590 SH290 KN1 LC1 MF590 PM508 VC1 WS685 SM378 ST239 SA966 SN221 RS381 SC248 SL232 SG65 SX1 SK421 SI386 SB677 SO252 ZA27 KR82 SS211 ES34 LK94 SD249 SR597 SJ47 SE46 CH41 SY963 TW886 TJ992 TZ255 TH66 TL670 TG228 TK690 TO676 TT1 TN216 TR90 TM993 TC1 TV688 UG256 UA380 AE971 GB44 US1 UY598 VI1 UZ998 VU678 VA39 VE58 VN84 WF681 EH212 YE967 ZM260 ZW263';
        const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
        const countries = countryCodes.split(' ').map(value => ({
            iso: value.slice(0, 2), dial: '+' + value.slice(2),
            name: regionNames.of(value.slice(0, 2))
        })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
        let selectedCountry = countries.find(country => country.iso === 'IN');
        function syncCountryDisplay() {
            countryDisplay.textContent = selectedCountry.dial;
            $('otp-country-flag').src = '/assets/flags/' + selectedCountry.iso.toLowerCase() + '.svg';
            countryToggle.setAttribute('aria-label', 'Country: ' + selectedCountry.name + ' ' + selectedCountry.dial + '. Change country');
        }
        function closeCountryPicker(restoreFocus = false) {
            countryPicker.hidden = true;
            countryToggle.setAttribute('aria-expanded', 'false');
            if (restoreFocus) countryToggle.focus();
        }
        const searchAliases = { AE: 'uae emirates', GB: 'uk britain', US: 'usa america' };
        const searchText = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        function renderCountries() {
            const query = searchText(countrySearch.value.trim()).replace(/^\+/, '');
            const matches = countries.filter(country => !query || searchText(country.name).includes(query)
                || country.dial.slice(1).startsWith(query) || country.iso.toLowerCase() === query
                || (searchAliases[country.iso] || '').includes(query));
            countryResults.replaceChildren();
            for (const country of matches) {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'country-option';
                row.setAttribute('aria-pressed', String(country.iso === selectedCountry.iso));
                const image = document.createElement('img');
                image.src = '/assets/flags/' + country.iso.toLowerCase() + '.svg';
                image.alt = '';
                image.loading = 'lazy';
                image.width = 26; image.height = 20;
                const name = document.createElement('span');
                name.textContent = country.name;
                const dial = document.createElement('span');
                dial.className = 'country-dial'; dial.textContent = country.dial;
                row.append(image, name, dial);
                row.addEventListener('click', () => {
                    selectedCountry = country;
                    countrySelect.value = country.dial;
                    countrySelect.dispatchEvent(new Event('change'));
                    closeCountryPicker();
                    phoneInput.focus();
                });
                countryResults.append(row);
            }
            $('otp-country-empty').hidden = matches.length !== 0;
        }
        countryToggle.addEventListener('click', () => {
            if (!countryPicker.hidden) return closeCountryPicker(true);
            countrySearch.value = '';
            renderCountries();
            countryPicker.hidden = false;
            countryToggle.setAttribute('aria-expanded', 'true');
            countrySearch.focus();
        });
        countrySearch.addEventListener('input', renderCountries);
        countryPicker.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); closeCountryPicker(true); }
            const rows = Array.from(countryResults.querySelectorAll('button'));
            const index = rows.indexOf(document.activeElement);
            if (event.key === 'ArrowDown' && rows.length) {
                event.preventDefault(); rows[Math.min(index + 1, rows.length - 1)].focus();
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (index <= 0) countrySearch.focus(); else rows[index - 1].focus();
            }
            if (event.key === 'Enter' && event.target === countrySearch && rows.length) {
                event.preventDefault(); rows[0].click();
            }
        });
        document.addEventListener('pointerdown', event => {
            if (!countryPicker.hidden && !countryPicker.contains(event.target) && !countryToggle.contains(event.target)) closeCountryPicker();
        });
        document.addEventListener('focusin', event => {
            if (!countryPicker.hidden && !countryPicker.contains(event.target) && !countryToggle.contains(event.target)) closeCountryPicker();
        });
        syncCountryDisplay();

        if (new URLSearchParams(window.location.search).get('expired')) {
            setStatus(statusEl, 'Your verification expired. Please verify your number again.', 'error');
        }

        function localDigits() {
            const raw = phoneInput.value.trim();
            let digits = raw.replace(/\D/g, '');
            const cc = countrySelect.value.replace('+', '');
            if (/^(\+|00)/.test(raw)) {
                digits = digits.replace(/^00/, '');
                if (digits.startsWith(cc)) digits = digits.slice(cc.length);
            } else if (cc === '91' && digits.length === 12 && digits.startsWith('91')) {
                digits = digits.slice(2);
            }
            return digits.replace(/^0+/, '');
        }

        const fullPhone = () => (localDigits() ? countrySelect.value + localDigits() : '');
        const validNumber = () => {
            const len = localDigits().length;
            return countrySelect.value === '+91' ? len === 10 : len >= 6 && len <= 13;
        };

        function cooldown(seconds) {
            let left = seconds;
            resendBtn.disabled = true;
            resendBtn.textContent = 'Resend in ' + left + 's';
            clearInterval(resendTimer);
            resendTimer = setInterval(() => {
                left -= 1;
                if (left <= 0) {
                    clearInterval(resendTimer);
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend code';
                } else {
                    resendBtn.textContent = 'Resend in ' + left + 's';
                }
            }, 1000);
        }

        function showCodeStep(delivered = true) {
            phoneStep.hidden = true;
            codeStep.hidden = false;
            document.body.classList.add('otp-code-mode');
            title.textContent = 'Verify your code';
            lead.hidden = true;
            if (codeBanner) codeBanner.hidden = !delivered;
            const digits = localDigits();
            sentTo.textContent = countrySelect.value + ' ' + (countrySelect.value === '+91' ? digits.slice(0, 5) + ' ' + digits.slice(5) : digits);
            codeInput.value = '';
            syncCodeDigits();
            codeInput.focus();
            cooldown(60);
        }

        async function send(isResend) {
            if (!validNumber()) {
                setStatus(statusEl, countrySelect.value === '+91' ? 'Please enter a valid 10-digit phone number.' : 'Please enter a valid phone number.', 'error');
                return;
            }
            sendBtn.disabled = true;
            setStatus(statusEl, isResend ? 'Resending code…' : 'Sending code…');
            try {
                const { res, data } = await post('/api/otp/send', { phone: fullPhone() });
                if (!res.ok || !data.success) {
                    if (data.delivery_failed) {
                        showCodeStep(false);
                        setStatus(statusEl, (data.error || "We couldn't deliver the code on WhatsApp.") +
                            ' If you already have a code, enter it below, or tap Resend in a minute.', 'error');
                    } else {
                        setStatus(statusEl, data.error || 'Could not send code.', 'error');
                    }
                    return;
                }
                showCodeStep();
                setStatus(statusEl, codeBanner ? '' : 'Code sent on WhatsApp.', 'success');
            } catch (err) {
                setStatus(statusEl, 'Network error, please try again.', 'error');
            } finally {
                sendBtn.disabled = false;
            }
        }

        async function verify() {
            if (verifying) return;
            const code = codeInput.value.replace(/\D/g, '');
            if (code.length !== 6) {
                setStatus(statusEl, 'Please enter the 6-digit code.', 'error');
                return;
            }
            verifying = true;
            verifyBtn.disabled = true;
            setStatus(statusEl, 'Verifying…');
            try {
                const { res, data } = await post('/api/otp/verify', { phone: fullPhone(), code });
                if (!res.ok || !data.success || !data.session_token) {
                    setStatus(statusEl, data.error || 'Incorrect or expired code.', 'error');
                    return;
                }
                const preferredTherapist = load().preferredTherapist || null;
                signOut();
                save({ token: data.session_token, phone: data.phone || fullPhone(), preferredTherapist, name: forAccount ? undefined : typedName() });
                if (!forAccount) saveAuthName(typedName());
                if (forAccount) {
                    setStatus(statusEl, 'Logged in!', 'success');
                    await goAfterLogin(data.session_token);
                    return;
                }
                setStatus(statusEl, 'Verified! Checking for prepaid sessions…', 'success');
                await routeAfterVerify(data.session_token);
            } catch (err) {
                setStatus(statusEl, 'Network error, please try again.', 'error');
            } finally {
                verifying = false;
                syncCodeDigits();
            }
        }

        countrySelect.addEventListener('change', () => {
            syncCountryDisplay();
            phoneInput.maxLength = countrySelect.value === '+91' ? 14 : 20;
        });
        sendBtn.addEventListener('click', () => send(false));
        phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(false); });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') phoneInput.focus(); });
        resendBtn.addEventListener('click', () => send(true));
        verifyBtn.addEventListener('click', verify);
        codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
        codeInput.addEventListener('input', () => {
            syncCodeDigits();
            if (codeInput.value.replace(/\D/g, '').length === 6) verify();
        });
        codeInput.addEventListener('focus', syncCodeDigits);
        codeInput.addEventListener('click', syncCodeDigits);
        codeInput.addEventListener('keyup', syncCodeDigits);
        changeBtn.addEventListener('click', () => {
            clearInterval(resendTimer);
            codeStep.hidden = true;
            phoneStep.hidden = false;
            document.body.classList.remove('otp-code-mode');
            title.textContent = phoneTitle;
            lead.hidden = false;
            if (codeBanner) codeBanner.hidden = true;
            setStatus(statusEl, '');
            phoneInput.focus();
        });
    }

    /** Prepaid credits (Zoho CRM) decide the next page. A failed check falls back to the normal flow. */
    /** Switches the flow to "pick a new time for an already-paid session". */
    function startRebook(item) {
        clearFrom(SCHEDULE_KEYS.concat(['hold', 'duration']));
        save({
            rebookOrderId: item.order_id,
            serviceId: item.service_id,
            serviceName: item.service_name || 'Your paid session',
            staffId: String(item.staff_id),
            staffName: item.staff_name || 'your therapist',
            sessionType: serviceType(item.service_name),
            creditMode: false,
            price: Number(item.amount) || 0,
            currency: item.currency || 'INR'
        });
    }

    // Paid-but-unbooked sessions and prepaid credits were checked this recently: don't ask the server again.
    const ROUTE_CHECK_MS = 10 * 60 * 1000;

    async function routeAfterVerify(token) {
        const state = load();
        if (state.routeCheckedAt && Date.now() - state.routeCheckedAt < ROUTE_CHECK_MS && state.creditMode !== undefined) {
            await continueWithTherapist();
            return;
        }
        // Both checks at once - they don't depend on each other.
        const [waiting, credits] = await Promise.all([
            post('/api/payment/waiting', { session_token: token }).catch(() => null),
            post('/api/credits/check', { session_token: token }).catch(() => null)
        ]);
        if ((waiting && handleAuthError(waiting.res, waiting.data)) || (credits && handleAuthError(credits.res, credits.data))) return;
        if (waiting && waiting.res.ok && waiting.data.waiting && waiting.data.waiting.length) {
            startRebook(waiting.data.waiting[0]);
            go(PATHS.confirmation + '?booking=waiting');
            return;
        }
        save({ routeCheckedAt: Date.now() });
        try {
            if (!credits) throw new Error('credit check failed');
            const { res, data } = credits;
            if (res.ok && data.has_credits && data.credits > 0) {
                const firstTime = load().creditMode === undefined;
                save({ credits: data.credits });
                if (firstTime) {
                    go(PATHS.credits);
                    return;
                }
                await continueWithTherapist();
                return;
            }
        } catch (err) { /* fall through */ }
        save({ credits: 0, creditMode: false });
        await continueWithTherapist();
    }

    // -----------------------------------------------------------------
    // Step 2a: /book/credits/
    // -----------------------------------------------------------------

    function initCredits() {
        const state = guard();
        if (!state) return;
        if (!(state.credits > 0)) {
            continueWithTherapist();
            return;
        }
        renderStepper(1);
        showVerifiedChip(state);

        const n = state.credits;
        $('credits-count').textContent = n + ' prepaid session' + (n === 1 ? '' : 's');

        $('use-credits-btn').addEventListener('click', () => {
            save({ creditMode: true });
            clearFrom(['sessionType', 'serviceId', 'serviceName', 'price', 'currency', 'duration', 'date', 'time']);
            continueWithTherapist();
        });
        $('pay-new-btn').addEventListener('click', () => {
            if (load().creditMode) clearFrom(['sessionType', 'serviceId', 'serviceName', 'price', 'currency', 'duration']);
            save({ creditMode: false });
            continueWithTherapist();
        });
    }

    // -----------------------------------------------------------------
    // Services and therapists (from Zoho Bookings)
    // -----------------------------------------------------------------

    /** From the Zoho service name: anything mentioning "couple" is couple therapy, everything else is individual. */
    function serviceType(name) {
        return /couple/i.test(String(name || '')) ? 'couple' : 'individual';
    }

    function isPackage(name) {
        return /package/i.test(String(name || ''));
    }

    function serviceMinutes(service) {
        const m = String((service && service.duration) || '').match(/\d+/);
        return m ? Number(m[0]) : 60;
    }

    function offeredBy(service, staffId) {
        return (service.assigned_staffs || []).map(String).includes(String(staffId));
    }

    /**
     * What this customer can book with this therapist: services of the chosen
     * type (single sessions and packages). Prepaid credits cover one single
     * session of either type.
     */
    function bookableServices(services, staffId, state) {
        return services.filter((s) => {
            const type = serviceType(s.name);
            if (!type || !offeredBy(s, staffId)) return false;
            return type === state.sessionType && !(state.creditMode && isPackage(s.name));
        });
    }

    /**
     * Site therapists (profile first name) that can be booked online, and the
     * first name of their staff record in the Waky booking app. Add a line per
     * therapist once they exist there; until then their buttons stay on WhatsApp.
     */
    const ONLINE_THERAPISTS = {
        rashin: { zohoStaff: 'rishin', profile: '/rashin.html', photo: '/assets/rashin.webp' },
        christine: { zohoStaff: 'christine', profile: '/christine.html', photo: '/assets/christine.webp' },
        jasmin: { zohoStaff: 'jasmin', profile: '/jasmin.html', photo: '/assets/jasmin.webp' },
        theresa: { zohoStaff: 'theresa', profile: '/theresa.html', photo: '/assets/theresa.webp' },
        fathima: { zohoStaff: 'fathima', profile: '/fathima.html', photo: '/assets/fathima.webp' }
    };

    function firstName(name) {
        return String(name || '').trim().split(/[\s-]+/)[0].toLowerCase();
    }

    /**
     * Continues with the therapist chosen on the site (preferredTherapist, set
     * by /book/?therapist=Name). Without one, sends the customer to the
     * therapist cards on the home page to pick someone.
     */
    async function continueWithTherapist() {
        const state = load();
        const wanted = state.preferredTherapist;
        const known = state.staffId && !wanted;
        if (known) {
            go(PATHS.type);
            return;
        }
        if (!wanted) {
            go(PATHS.therapist);
            return;
        }
        const first = firstName(wanted);
        const entry = ONLINE_THERAPISTS[first] || { zohoStaff: first, profile: '/' + first, photo: '/assets/' + first + '.webp' };
        let staff = [];
        try {
            staff = await get('/api/staff');
        } catch (err) { /* handled below */ }
        const match = staff.find((p) => firstName(p.name) === first) ||
            staff.find((p) => firstName(p.name) === entry.zohoStaff) ||
            (entry.zohoStaffId ? staff.find((p) => String(p.id) === String(entry.zohoStaffId)) : null);
        if (!match) {
            save({ preferredTherapist: null });
            go(PATHS.therapist);
            return;
        }
        if (String(match.id) !== String(state.staffId) || wanted !== state.staffName) clearFrom(SCHEDULE_KEYS.concat(['hold']));
        save({
            staffId: String(match.id),
            staffName: wanted,
            staffPhoto: entry.photo,
            staffProfile: entry.profile,
            preferredTherapist: null
        });
        window.location.replace(PATHS.type);
    }

    // -----------------------------------------------------------------
    // Step 3: /book/session-type/
    // -----------------------------------------------------------------

    async function initType() {
        const state = guard([[['staffId'], PATHS.therapist]]);
        if (!state) return;
        renderStepper(2);
        showVerifiedChip(state);

        const back = $('type-back');
        if (back) {
            back.hidden = false;
            back.href = state.staffProfile || PATHS.therapist;
        }

        const cards = document.querySelectorAll('[data-session-type]');
        cards.forEach((card) => {
            if (card.getAttribute('data-session-type') === state.sessionType) card.classList.add('selected');
            card.addEventListener('click', () => {
                if (card.disabled) return;
                const type = card.getAttribute('data-session-type');
                if (type !== load().sessionType) clearFrom(['serviceId', 'serviceName', 'price', 'currency', 'duration']);
                save({ sessionType: type });
                go(PATHS.plan);
            });
        });

        // Grey out a type this therapist doesn't offer online.
        try {
            const services = await get('/api/services', { staff_id: state.staffId });
            cards.forEach((card) => {
                const type = card.getAttribute('data-session-type');
                const has = bookableServices(services, state.staffId, { sessionType: type }).length > 0;
                if (!has) {
                    card.disabled = true;
                    card.classList.add('unavailable');
                    card.querySelector('.session-type-desc').textContent = 'Not offered online by ' + state.staffName + '.';
                    card.querySelector('.session-type-desc').hidden = false;
                }
            });
        } catch (err) { /* leave both enabled; the next step explains if nothing is bookable */ }
    }

    // -----------------------------------------------------------------
    // Step 4: /book/plan/ - packages or a single session
    // -----------------------------------------------------------------

    /** Number of sessions in a package, from its Zoho name ("Couple therapy 8 Session package" -> 8). */
    function packageSessions(name) {
        const m = String(name || '').match(/(\d+)\s*session/i);
        return m ? Number(m[1]) : 0;
    }

    async function initPlan() {
        const state = guard([[['staffId'], PATHS.therapist], [['sessionType'], PATHS.type]]);
        if (!state) return;
        renderStepper(3);
        showVerifiedChip(state);

        $('plan-back').href = PATHS.type;
        $('plan-with').innerHTML = 'With <strong>' + escapeHtml(state.staffName) + '</strong> · ' +
            (state.sessionType === 'couple' ? 'couple therapy' : 'individual therapy') + (state.creditMode ? ' (prepaid)' : '') +
            ' · online. <a href="' + PATHS.therapist + '">Change therapist</a>';
        if (state.creditMode) {
            const banner = $('credit-banner');
            banner.hidden = false;
            banner.querySelector('[data-credits]').textContent = state.credits;
        }

        const list = $('plan-list');
        const statusEl = $('plan-status');
        const nextBtn = $('plan-next');
        const footerSummary = $('plan-summary');

        let services = [];
        try {
            services = bookableServices(await get('/api/services', { staff_id: state.staffId }), state.staffId, state);
        } catch (err) {
            setStatus(statusEl, 'Could not load sessions right now. Please try again shortly or book on WhatsApp.', 'error');
            return;
        }
        // Prepaid clients book single sessions only; their credits pay for them.
        const packages = state.creditMode ? [] : services.filter((s) => isPackage(s.name)).sort((a, b) => packageSessions(a.name) - packageSessions(b.name));
        const singles = services.filter((s) => !isPackage(s.name)).sort((a, b) => Number(a.price) - Number(b.price));
        if (!services.length) {
            setStatus(statusEl, state.staffName + ' has no ' + state.sessionType + ' ' +
                'sessions open for online booking. Please choose another therapist or book on WhatsApp.', 'error');
            return;
        }

        // What one session costs without a package: the cheapest paid single session of this type.
        const paidSingles = singles.filter((s) => Number(s.price) >= 100).map((s) => Number(s.price));
        const singlePrice = paidSingles.length ? Math.min.apply(null, paidSingles) : 0;

        let picked = services.find((s) => String(s.id) === String(state.serviceId)) || null;

        const personIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a7 7 0 0 1 16 0v1"></path></svg>';

        function card(s, inner) {
            return '<button type="button" class="option-card plan-row" role="radio" aria-checked="' +
                String(!!picked && picked.id === s.id) + '" data-value="' + escapeHtml(s.id) + '">' + inner + '<span class="plan-radio" aria-hidden="true"></span></button>';
        }

        function singleCard(s) {
            const price = Number(s.price) || 0;
            const sub = state.creditMode ? 'Paid from your prepaid sessions'
                : singles.length > 1 ? s.name : (price ? money(price, s.currency) + ' per session' : 'Free');
            return card(s,
                '<span class="plan-icon">' + personIcon + '</span>' +
                '<span class="plan-row-main"><span class="plan-row-title">1 session</span>' +
                    '<span class="plan-row-sub">' + escapeHtml(sub) + '</span></span>' +
                '<span class="plan-row-price"><span class="plan-row-amount">' +
                    escapeHtml(state.creditMode ? 'Prepaid' : (price ? money(price, s.currency) : 'Free')) + '</span></span>');
        }

        const packageIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></svg>';
        function packageCard(s, index) {
            const n = packageSessions(s.name);
            const price = Number(s.price) || 0;
            const full = n && singlePrice ? n * singlePrice : 0;
            return card(s,
                '<span class="plan-icon plan-package-icon plan-tone-' + (index % 3) + '">' + packageIcon + '</span>' +
                '<span class="plan-row-main"><span class="plan-row-title">' + escapeHtml(n ? n + ' sessions' : s.name) + '</span>' +
                    (n ? '<span class="plan-row-sub">' + escapeHtml(money(Math.round(price / n), s.currency)) + ' per session</span>' : '') + '</span>' +
                '<span class="plan-row-price"><span class="plan-row-amount">' + escapeHtml(money(price, s.currency)) + '</span>' +
                    (full > price ? '<s>' + escapeHtml(money(full, s.currency)) + '</s>' : '') + '</span>');
        }

        function render() {
            list.innerHTML = (singles.length ? '<div class="plan-singles">' + singles.map(singleCard).join('') + '</div>' : '') +
                (packages.length
                    ? '<div class="plan-packages"><span class="plan-packages-label">Packages</span>' + packages.map(packageCard).join('') + '</div>'
                    : '');
            list.querySelectorAll('.plan-row').forEach((row, index) => {
                row.tabIndex = picked ? (row.dataset.value === String(picked.id) ? 0 : -1) : (index === 0 ? 0 : -1);
                row.addEventListener('click', () => {
                    picked = services.find((s) => s.id === row.dataset.value);
                    render();
                    list.querySelector('[aria-checked="true"]').focus();
                });
            });
            nextBtn.disabled = !picked;
            footerSummary.innerHTML = picked
                ? '<strong>' + escapeHtml(isPackage(picked.name) && packageSessions(picked.name) ? packageSessions(picked.name) + ' sessions' : '1 session') + '</strong> ' +
                    (state.creditMode ? 'prepaid' : escapeHtml(money(picked.price, picked.currency)))
                : 'Choose a plan';
            renderSummary(Object.assign({}, state, {
                serviceName: picked && picked.name,
                price: picked ? Number(picked.price) || 0 : undefined,
                currency: picked && picked.currency,
                date: null,
                time: null
            }));
        }

        list.addEventListener('keydown', event => {
            if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
            const rows = Array.from(list.querySelectorAll('.plan-row'));
            const index = rows.indexOf(event.target);
            if (index < 0) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
                : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + rows.length) % rows.length;
            rows[next].click();
        });

        nextBtn.addEventListener('click', () => {
            if (!picked) {
                setStatus(statusEl, 'Please choose a plan.', 'error');
                return;
            }
            if (String(picked.id) !== String(state.serviceId)) {
                // A different plan can need a different length of time: let go of any held time.
                if (state.hold) post('/api/slots/release', { session_token: state.token, hold_token: state.hold.token }).catch(() => {});
                clearFrom(['date', 'time', 'hold']);
            }
            save({
                serviceId: picked.id,
                serviceName: picked.name,
                price: Number(picked.price) || 0,
                currency: picked.currency || 'INR',
                duration: serviceMinutes(picked)
            });
            go(PATHS.schedule);
        });

        render();
    }

    // -----------------------------------------------------------------
    // Step 5: /book/schedule/ - date, then time, for the chosen plan
    // -----------------------------------------------------------------

    function initSchedule() {
        const state = guard([[['staffId'], PATHS.therapist], [['sessionType'], PATHS.type], [['serviceId'], PATHS.plan]]);
        if (!state) return;
        renderStepper(4);
        showVerifiedChip(state);

        const rebook = Boolean(state.rebookOrderId);
        $('schedule-back').href = PATHS.plan;
        if (new URLSearchParams(window.location.search).get('resume') === 'taken') {
            // From "Resume your booking": everything is kept except the time.
            const note = document.createElement('div');
            note.className = 'modal-cta-box schedule-resume-note';
            note.innerHTML = '<p>Your earlier time is no longer available. Pick a new date and time - your session and details are saved.</p>';
            $('date-block').parentNode.insertBefore(note, $('date-block'));
        }
        const sessionIcon = '<span class="schedule-session-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg></span>';
        const count = packageSessions(state.serviceName);
        const priceDescription = state.creditMode ? 'Prepaid session' : escapeHtml(money(state.price, state.currency)) + (count ? ' for ' + count + ' sessions' : ' per session');
        $('schedule-with').innerHTML = sessionIcon + '<span class="schedule-session-main"><strong>' + escapeHtml(state.serviceName) + ' with ' + escapeHtml(state.staffName) + '</strong>' +
            '<span>Online · ' + priceDescription + '</span></span><a href="' + PATHS.plan + '">Change</a>';
        if (rebook) {
            $('schedule-back').href = PATHS.confirmation + '?booking=waiting';
            $('schedule-with').innerHTML = sessionIcon + '<span class="schedule-session-main"><strong>' + escapeHtml(state.serviceName) + ' with ' + escapeHtml(state.staffName) +
                '</strong><span>Already paid. Choose a new time, no payment needed.</span></span>';
            $('schedule-next').textContent = 'Confirm new time';
        }
        if (state.creditMode) {
            const banner = $('credit-banner');
            banner.hidden = false;
            banner.querySelector('[data-credits]').textContent = state.credits;
        }

        const dateStrip = $('date-strip');
        const slotsWrap = $('booking-slots');
        const statusEl = $('schedule-status');
        const nextBtn = $('schedule-next');
        const footerSummary = $('schedule-summary');
        const DAYS_AHEAD = 30;

        let candidates = []; // just the plan chosen on /book/plan/
        const slotsByService = {}; // serviceId -> minutes[] for the current date
        let times = []; // half-hour times (minutes) open for the plan
        let dateRequest = 0;
        let holding = false;
        let hold = state.hold || null; // { staffId, date, time, until }
        const pick = { date: state.date || null, time: state.time || null, service: null };
        let datePickerOpen = !pick.date;

        function slotMinutes(slot) {
            const m = String(slot).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
            if (!m) return -1;
            let h = Number(m[1]);
            const ap = (m[3] || '').toUpperCase();
            if (ap === 'PM' && h !== 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            return h * 60 + Number(m[2]);
        }

        function slotLabel(minutes) {
            const h24 = Math.floor(minutes / 60);
            const suffix = h24 >= 12 ? 'PM' : 'AM';
            const h12 = h24 % 12 || 12;
            return String(h12).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0') + ' ' + suffix;
        }

        const niceTime = (t) => String(t).replace(/^0/, '');

        function holdMatchesPick() {
            return hold && pick.time && hold.staffId === String(state.staffId) &&
                hold.date === pick.date && hold.time === pick.time && hold.until > Date.now();
        }

        function releaseIfStale() {
            if (hold && !holdMatchesPick()) {
                post('/api/slots/release', { session_token: state.token, hold_token: hold.token }).catch(() => {});
                hold = null;
                save({ hold: null });
            }
        }

        function refresh() {
            const ready = !datePickerOpen && pick.date && pick.time && pick.service && holdMatchesPick();
            nextBtn.disabled = !ready || holding;
            if (ready) {
                const line = escapeHtml(pick.service.name) + (rebook ? ' · already paid' : state.creditMode ? ' · prepaid' : ' · ' + money(pick.service.price, pick.service.currency));
                runHoldCountdown(hold.until, (left) => {
                    footerSummary.innerHTML = '<strong>' + escapeHtml(shortDate(pick.date) + ', ' + niceTime(pick.time)) + '</strong>' +
                        '<span class="hold-inline">Held for you · ' + clock(left) + '</span> ' + line;
                }, () => {
                    pick.time = null;
                    hold = null;
                    save({ hold: null });
                    setStatus(statusEl, 'Your 10-minute hold ended, so the time was released. Please pick a time again.', 'error');
                    renderTimes();
                    refresh();
                });
            } else {
                clearInterval(holdTimer);
                footerSummary.textContent = datePickerOpen || !pick.date ? 'Pick a date to see open times.'
                    : !pick.time ? 'Pick a time.' : 'Holding your time…';
            }
            renderSummary(Object.assign({}, state, {
                serviceName: pick.service && pick.service.name,
                price: pick.service ? Number(pick.service.price) || 0 : undefined,
                currency: pick.service && pick.service.currency,
                date: pick.date,
                time: pick.time
            }));
        }

        // -- 1. Date ----------------------------------------------------
        function renderDates() {
            const today = new Date();
            const chips = [];
            for (let i = 0; i < DAYS_AHEAD; i++) {
                const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
                chips.push('<button type="button" class="date-chip" role="radio" aria-checked="false" data-value="' + localIso(d) + '" aria-label="' +
                    escapeHtml(d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })) + '">' +
                    '<span class="dow">' + (i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-IN', { weekday: 'short' })) + '</span>' +
                    '<span class="dom">' + d.getDate() + '</span>' +
                    '<span class="mon">' + d.toLocaleDateString('en-IN', { month: 'short' }) + '</span>' +
                    '</button>');
            }
            dateStrip.innerHTML = chips.join('');
            dateStrip.querySelectorAll('.date-chip').forEach((chip, index) => {
                chip.tabIndex = index === 0 ? 0 : -1;
                chip.addEventListener('click', () => chooseDate(chip.dataset.value));
            });
            const valid = pick.date && dateStrip.querySelector('[data-value="' + pick.date + '"]');
            if (valid) {
                chooseDate(pick.date, true);
            } else {
                pick.date = null;
                pick.time = null;
                $('date-month').textContent = today.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
                $('time-block').hidden = true;
                refresh();
            }
        }

        $('change-date').addEventListener('click', () => {
            datePickerOpen = true;
            ++dateRequest; // Ignore an availability response from before reopening the picker.
            document.body.classList.remove('date-picked');
            $('selected-date').hidden = true;
            $('pick-date').hidden = false;
            dateStrip.hidden = false;
            $('change-date').setAttribute('aria-expanded', 'true');
            $('time-block').hidden = true;
            refresh();
            const selected = dateStrip.querySelector('[aria-checked="true"]') || dateStrip.querySelector('.date-chip');
            if (selected) selected.focus();
        });

        dateStrip.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const dates = Array.from(dateStrip.querySelectorAll('.date-chip'));
            const index = dates.indexOf(event.target);
            if (index < 0) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? dates.length - 1
                : Math.max(0, Math.min(dates.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
            dates[next].focus();
            dates[next].click();
        });

        async function chooseDate(iso, restoring) {
            if (!restoring && pick.date !== iso) pick.time = null;
            pick.date = iso;
            datePickerOpen = false;
            dateStrip.querySelectorAll('[role="radio"]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.value === iso)));
            dateStrip.querySelectorAll('[role="radio"]').forEach(el => { el.tabIndex = el.dataset.value === iso ? 0 : -1; });
            const chip = dateStrip.querySelector('[data-value="' + iso + '"]');
            if (chip) {
                // Slide only the strip; scrollIntoView would also scroll the page.
                const left = chip.offsetLeft - dateStrip.offsetLeft;
                if (left < dateStrip.scrollLeft || left + chip.offsetWidth > dateStrip.scrollLeft + dateStrip.clientWidth) {
                    dateStrip.scrollLeft = left - 8;
                }
                $('date-month').textContent = parseIsoDate(iso).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            }
            $('selected-date-label').textContent = parseIsoDate(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            $('selected-date').hidden = false;
            $('pick-date').hidden = true;
            dateStrip.hidden = true;
            $('change-date').setAttribute('aria-expanded', 'false');
            document.body.classList.add('date-picked');
            if (!restoring) $('change-date').focus();
            releaseIfStale();
            setStatus(statusEl, '');
            refresh();

            $('time-block').hidden = false;
            if (!restoring) $('time-block').scrollTop = 0;
            slotsWrap.innerHTML = '<p class="booking-slots-loading">Finding open times…</p>';
            const request = ++dateRequest;
            const results = await Promise.all(candidates.map((s) =>
                get('/api/availability', { service_id: s.id, staff_id: state.staffId, date: iso })
                    .then((slots) => [s.id, (Array.isArray(slots) ? slots : []).map(slotMinutes).filter((m) => m >= 0)])
                    .catch(() => [s.id, []])
            ));
            if (request !== dateRequest) return; // a newer date was picked meanwhile
            results.forEach(([id, mins]) => { slotsByService[id] = mins; });

            // Half-hour start times only (10:00, 10:30 ...).
            const open = new Set();
            results.forEach(([, mins]) => mins.filter((m) => m % 30 === 0).forEach((m) => open.add(m)));
            // Our own held time is hidden from availability (holds hide times from everyone) - keep it.
            if (hold && hold.until > Date.now() && hold.staffId === String(state.staffId) && hold.date === iso) open.add(slotMinutes(hold.time));
            times = Array.from(open).sort((a, b) => a - b);
            if (pick.time && !times.includes(slotMinutes(pick.time))) pick.time = null;
            renderTimes();
            refresh();
        }

        // -- 2. Time ----------------------------------------------------
        const GROUPS = [
            ['Morning', (m) => m < 12 * 60, '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"></path>'],
            ['Afternoon', (m) => m >= 12 * 60 && m < 17 * 60, '<circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>'],
            ['Evening', (m) => m >= 17 * 60, '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>']
        ];

        function renderTimes() {
            if (!times.length) {
                slotsWrap.innerHTML = '<p class="booking-slots-empty">No open times on ' + escapeHtml(shortDate(pick.date)) + '.</p>' +
                    '<button type="button" class="link-btn" id="slots-next-day">Try the next day &rarr;</button>';
                $('slots-next-day').addEventListener('click', () => {
                    const d = parseIsoDate(pick.date);
                    d.setDate(d.getDate() + 1);
                    const iso = localIso(d);
                    if (dateStrip.querySelector('[data-value="' + iso + '"]')) chooseDate(iso);
                });
                return;
            }
            const current = pick.time ? slotMinutes(pick.time) : -1;
            slotsWrap.innerHTML = GROUPS.map(([label, test, icon]) => {
                const inGroup = times.filter(test);
                if (!inGroup.length) return '';
                return '<div class="slot-group">' +
                    '<p class="slot-group-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icon + '</svg>' + label + '</p>' +
                    '<div class="booking-slots">' + inGroup.map((m) =>
                        '<button type="button" class="booking-slot' + (m === current ? ' selected' : '') + '" aria-pressed="' + String(m === current) + '" data-value="' + m + '">' + escapeHtml(niceTime(slotLabel(m))) + '</button>'
                    ).join('') + '</div></div>';
            }).join('');
            slotsWrap.querySelectorAll('.booking-slot').forEach((btn) => {
                btn.addEventListener('click', () => chooseTime(Number(btn.dataset.value), btn));
            });
        }

        async function holdFor(service, time) {
            const { res, data } = await post('/api/slots/hold', {
                session_token: state.token,
                hold_token: hold && hold.token,
                service_id: service.id,
                staff_id: state.staffId,
                date: pick.date,
                time
            });
            if (handleAuthError(res, data)) return null;
            if (!res.ok || !data.held) return { error: data.error || 'That time is no longer available. Please pick another.' };
            hold = {
                staffId: String(state.staffId),
                date: pick.date,
                time,
                until: data.held_until || Date.now() + (data.hold_minutes || 10) * 60 * 1000,
                token: data.hold_token || null
            };
            save({ hold });
            return { ok: true };
        }

        async function chooseTime(minutes, btn) {
            if (holding) return;
            const time = slotLabel(minutes);
            const service = pick.service;
            if (!service) return;

            holding = true;
            slotsWrap.querySelectorAll('.booking-slot').forEach((el) => {
                el.classList.remove('selected');
                el.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('selected', 'holding');
            btn.setAttribute('aria-pressed', 'true');
            pick.time = time;
            setStatus(statusEl, '');
            footerSummary.textContent = 'Holding ' + niceTime(time) + ' for you…';
            nextBtn.disabled = true;
            try {
                const result = await holdFor(service, time);
                if (!result) return;
                if (result.error) {
                    pick.time = null;
                    await chooseDate(pick.date, true);
                    setStatus(statusEl, result.error, 'error');
                    return;
                }
            } catch (err) {
                pick.time = null;
                btn.classList.remove('selected');
                btn.setAttribute('aria-pressed', 'false');
                setStatus(statusEl, 'Network error, please tap the time again.', 'error');
            } finally {
                btn.classList.remove('holding');
                holding = false;
                refresh();
            }
        }

        async function confirmRebook() {
            nextBtn.disabled = true;
            nextBtn.textContent = 'Booking…';
            setStatus(statusEl, 'Booking your new time…');
            try {
                const { res, data } = await post('/api/payment/rebook', {
                    session_token: state.token,
                    order_id: state.rebookOrderId,
                    staff_id: state.staffId,
                    hold_token: hold && hold.token,
                    date: pick.date,
                    time: pick.time
                });
                if (handleAuthError(res, data)) return;
                if (res.ok && data.success) {
                    save({ date: pick.date, time: pick.time, rebookOrderId: null, hold: null });
                    go(PATHS.confirmation + '?booking=success');
                    return;
                }
                setStatus(statusEl, data.error || 'That time could not be booked. Please choose another time.', 'error');
                if (data.slot_conflict) {
                    pick.time = null;
                    hold = null;
                    save({ hold: null });
                    chooseDate(pick.date, true);
                }
            } catch (err) {
                setStatus(statusEl, 'Network error, please try again.', 'error');
            }
            nextBtn.textContent = 'Confirm new time';
            refresh();
        }

        nextBtn.addEventListener('click', () => {
            if (!(pick.date && pick.time && pick.service && holdMatchesPick())) {
                setStatus(statusEl, 'Please choose a date and time.', 'error');
                return;
            }
            if (rebook) {
                confirmRebook();
                return;
            }
            save({
                serviceId: pick.service.id,
                serviceName: pick.service.name,
                price: Number(pick.service.price) || 0,
                currency: pick.service.currency || 'INR',
                duration: serviceMinutes(pick.service),
                date: pick.date,
                time: pick.time
            });
            go(PATHS.details);
        });

        (async () => {
            try {
                const all = await get('/api/services', { staff_id: state.staffId });
                // The plan chosen on /book/plan/ (or, rebooking, the one already paid for).
                candidates = all.filter((sv) => String(sv.id) === String(state.serviceId) && offeredBy(sv, state.staffId));
            } catch (err) {
                setStatus(statusEl, 'Could not load sessions right now. Please try again shortly or book on WhatsApp.', 'error');
                return;
            }
            if (!candidates.length) {
                if (!rebook) {
                    window.location.replace(PATHS.plan);
                    return;
                }
                $('date-block').hidden = true;
                setStatus(statusEl, 'This session is no longer open for online booking. Please message us on WhatsApp.', 'error');
                return;
            }
            pick.service = candidates[0];
            renderDates();
        })();
    }

    // -----------------------------------------------------------------
    // Step 4: /book/details/
    // -----------------------------------------------------------------

    function initDetails() {
        const state = guard([[['sessionType'], PATHS.type], [SCHEDULE_KEYS.filter((k) => k !== 'price'), PATHS.schedule]]);
        if (!state) return;
        renderStepper(5);
        showHoldBanner(state);
        // A time is picked: from here on the booking can be resumed from the home page.
        if (!state.rebookOrderId) saveDraft(state);

        $('details-phone').value = (state.phone || '').replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
        $('details-name').value = state.name || '';
        $('details-email').value = state.email || '';
        $('details-notes').value = state.notes || '';
        $('details-when').textContent = state.serviceName + ' · ' + longDate(state.date) + ', ' + String(state.time).replace(/^0/, '');
        $('details-change-number').addEventListener('click', () => {
            signOut();
            go(PATHS.verify);
        });

        $('details-form').addEventListener('submit', (event) => {
            event.preventDefault();
            const statusEl = $('details-status');
            const name = $('details-name').value.trim();
            const email = $('details-email').value.trim();
            if (!name) {
                setStatus(statusEl, 'Please enter your full name.', 'error');
                $('details-name').focus();
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setStatus(statusEl, 'Please enter a valid email address.', 'error');
                $('details-email').focus();
                return;
            }
            const next = save({ name, email, notes: $('details-notes').value.trim(), hp: $('details-hp').value });
            saveAuthName(name);
            if (!next.rebookOrderId) saveDraft(next);
            go(PATHS.checkout);
        });
    }

    // -----------------------------------------------------------------
    // Step 5: /book/checkout/
    // -----------------------------------------------------------------

    function initCheckout() {
        const state = guard([
            [['sessionType'], PATHS.type],
            [SCHEDULE_KEYS.filter((k) => k !== 'price'), PATHS.schedule],
            [['name', 'email'], PATHS.details]
        ]);
        if (!state) return;
        renderStepper(6);
        showHoldBanner(state);
        if (!state.rebookOrderId) saveDraft(state);

        const date = parseIsoDate(state.date);
        const sessionCount = packageSessions(state.serviceName) || 1;
        const checkoutProfiles = [{"slug":"rashin","name":"Rashin PK","role":"Consultant Psychologist","photo":"assets/rashin.webp"},{"slug":"theresa","name":"Theresa P Thomas","role":"Consultant Psychologist","photo":"assets/theresa.webp"},{"slug":"christine","name":"Christine","role":"Consultant Psychologist","photo":"assets/christine.webp"},{"slug":"jasmin","name":"Jasmin","role":"Consultant Psychologist","photo":"assets/jasmin.webp"},{"slug":"fathima","name":"Fathima Sidhyc","role":"Consultant Psychologist","photo":"assets/fathima.webp"},{"slug":"ansha","name":"Ansha","role":"Psychologist","photo":"assets/ansha.webp"}];
        const profileSlug = String(state.staffProfile || '').replace(/^\//, '').replace(/\.html$/, '') || firstName(state.staffName);
        const profile = checkoutProfiles.find(item => item.slug === profileSlug || (profileSlug === 'rishin' && item.slug === 'rashin'));
        $('review-therapist').textContent = profile ? profile.name : state.staffName;
        $('review-role').textContent = profile ? profile.role : 'Your therapist';
        if (profile) {
            const photo = $('review-photo');
            photo.addEventListener('error', () => { photo.hidden = true; $('review-photo-fallback').hidden = false; });
            photo.src = '/' + profile.photo;
            photo.hidden = false;
            $('review-photo-fallback').hidden = true;
        }
        $('review-service').textContent = state.sessionType === 'couple' ? 'Couple therapy' : 'Individual therapy';
        $('review-sessions').textContent = sessionCount + (sessionCount === 1 ? ' session' : ' sessions');
        $('review-price').textContent = state.creditMode ? 'Prepaid' : money(state.price, state.currency);
        $('review-date').textContent = date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : state.date;
        const timeParts = String(state.time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        let timeDescription = String(state.time).replace(/^0/, '');
        if (timeParts && Number(state.duration) > 0) {
            const start = (Number(timeParts[1]) % 12 + (timeParts[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(timeParts[2]);
            const end = (start + Number(state.duration)) % 1440;
            timeDescription += ' – ' + (Math.floor(end / 60) % 12 || 12) + ':' + String(end % 60).padStart(2, '0') + (end >= 720 ? ' PM' : ' AM');
        }
        $('review-time').textContent = timeDescription;
        $('pay-session-count').textContent = sessionCount + (sessionCount === 1 ? ' session' : ' sessions');
        $('review-name').textContent = state.name;
        $('review-email').textContent = state.email;
        $('review-phone').textContent = state.phone;
        if (state.notes) {
            $('review-notes-row').hidden = false;
            $('review-notes').textContent = state.notes;
        }

        const payBtn = $('pay-btn');
        const statusEl = $('pay-status');
        const prepaid = Boolean(state.creditMode);
        const free = !prepaid && !(Number(state.price) > 0);

        $('pay-fee').textContent = prepaid ? 'Prepaid' : money(state.price, state.currency);
        $('pay-total').textContent = prepaid || free ? money(0, state.currency) : money(state.price, state.currency);

        if (prepaid) {
            $('pay-heading').textContent = 'Covered by your package';
            $('pay-credit-line').hidden = false;
            $('pay-credit-left').textContent = state.credits;
            $('pay-online-info').hidden = true;
            payBtn.textContent = 'Confirm booking';
        } else if (free) {
            $('pay-online-info').hidden = true;
            payBtn.textContent = 'Confirm booking';
        } else {
            payBtn.textContent = 'Agree & Pay';
        }
        if (sessionCount > 1 && !prepaid && !free) {
            // Savings are derived from the same therapist's real single-session catalogue, never a fixed offer.
            get('/api/services', { staff_id: state.staffId }).then(services => {
                const singles = bookableServices(services, state.staffId, state).filter(service => !isPackage(service.name)
                    && (service.currency || 'INR') === (state.currency || 'INR') && Number(service.price) > 0);
                if (!singles.length) return;
                const original = Math.min(...singles.map(service => Number(service.price))) * sessionCount;
                if (original > Number(state.price)) {
                    $('pay-original').textContent = money(original, state.currency);
                    $('pay-original').hidden = false;
                }
            }).catch(() => {});
        }
        const idleLabel = payBtn.textContent;
        const consent = $('pay-consent');
        consent.addEventListener('change', () => consent.parentElement.classList.remove('needs-attention'));

        const booking = {
            staff_name: state.staffName,
            session_token: state.token,
            service_id: state.serviceId,
            staff_id: state.staffId,
            date: state.date,
            time: state.time,
            name: state.name,
            email: state.email,
            notes: state.notes || '',
            hp_confirm: state.hp || '',
            hold_token: state.hold && state.hold.token,
            // One key per visit to this page: a retry of the same click never books twice,
            // while a changed time or plan (a new visit) always makes a fresh booking.
            attempt_key: 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12),
            resume_booking_id: state.resumeBookingId || undefined
        };

        function fail(res, data) {
            if (handleAuthError(res, data)) return;
            if (res.status === 409 || data.slot_conflict) {
                clearFrom(['time']);
                setStatus(statusEl, (data.error || 'That time was just booked by someone else.') + ' Taking you back to pick another time…', 'error');
                setTimeout(() => go(PATHS.schedule), 2500);
                return;
            }
            setStatus(statusEl, data.error || 'Something went wrong. Please try again or book via WhatsApp.', 'error');
        }

        async function bookWithoutPayment(endpoint) {
            const { res, data } = await post(endpoint, booking);
            if (!res.ok) {
                fail(res, data);
                return;
            }
            go(PATHS.confirmation + '?booking=success' + (prepaid ? '&mode=prepaid' : ''));
        }

        function idle() {
            payBtn.disabled = false;
            payBtn.textContent = idleLabel;
        }

        async function confirmPayment(response) {
            const paymentId = encodeURIComponent(response.razorpay_payment_id);
            payBtn.textContent = 'Booking your session…';
            setStatus(statusEl, 'Payment received. Booking your session, please keep this page open.');
            // Retrying is safe: the server never books the same payment twice.
            const waits = [0, 2000, 4000, 8000];
            let last = {};
            for (const wait of waits) {
                if (wait) await new Promise((r) => setTimeout(r, wait));
                try {
                    const { res, data } = await post('/api/payment/verify', {
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature
                    });
                    if (res.ok && data.success) {
                        go(PATHS.confirmation + '?booking=success');
                        return;
                    }
                    last = data;
                    if (data.needs_rebook) {
                        save({ rebookOrderId: data.order_id, date: null, time: null, hold: null });
                        go(PATHS.confirmation + '?booking=rebook&payment=' + paymentId);
                        return;
                    }
                } catch (err) {
                    last = { network: true };
                }
            }
            go(PATHS.confirmation + '?booking=error&payment=' + paymentId);
        }

        /** Opens Razorpay Checkout on this page. The slot is booked only after payment (see confirmPayment). */
        async function payOnline() {
            if (typeof Razorpay === 'undefined') {
                setStatus(statusEl, 'Secure payment could not load. Please refresh the page or book via WhatsApp.', 'error');
                idle();
                return;
            }
            setStatus(statusEl, 'Opening secure payment…');
            const { res, data } = await post('/api/payment/create-order', booking);
            if (res.ok && data.booked) {
                // Covered by the client's package or wallet: nothing to pay.
                go(PATHS.confirmation + '?booking=success' + (prepaid ? '&mode=prepaid' : ''));
                return;
            }
            if (!res.ok) {
                if (data.free) {
                    await bookWithoutPayment('/api/book');
                } else {
                    fail(res, data);
                }
                idle();
                return;
            }

            let lastFailure = '';
            const checkout = new Razorpay({
                key: data.key_id,
                order_id: data.order_id,
                amount: data.amount,
                currency: data.currency,
                name: 'Mindlap',
                description: data.service_name || state.serviceName,
                image: window.location.origin + '/assets/icon-192.png',
                prefill: data.prefill,
                theme: { color: '#4A2E80' },
                handler: confirmPayment,
                modal: {
                    ondismiss: () => {
                        // Records the attempt as Failed in Creator (fire and forget).
                        post('/api/payment/abandon', {
                            session_token: state.token,
                            order_id: data.order_id,
                            reason: lastFailure ? 'failed' : 'cancelled',
                            message: lastFailure
                        }).catch(() => {});
                        setStatus(statusEl, lastFailure
                            ? 'Payment failed: ' + lastFailure + '. Nothing was booked, you can try again.'
                            : 'Payment cancelled. Nothing was booked or charged, you can try again.', 'error');
                        idle();
                    }
                }
            });
            // Razorpay keeps the window open after a decline so the customer can retry;
            // only a close (ondismiss) ends the attempt.
            checkout.on('payment.failed', (response) => {
                lastFailure = (response && response.error && response.error.description) || 'declined';
                setStatus(statusEl, 'Payment failed: ' + lastFailure + '. You can try again.', 'error');
            });
            setStatus(statusEl, '');
            payBtn.textContent = 'Complete payment in the Razorpay window…';
            checkout.open();
        }

        payBtn.addEventListener('click', async () => {
            if (!consent.checked) {
                consent.parentElement.classList.add('needs-attention');
                consent.focus();
                setStatus(statusEl, 'Please tick the box to agree to the Terms & Conditions and Privacy Policy.', 'error');
                return;
            }
            payBtn.disabled = true;
            try {
                if (prepaid) {
                    setStatus(statusEl, 'Booking with your prepaid session…');
                    await bookWithoutPayment('/api/credits/book');
                    idle();
                    return;
                }
                if (free) {
                    setStatus(statusEl, 'Booking your session…');
                    await bookWithoutPayment('/api/book');
                    idle();
                    return;
                }
                await payOnline();
            } catch (err) {
                setStatus(statusEl, 'Network error, please try again.', 'error');
                idle();
            }
        });
    }

    // -----------------------------------------------------------------
    // /book/confirmation/?booking=success|rebook|waiting|cancelled|error
    // -----------------------------------------------------------------

    const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    const INFO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

    const OUTCOMES = {
        success: {
            icon: 'success', title: "You're booked!",
            text: 'Your session is confirmed. A confirmation email with the details is on its way.',
            actions: [['Back to home', '/', 'btn-primary']]
        },
        prepaid: {
            icon: 'success', title: "You're booked!",
            text: 'Your session is confirmed using one of your prepaid sessions. A confirmation email with the details is on its way.',
            actions: [['Back to home', '/', 'btn-primary']]
        },
        cancelled: {
            icon: 'warn', title: 'Payment not completed',
            text: 'Nothing was booked or charged. Your details are saved, so you can try the payment again.',
            actions: [['Try payment again', PATHS.checkout, 'btn-primary'], ['Change time', PATHS.schedule, 'btn-secondary']]
        },
        rebook: {
            icon: 'warn', title: 'Payment successful - please choose a new time',
            text: "Your payment went through, but we couldn't book that time (it was taken moments before you). Choose a new date and time - you won't be charged again.",
            actions: [['Choose a new time', PATHS.schedule, 'btn-primary'], ['Message us on WhatsApp', WHATSAPP_URL, 'btn-secondary']]
        },
        waiting: {
            icon: 'warn', title: 'You have a paid session waiting',
            text: "You've already paid for a session that still needs a date and time. Choose one now - no payment needed.",
            actions: [['Choose a time', PATHS.schedule, 'btn-primary'], ['Message us on WhatsApp', WHATSAPP_URL, 'btn-secondary']]
        },
        error: {
            icon: 'warn', title: 'Something went wrong',
            text: "We couldn't confirm your booking automatically. If money was taken, message us on WhatsApp and we'll sort it out right away.",
            actions: [['Message us on WhatsApp', WHATSAPP_URL, 'btn-primary'], ['Back to home', '/', 'btn-secondary']]
        }
    };

    function initConfirmation() {
        const params = new URLSearchParams(window.location.search);
        let key = params.get('booking');
        if (key === 'success' && params.get('mode') === 'prepaid') key = 'prepaid';
        const outcome = OUTCOMES[key];
        if (!outcome) {
            go(PATHS.verify);
            return;
        }

        const state = load();
        const payment = params.get('payment');
        // Booked (or paid and waiting for a time): nothing left to resume.
        if (['success', 'prepaid', 'rebook', 'waiting'].includes(key)) clearDraft();

        $('result-icon').className = 'result-icon ' + outcome.icon;
        $('result-icon').innerHTML = outcome.icon === 'success' ? CHECK_ICON : INFO_ICON;
        $('result-title').textContent = outcome.title;
        $('result-text').textContent = outcome.text + (payment && key !== 'success' ? ' Payment ID: ' + payment : '');
        document.title = outcome.title + ' | Mindlap';

        if ((key === 'rebook' || key === 'waiting') && state.serviceName) {
            const summary = $('result-summary');
            summary.hidden = false;
            summary.innerHTML = '<dl class="review-list">' +
                '<dt>Session</dt><dd>' + escapeHtml(state.serviceName) + '</dd>' +
                '<dt>Therapist</dt><dd>' + escapeHtml(state.staffName || '') + '</dd>' +
                '<dt>Paid</dt><dd>' + escapeHtml(money(state.price, state.currency)) + '</dd>' +
                '</dl>';
        } else if (state.serviceName && state.date && state.time) {
            const summary = $('result-summary');
            summary.hidden = false;
            summary.innerHTML = '<dl class="review-list">' +
                '<dt>Session</dt><dd>' + escapeHtml(state.serviceName) + '</dd>' +
                '<dt>When</dt><dd>' + escapeHtml(longDate(state.date) + ' at ' + state.time) + '</dd>' +
                '<dt>Therapist</dt><dd>' + escapeHtml(state.staffName || '') + '</dd>' +
                (state.email ? '<dt>Email</dt><dd>' + escapeHtml(state.email) + '</dd>' : '') +
                '</dl>';
        }

        $('result-actions').innerHTML = outcome.actions.map(([label, href, cls]) =>
            '<a class="btn btn-lg ' + cls + '" href="' + escapeHtml(href) + '"' +
            (href.startsWith('http') ? ' target="_blank" rel="noopener"' : '') + '>' + escapeHtml(label) + '</a>'
        ).join('');

        if (key === 'success' || key === 'prepaid') {
            // Booking finished: keep the verification (so a second booking
            // skips OTP) but clear what was booked.
            clearFrom(SCHEDULE_KEYS.concat(['notes', 'hp', 'creditMode', 'sessionType', 'credits', 'rebookOrderId', 'resumeBookingId', 'hold']));
        }
    }

    // -----------------------------------------------------------------
    // /account/ - logged-in customer: sessions, prepaid credits (log out lives in the profile badge)
    // -----------------------------------------------------------------

    async function initAccount() {
        const state = load();
        if (!tokenValid(state.token)) {
            window.location.replace(PATHS.verify + '?next=account');
            return;
        }
        const account = await loadAccount(state.token);
        if (!account) return;
        if (account.known) saveAuthAccount(account.hasAccount, account.name);
        if (account.known && !account.hasAccount) {
            // New client: nothing booked and no prepaid sessions yet.
            window.location.replace('/?welcome=new#therapists');
            return;
        }

        const data = account.data;
        const name = loadAuth().name || (data && data.customer && data.customer.name);
        $('account-greeting').textContent = name ? 'Hi, ' + name : 'Hi there';

        if (account.wallet > 0) {
            const box = $('account-wallet');
            box.hidden = false;
            box.querySelector('[data-wallet]').textContent = money(account.wallet, 'INR');
        }

        if (account.credits > 0) {
            const box = $('account-credits');
            box.hidden = false;
            box.querySelector('[data-credits]').textContent = account.credits;
            box.querySelector('[data-credits-label]').textContent = account.credits === 1 ? 'prepaid session left' : 'prepaid sessions left';
        }

        const sessionsEl = $('account-sessions');
        if (!data) {
            sessionsEl.innerHTML = '<p class="booking-slots-empty">Could not load your sessions right now. Please try again shortly.</p>';
            return;
        }

        const MONTH_INDEX = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
        const parse = (zohoDate) => {
            const [dd, mon, yyyy] = String(zohoDate || '').split('-');
            return MONTH_INDEX[mon] === undefined ? null : new Date(Number(yyyy), MONTH_INDEX[mon], Number(dd));
        };
        const clock = (hhmm) => {
            const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
            if (!m) return '';
            const h = Number(m[1]);
            return (h % 12 || 12) + ':' + m[2] + (h >= 12 ? ' pm' : ' am');
        };
        const statusClass = (status) => {
            const st = String(status || '').toLowerCase();
            return /cancel|no ?show|fail/.test(st) ? 'muted' : /complete/.test(st) ? 'done' : 'ok';
        };

        const card = (sess) => {
            const d = parse(sess.date);
            const tile = d
                ? '<span class="month">' + d.toLocaleDateString('en-IN', { month: 'short' }) + '</span>' +
                  '<span class="day">' + d.getDate() + '</span>' +
                  '<span class="dow">' + d.toLocaleDateString('en-IN', { weekday: 'short' }) + '</span>'
                : '<span class="day">?</span>';
            const meta = [clock(sess.start_time), sess.service_name].filter(Boolean).map(escapeHtml).join('<span class="dot">·</span>');
            return '<li class="account-session">' +
                '<div class="account-date">' + tile + '</div>' +
                '<div class="account-session-main">' +
                    '<strong>' + escapeHtml(sess.therapist_name || 'Your therapist') + '</strong>' +
                    '<span class="account-meta">' + meta + '</span>' +
                    (sess.amount > 0 ? '<span class="account-amount">' + escapeHtml(money(sess.amount, 'INR')) + '</span>' : '') +
                '</div>' +
                '<span class="account-badge ' + statusClass(sess.booking_status) + '">' + escapeHtml(sess.booking_status || '') + '</span>' +
            '</li>';
        };

        const groups = {
            upcoming: data.upcoming || [],
            past: data.past || [],
            all: (data.upcoming || []).concat(data.past || [])
        };
        const empty = {
            upcoming: 'No upcoming sessions. <a href="/#therapists">Book a session</a>',
            past: 'No past sessions yet.',
            all: 'No sessions yet.'
        };
        const tabs = $('account-tabs');
        const show = (key) => {
            tabs.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === key)));
            sessionsEl.innerHTML = groups[key].length
                ? '<ul class="account-list">' + groups[key].map(card).join('') + '</ul>'
                : '<p class="account-empty">' + empty[key] + '</p>';
        };
        tabs.querySelectorAll('[data-tab]').forEach((b) => {
            const n = groups[b.dataset.tab].length;
            b.querySelector('.count').textContent = n;
            b.addEventListener('click', () => show(b.dataset.tab));
        });
        tabs.hidden = false;
        show(groups.upcoming.length ? 'upcoming' : 'past');
    }

    // -----------------------------------------------------------------

    const PAGES = {
        verify: initVerify,
        credits: initCredits,
        type: initType,
        plan: initPlan,
        schedule: initSchedule,
        details: initDetails,
        checkout: initCheckout,
        confirmation: initConfirmation,
        account: initAccount
    };

    /**
     * Logged in: the profile badge (same look as the home page) goes in the top bar, and Log out lives in its menu.
     * Log out appears nowhere else on the site.
     */
    function renderProfileBadge() {
        const auth = loadAuth();
        const links = document.querySelector('.book-topbar-links');
        if (!auth.token || !links) return;
        const name = String(auth.name || '').trim();
        const initials = name ? name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase() : '';
        const avatar = initials ||
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"></path></svg>';
        const wrap = document.createElement('div');
        wrap.className = 'account-menu';
        wrap.innerHTML =
            '<button type="button" class="account-avatar" aria-haspopup="true" aria-expanded="false" aria-label="Your account">' + avatar + '</button>' +
            '<div class="account-panel" hidden>' +
                '<div class="account-panel-avatar">' + avatar + '</div>' +
                (name ? '<p class="account-panel-name">' + escapeHtml(name) + '</p>' : '') +
                '<p class="account-panel-phone">' + escapeHtml(String(auth.phone || '').replace(/[^+\d]/g, '')) + '</p>' +
                (auth.account === true ? '<a class="account-panel-link" href="' + PATHS.account + '">View bookings<span aria-hidden="true">&rsaquo;</span></a>' : '') +
                '<button type="button" class="account-panel-logout">Log out</button>' +
            '</div>';
        links.appendChild(wrap);
        const toggle = wrap.querySelector('.account-avatar');
        const panel = wrap.querySelector('.account-panel');
        const setOpen = (open) => {
            panel.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
        };
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(panel.hidden);
        });
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
        wrap.querySelector('.account-panel-logout').addEventListener('click', () => {
            signOut();
            clearDraft();
            window.location.href = '/';
        });
    }

    // Set to true to pause online booking (everyone books on WhatsApp).
    const ONLINE_BOOKING_PAUSED = false;

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.body.getAttribute('data-page');
        renderProfileBadge();
        const finishingPaidSession = page === 'schedule' && load().rebookOrderId;
        if (ONLINE_BOOKING_PAUSED && page !== 'confirmation' && !finishingPaidSession) {
            window.location.replace('/');
            return;
        }
        if (page !== 'verify' && page !== 'confirmation' && page !== 'account') renderSummary(load());
        const init = PAGES[page];
        if (init) init();
    });
})();

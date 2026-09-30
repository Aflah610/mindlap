/* -------------------------------------------------------------
   Mindlap - Book Online, one page per step:
     /book/               verify phone (WhatsApp OTP)
     /book/credits/       prepaid sessions found (Zoho CRM)
     /book/therapist/     choose a therapist (skipped when coming from a profile)
     /book/session-type/  individual or couple
     /book/schedule/      date, time, then single session or package
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
        therapist: '/book/therapist/',
        type: '/book/session-type/',
        schedule: '/book/schedule/',
        details: '/book/details/',
        checkout: '/book/checkout/',
        confirmation: '/book/confirmation/'
    };

    // -----------------------------------------------------------------
    // State
    // -----------------------------------------------------------------

    function load() {
        try {
            return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {};
        } catch (err) {
            return {};
        }
    }

    function save(patch) {
        const next = Object.assign(load(), patch);
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

    function signOut() {
        try {
            sessionStorage.removeItem(STORE_KEY);
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
        const typeLabel = state.creditMode ? 'Prepaid session'
            : state.sessionType === 'couple' ? 'Couple therapy'
                : state.sessionType === 'individual' ? 'Individual therapy' : '';
        const rows = [
            ['Type', typeLabel],
            ['Session', state.serviceName],
            ['Therapist', state.staffName],
            ['When', state.date && state.time ? shortDate(state.date) + ', ' + String(state.time).replace(/^0/, '') : '']
        ].filter(([, value]) => value);
        let total = '';
        if (state.creditMode && state.serviceName) total = 'Prepaid';
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
        const labels = ['Verify', 'Therapist', 'Session', 'Date & time', 'Details', 'Payment'];
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

        const wanted = new URLSearchParams(window.location.search).get('therapist');
        if (wanted) save({ preferredTherapist: wanted.slice(0, 60) });

        const state = load();
        if (tokenValid(state.token)) {
            routeAfterVerify(state.token);
            return;
        }

        const phoneStep = $('otp-phone-step');
        const codeStep = $('otp-code-step');
        const phoneInput = $('otp-phone');
        const countrySelect = $('otp-country');
        const codeInput = $('otp-code');
        const sendBtn = $('otp-send-btn');
        const verifyBtn = $('otp-verify-btn');
        const resendBtn = $('otp-resend-btn');
        const changeBtn = $('otp-change-btn');
        const statusEl = $('otp-status');
        const sentTo = $('otp-sent-to');
        let resendTimer = null;
        let verifying = false;

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
            resendBtn.textContent = 'Resend code (' + left + 's)';
            clearInterval(resendTimer);
            resendTimer = setInterval(() => {
                left -= 1;
                if (left <= 0) {
                    clearInterval(resendTimer);
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend code';
                } else {
                    resendBtn.textContent = 'Resend code (' + left + 's)';
                }
            }, 1000);
        }

        function showCodeStep() {
            phoneStep.hidden = true;
            codeStep.hidden = false;
            sentTo.textContent = fullPhone();
            codeInput.value = '';
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
                        showCodeStep();
                        setStatus(statusEl, (data.error || "We couldn't deliver the code on WhatsApp.") +
                            ' If you already have a code, enter it below, or tap Resend in a minute.', 'error');
                    } else {
                        setStatus(statusEl, data.error || 'Could not send code.', 'error');
                    }
                    return;
                }
                showCodeStep();
                setStatus(statusEl, 'Code sent on WhatsApp.', 'success');
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
                save({ token: data.session_token, phone: data.phone || fullPhone(), preferredTherapist });
                setStatus(statusEl, 'Verified! Checking for prepaid sessions…', 'success');
                await routeAfterVerify(data.session_token);
            } catch (err) {
                setStatus(statusEl, 'Network error, please try again.', 'error');
            } finally {
                verifying = false;
                verifyBtn.disabled = false;
            }
        }

        countrySelect.addEventListener('change', () => {
            phoneInput.maxLength = countrySelect.value === '+91' ? 14 : 20;
        });
        sendBtn.addEventListener('click', () => send(false));
        phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(false); });
        resendBtn.addEventListener('click', () => send(true));
        verifyBtn.addEventListener('click', verify);
        codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
        codeInput.addEventListener('input', () => {
            if (codeInput.value.replace(/\D/g, '').length === 6) verify();
        });
        changeBtn.addEventListener('click', () => {
            clearInterval(resendTimer);
            codeStep.hidden = true;
            phoneStep.hidden = false;
            setStatus(statusEl, '');
            phoneInput.focus();
        });
    }

    /** Prepaid credits (Zoho CRM) decide the next page. A failed check falls back to the normal flow. */
    async function routeAfterVerify(token) {
        try {
            const { res, data } = await post('/api/credits/check', { session_token: token });
            if (handleAuthError(res, data)) return;
            if (res.ok && data.has_credits && data.credits > 0) {
                save({ credits: data.credits });
                go(PATHS.credits);
                return;
            }
        } catch (err) { /* fall through */ }
        save({ credits: 0, creditMode: false });
        go(PATHS.therapist);
    }

    // -----------------------------------------------------------------
    // Step 2a: /book/credits/
    // -----------------------------------------------------------------

    function initCredits() {
        const state = guard();
        if (!state) return;
        if (!(state.credits > 0)) {
            go(PATHS.therapist);
            return;
        }
        renderStepper(1);
        showVerifiedChip(state);

        const n = state.credits;
        $('credits-count').textContent = n + ' prepaid session' + (n === 1 ? '' : 's');

        $('use-credits-btn').addEventListener('click', () => {
            save({ creditMode: true, sessionType: 'any' });
            clearFrom(['serviceId', 'serviceName', 'price', 'currency', 'duration', 'date', 'time']);
            go(PATHS.therapist);
        });
        $('pay-new-btn').addEventListener('click', () => {
            if (load().creditMode) clearFrom(['sessionType', 'serviceId', 'serviceName', 'price', 'currency', 'duration']);
            save({ creditMode: false });
            go(PATHS.therapist);
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
            return state.creditMode ? !isPackage(s.name) : type === state.sessionType;
        });
    }

    const PROFILE_PHOTOS = {
        anasooya: '/assets/anasooya.webp',
        athira: '/assets/athira_bg.jpeg',
        gouri: '/assets/gouri.webp',
        rashin: '/assets/rashin.webp',
        sajitha: '/assets/sajitha.webp',
        theresa: '/assets/theresa.webp'
    };

    function firstName(name) {
        return String(name || '').trim().split(/[\s-]+/)[0].toLowerCase();
    }

    function therapistPhoto(person) {
        if (/^https:\/\//.test(person.photo || '')) return person.photo;
        return PROFILE_PHOTOS[firstName(person.name)] || '';
    }

    function avatarHtml(person) {
        const photo = therapistPhoto(person);
        return '<span class="option-avatar">' +
            (photo ? '<img src="' + escapeHtml(photo) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
            escapeHtml(String(person.name || '?').trim().charAt(0).toUpperCase()) + '</span>';
    }

    // -----------------------------------------------------------------
    // Step 2: /book/therapist/
    // -----------------------------------------------------------------

    async function initTherapist() {
        const state = guard();
        if (!state) return;
        renderStepper(1);
        showVerifiedChip(state);

        const list = $('therapist-list');
        const statusEl = $('therapist-status');
        const note = $('therapist-note');

        let staff = [];
        let services = [];
        try {
            [staff, services] = await Promise.all([get('/api/staff'), get('/api/services')]);
        } catch (err) {
            list.innerHTML = '';
            setStatus(statusEl, 'Could not load therapists right now. Please try again shortly or book on WhatsApp.', 'error');
            return;
        }

        const offers = (person) => {
            const types = new Set(services
                .filter((s) => offeredBy(s, person.id) && serviceType(s.name) && (!state.creditMode || !isPackage(s.name)))
                .map((s) => serviceType(s.name)));
            return ['individual', 'couple'].filter((t) => types.has(t));
        };
        const bookable = staff.filter((p) => offers(p).length);

        function choose(person, skipHistory) {
            if (String(person.id) !== String(load().staffId)) clearFrom(SCHEDULE_KEYS.concat(['hold']));
            save({ staffId: String(person.id), staffName: person.name, staffPhoto: therapistPhoto(person), preferredTherapist: null });
            const next = state.creditMode ? PATHS.schedule : PATHS.type;
            if (skipHistory) window.location.replace(next);
            else go(next);
        }

        // Came from a therapist's profile page: continue with them if they can be booked online.
        const wanted = state.preferredTherapist;
        if (wanted) {
            const match = bookable.find((p) => firstName(p.name) === firstName(wanted));
            if (match) {
                choose(match, true);
                return;
            }
            save({ preferredTherapist: null });
            note.hidden = false;
            note.innerHTML = '<p>' + escapeHtml(wanted) + ' isn\'t available for online booking yet. Please choose another therapist below, or ' +
                '<a href="' + escapeHtml(WHATSAPP_URL) + '" target="_blank" rel="noopener">book with ' + escapeHtml(wanted) + ' on WhatsApp</a>.</p>';
        }

        if (!bookable.length) {
            list.innerHTML = '';
            setStatus(statusEl, 'No therapists are open for online booking right now. Please book on WhatsApp.', 'error');
            return;
        }

        const label = { individual: 'Individual', couple: 'Couple' };
        list.innerHTML = bookable.map((p) =>
            '<button type="button" class="option-card" role="radio" aria-checked="' + (String(p.id) === String(state.staffId)) + '" data-value="' + escapeHtml(p.id) + '">' +
                avatarHtml(p) +
                '<span class="option-body">' +
                    '<span class="option-title">' + escapeHtml(p.name) + '</span>' +
                    '<span class="option-meta">' + escapeHtml(p.designation || 'Psychologist') + '</span>' +
                    '<span class="option-tags">' + offers(p).map((t) => '<span>' + label[t] + '</span>').join('') + '</span>' +
                '</span>' +
            '</button>'
        ).join('');
        list.querySelectorAll('.option-card').forEach((card) => {
            card.addEventListener('click', () => choose(bookable.find((p) => String(p.id) === card.dataset.value)));
        });
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
            back.href = PATHS.therapist;
        }

        const cards = document.querySelectorAll('[data-session-type]');
        cards.forEach((card) => {
            if (card.getAttribute('data-session-type') === state.sessionType) card.classList.add('selected');
            card.addEventListener('click', () => {
                if (card.disabled) return;
                const type = card.getAttribute('data-session-type');
                if (type !== load().sessionType) clearFrom(['serviceId', 'serviceName', 'price', 'currency', 'duration']);
                save({ sessionType: type, creditMode: false });
                go(PATHS.schedule);
            });
        });

        // Grey out a type this therapist doesn't offer online.
        try {
            const services = await get('/api/services');
            cards.forEach((card) => {
                const type = card.getAttribute('data-session-type');
                const has = bookableServices(services, state.staffId, { sessionType: type }).length > 0;
                if (!has) {
                    card.disabled = true;
                    card.classList.add('unavailable');
                    card.querySelector('.session-type-desc').textContent = 'Not offered online by ' + state.staffName + '.';
                }
            });
        } catch (err) { /* leave both enabled; the next step explains if nothing is bookable */ }
    }

    // -----------------------------------------------------------------
    // Step 4: /book/schedule/ - date, then time, then session
    // -----------------------------------------------------------------

    function initSchedule() {
        const state = guard([[['staffId'], PATHS.therapist], [['sessionType'], PATHS.type]]);
        if (!state) return;
        renderStepper(3);
        showVerifiedChip(state);

        $('schedule-back').href = state.creditMode ? PATHS.therapist : PATHS.type;
        $('schedule-with').innerHTML = 'With <strong>' + escapeHtml(state.staffName) + '</strong> · ' +
            (state.creditMode ? 'prepaid session' : state.sessionType === 'couple' ? 'couple therapy' : 'individual therapy') +
            ' · online. <a href="' + PATHS.therapist + '">Change therapist</a>';
        if (state.creditMode) {
            const banner = $('credit-banner');
            banner.hidden = false;
            banner.querySelector('[data-credits]').textContent = state.credits;
        }

        const dateStrip = $('date-strip');
        const slotsWrap = $('booking-slots');
        const sessionList = $('session-list');
        const statusEl = $('schedule-status');
        const nextBtn = $('schedule-next');
        const footerSummary = $('schedule-summary');
        const DAYS_AHEAD = 30;

        let candidates = [];
        const slotsByService = {}; // serviceId -> minutes[] for the current date
        let times = []; // half-hour times (minutes) open for at least one candidate
        let dateRequest = 0;
        let holding = false;
        let hold = state.hold || null; // { staffId, date, time, until }
        const pick = { date: state.date || null, time: state.time || null, service: null };

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
                post('/api/slots/release', { session_token: state.token }).catch(() => {});
                hold = null;
                save({ hold: null });
            }
        }

        function refresh() {
            const ready = pick.date && pick.time && pick.service && holdMatchesPick();
            nextBtn.disabled = !ready || holding;
            if (ready) {
                const line = escapeHtml(pick.service.name) + (state.creditMode ? ' · prepaid' : ' · ' + money(pick.service.price, pick.service.currency));
                runHoldCountdown(hold.until, (left) => {
                    footerSummary.innerHTML = '<strong>' + escapeHtml(shortDate(pick.date) + ', ' + niceTime(pick.time)) + '</strong>' +
                        '<span class="hold-inline">Held for you · ' + clock(left) + '</span> ' + line;
                }, () => {
                    pick.time = null;
                    hold = null;
                    save({ hold: null });
                    setStatus(statusEl, 'Your 10-minute hold ended, so the time was released. Please pick a time again.', 'error');
                    renderTimes();
                    renderSessions();
                    refresh();
                });
            } else {
                clearInterval(holdTimer);
                footerSummary.textContent = !pick.date ? 'Pick a date to see open times.'
                    : !pick.time ? 'Pick a time.'
                        : !pick.service ? 'Choose your session.' : 'Holding your time…';
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
            dateStrip.querySelectorAll('.date-chip').forEach((chip) => {
                chip.addEventListener('click', () => chooseDate(chip.dataset.value));
            });
            const valid = pick.date && dateStrip.querySelector('[data-value="' + pick.date + '"]');
            chooseDate(valid ? pick.date : localIso(today), true);
        }

        async function chooseDate(iso, restoring) {
            if (!restoring && pick.date !== iso) {
                pick.time = null;
                pick.service = null;
            }
            pick.date = iso;
            dateStrip.querySelectorAll('[role="radio"]').forEach((el) => el.setAttribute('aria-checked', String(el.dataset.value === iso)));
            const chip = dateStrip.querySelector('[data-value="' + iso + '"]');
            if (chip) {
                // Slide only the strip; scrollIntoView would also scroll the page.
                const left = chip.offsetLeft - dateStrip.offsetLeft;
                if (left < dateStrip.scrollLeft || left + chip.offsetWidth > dateStrip.scrollLeft + dateStrip.clientWidth) {
                    dateStrip.scrollLeft = left - 8;
                }
                $('date-month').textContent = longDate(iso);
            }
            releaseIfStale();
            setStatus(statusEl, '');
            refresh();

            $('time-block').hidden = false;
            $('session-block').hidden = !pick.time;
            slotsWrap.innerHTML = '<p class="booking-slots-loading">Finding open times…</p>';
            const request = ++dateRequest;
            const results = await Promise.all(candidates.map((s) =>
                get('/api/availability', { service_id: s.id, staff_id: state.staffId, date: iso })
                    .then((slots) => [s.id, (Array.isArray(slots) ? slots : []).map(slotMinutes).filter((m) => m >= 0)])
                    .catch(() => [s.id, []])
            ));
            if (request !== dateRequest) return; // a newer date was picked meanwhile
            results.forEach(([id, mins]) => { slotsByService[id] = mins; });

            // Half-hour start times only (10:00, 10:30 ...), open for at least one session option.
            const open = new Set();
            results.forEach(([, mins]) => mins.filter((m) => m % 30 === 0).forEach((m) => open.add(m)));
            // Our own held time is hidden from availability (holds hide times from everyone) - keep it.
            if (hold && hold.until > Date.now() && hold.staffId === String(state.staffId) && hold.date === iso) open.add(slotMinutes(hold.time));
            times = Array.from(open).sort((a, b) => a - b);
            if (pick.time && !times.includes(slotMinutes(pick.time))) {
                pick.time = null;
                pick.service = null;
            }
            renderTimes();
            renderSessions();
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
                        '<button type="button" class="booking-slot' + (m === current ? ' selected' : '') + '" data-value="' + m + '">' + escapeHtml(niceTime(slotLabel(m))) + '</button>'
                    ).join('') + '</div></div>';
            }).join('');
            slotsWrap.querySelectorAll('.booking-slot').forEach((btn) => {
                btn.addEventListener('click', () => chooseTime(Number(btn.dataset.value), btn));
            });
        }

        /** Which session options can start at this time (own held time: let the server decide). */
        function openAt(minutes) {
            const ownHold = hold && hold.until > Date.now() && hold.date === pick.date && slotMinutes(hold.time) === minutes;
            return candidates.filter((s) => ownHold || (slotsByService[s.id] || []).includes(minutes));
        }

        async function holdFor(service, time) {
            const { res, data } = await post('/api/slots/hold', {
                session_token: state.token,
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
                until: data.held_until || Date.now() + (data.hold_minutes || 10) * 60 * 1000
            };
            save({ hold });
            return { ok: true };
        }

        async function chooseTime(minutes, btn) {
            if (holding) return;
            const time = slotLabel(minutes);
            const options = openAt(minutes);
            // Keep the session they already picked if it fits this time; otherwise hold with the first that does.
            const service = (pick.service && options.find((s) => s.id === pick.service.id)) || options[0];
            if (!service) return;

            holding = true;
            slotsWrap.querySelectorAll('.booking-slot').forEach((el) => el.classList.remove('selected'));
            btn.classList.add('selected', 'holding');
            pick.time = time;
            setStatus(statusEl, '');
            footerSummary.textContent = 'Holding ' + niceTime(time) + ' for you…';
            nextBtn.disabled = true;
            try {
                const result = await holdFor(service, time);
                if (!result) return;
                if (result.error) {
                    pick.time = null;
                    setStatus(statusEl, result.error, 'error');
                    chooseDate(pick.date, true);
                    return;
                }
                if (pick.service && !options.some((s) => s.id === pick.service.id)) pick.service = null;
                if (!pick.service && options.length === 1) pick.service = options[0];
                renderSessions();
                if (!pick.service) $('session-block').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (err) {
                pick.time = null;
                btn.classList.remove('selected');
                setStatus(statusEl, 'Network error, please tap the time again.', 'error');
            } finally {
                btn.classList.remove('holding');
                holding = false;
                refresh();
            }
        }

        // -- 3. Session (single or package) -------------------------------
        function renderSessions() {
            const block = $('session-block');
            if (!pick.time) {
                block.hidden = true;
                return;
            }
            block.hidden = false;
            const open = openAt(slotMinutes(pick.time)).map((s) => s.id);
            const ordered = candidates.slice().sort((a, b) => (isPackage(a.name) - isPackage(b.name)) || (Number(a.price) - Number(b.price)));
            sessionList.innerHTML = ordered.map((s) => {
                const available = open.includes(s.id);
                return '<button type="button" class="option-card' + (available ? '' : ' unavailable') + '" role="radio" aria-checked="' +
                    String(!!pick.service && pick.service.id === s.id) + '" data-value="' + escapeHtml(s.id) + '"' + (available ? '' : ' disabled') + '>' +
                    '<span class="option-body">' +
                        '<span class="option-kicker">' + (isPackage(s.name) ? 'Package' : 'Single session') + '</span>' +
                        '<span class="option-title">' + escapeHtml(s.name) + '</span>' +
                        '<span class="option-meta">' + serviceMinutes(s) + ' min per session · online</span>' +
                        (available
                            ? (state.creditMode ? '<span class="option-meta">Covered by your prepaid sessions</span>'
                                : '<span class="option-price">' + escapeHtml(money(s.price, s.currency)) + '</span>')
                            : '<span class="option-meta">Not available at ' + escapeHtml(niceTime(pick.time)) + '</span>') +
                    '</span>' +
                '</button>';
            }).join('');
            sessionList.querySelectorAll('.option-card:not([disabled])').forEach((card) => {
                card.addEventListener('click', () => chooseSession(candidates.find((s) => s.id === card.dataset.value)));
            });
        }

        async function chooseSession(service) {
            if (holding || !service) return;
            const previous = pick.service;
            pick.service = service;
            renderSessions();
            refresh();
            // Re-hold with this option's length (a 90-minute package needs more of the calendar than 60 minutes).
            if (previous && previous.id === service.id) return;
            holding = true;
            nextBtn.disabled = true;
            try {
                const result = await holdFor(service, pick.time);
                if (result && result.error) {
                    pick.service = null;
                    setStatus(statusEl, service.name + ' isn\'t available at ' + niceTime(pick.time) + '. Please choose another option or time.', 'error');
                }
            } catch (err) {
                setStatus(statusEl, 'Network error, please choose the session again.', 'error');
                pick.service = null;
            } finally {
                holding = false;
                renderSessions();
                refresh();
            }
        }

        nextBtn.addEventListener('click', () => {
            if (!(pick.date && pick.time && pick.service && holdMatchesPick())) {
                setStatus(statusEl, 'Please choose a date, time and session.', 'error');
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
                candidates = bookableServices(await get('/api/services'), state.staffId, state);
            } catch (err) {
                setStatus(statusEl, 'Could not load sessions right now. Please try again shortly or book on WhatsApp.', 'error');
                return;
            }
            if (!candidates.length) {
                $('date-block').hidden = true;
                setStatus(statusEl, state.staffName + ' has no ' + (state.creditMode ? '' : state.sessionType + ' ') +
                    'sessions open for online booking. Please choose another therapist or book on WhatsApp.', 'error');
                return;
            }
            pick.service = candidates.find((s) => String(s.id) === String(state.serviceId)) || null;
            renderDates();
        })();
    }

    // -----------------------------------------------------------------
    // Step 4: /book/details/
    // -----------------------------------------------------------------

    function initDetails() {
        const state = guard([[['sessionType'], PATHS.type], [SCHEDULE_KEYS.filter((k) => k !== 'price'), PATHS.schedule]]);
        if (!state) return;
        renderStepper(4);
        showHoldBanner(state);

        $('details-phone').value = state.phone || '';
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
            save({ name, email, notes: $('details-notes').value.trim(), hp: $('details-hp').value });
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
        renderStepper(5);
        showHoldBanner(state);

        const date = parseIsoDate(state.date);
        $('review-month').textContent = date ? date.toLocaleDateString('en-IN', { month: 'short' }) : '';
        $('review-day').textContent = date ? date.getDate() : '';
        $('review-service').textContent = state.serviceName;
        $('review-when').textContent = longDate(state.date) + ' at ' + state.time;
        $('review-therapist').textContent = 'With ' + state.staffName + ' · Online video session';
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
            payBtn.textContent = 'Agree & pay ' + money(state.price, state.currency);
        }
        const idleLabel = payBtn.textContent;
        const consent = $('pay-consent');
        consent.addEventListener('change', () => consent.parentElement.classList.remove('needs-attention'));

        const booking = {
            session_token: state.token,
            service_id: state.serviceId,
            staff_id: state.staffId,
            date: state.date,
            time: state.time,
            name: state.name,
            email: state.email,
            notes: state.notes || '',
            hp_confirm: state.hp || ''
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
            try {
                const { res, data } = await post('/api/payment/verify', {
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature
                });
                if (res.ok && data.success) {
                    go(PATHS.confirmation + '?booking=success');
                } else {
                    go(PATHS.confirmation + '?booking=' + (data.refunded ? 'refunded' : 'failed') + '&payment=' + paymentId);
                }
            } catch (err) {
                // The payment went through; the server-side webhook still finishes the booking.
                go(PATHS.confirmation + '?booking=error&payment=' + paymentId);
            }
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
            if (!res.ok) {
                if (data.free) {
                    await bookWithoutPayment('/api/book');
                } else {
                    fail(res, data);
                }
                idle();
                return;
            }

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
                        setStatus(statusEl, 'Payment cancelled. Nothing was booked or charged, you can try again.', 'error');
                        idle();
                    }
                }
            });
            checkout.on('payment.failed', (response) => {
                const reason = response && response.error && response.error.description;
                setStatus(statusEl, 'Payment failed' + (reason ? ': ' + reason : '') + '. You can try again.', 'error');
            });
            setStatus(statusEl, '');
            payBtn.textContent = 'Complete payment in the Razorpay window…';
            checkout.open();
        }

        payBtn.addEventListener('click', async () => {
            if (!consent.checked) {
                consent.parentElement.classList.add('needs-attention');
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
    // /book/confirmation/?booking=success|refunded|failed|cancelled|error
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
        refunded: {
            icon: 'warn', title: 'That time was just taken',
            text: 'Your payment went through, but someone booked that time moments before you. Your money is being refunded automatically (usually 5-7 working days). Please pick another time.',
            actions: [['Pick another time', PATHS.schedule, 'btn-primary']]
        },
        failed: {
            icon: 'warn', title: "We couldn't complete your booking",
            text: 'Your payment went through, but we could not book the session. Our team will contact you and refund you.',
            actions: [['Message us on WhatsApp', WHATSAPP_URL, 'btn-primary']]
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

        $('result-icon').className = 'result-icon ' + outcome.icon;
        $('result-icon').innerHTML = outcome.icon === 'success' ? CHECK_ICON : INFO_ICON;
        $('result-title').textContent = outcome.title;
        $('result-text').textContent = outcome.text + (payment && key !== 'success' ? ' Payment ID: ' + payment : '');
        document.title = outcome.title + ' | Mindlap';

        if (state.serviceName && state.date && state.time) {
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
            clearFrom(SCHEDULE_KEYS.concat(['notes', 'hp', 'creditMode', 'sessionType', 'credits']));
        }
    }

    // -----------------------------------------------------------------

    const PAGES = {
        verify: initVerify,
        credits: initCredits,
        therapist: initTherapist,
        type: initType,
        schedule: initSchedule,
        details: initDetails,
        checkout: initCheckout,
        confirmation: initConfirmation
    };

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.body.getAttribute('data-page');
        if (page !== 'verify' && page !== 'confirmation') renderSummary(load());
        const init = PAGES[page];
        if (init) init();
    });
})();

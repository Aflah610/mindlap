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
            if (name) auth.name = String(name).slice(0, 60);
            localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
        } catch (err) { /* menu just shows "Log In" */ }
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
            clearFrom(SCHEDULE_KEYS.concat(['hold', 'staffPhoto', 'staffProfile', 'sessionType', 'preferredTherapist']));
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
            if (forAccount) goAfterLogin(state.token);
            else routeAfterVerify(state.token);
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

    async function routeAfterVerify(token) {
        try {
            const { res, data } = await post('/api/payment/waiting', { session_token: token });
            if (handleAuthError(res, data)) return;
            if (res.ok && data.waiting && data.waiting.length) {
                startRebook(data.waiting[0]);
                go(PATHS.confirmation + '?booking=waiting');
                return;
            }
        } catch (err) { /* fall through to the normal flow */ }
        try {
            const { res, data } = await post('/api/credits/check', { session_token: token });
            if (handleAuthError(res, data)) return;
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
            save({ creditMode: true, sessionType: 'any' });
            clearFrom(['serviceId', 'serviceName', 'price', 'currency', 'duration', 'date', 'time']);
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
            return state.creditMode ? !isPackage(s.name) : type === state.sessionType;
        });
    }

    /**
     * Site therapists (profile first name) that can be booked online, and the
     * Zoho Bookings staff whose calendar they use. Add a line per therapist
     * once they exist in Zoho; until then their buttons stay on WhatsApp.
     */
    const ONLINE_THERAPISTS = {
        rashin: { zohoStaff: 'nasheel', profile: '/rashin.html', photo: '/assets/rashin.webp' }
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
            go(state.creditMode ? PATHS.plan : PATHS.type);
            return;
        }
        const entry = wanted && ONLINE_THERAPISTS[firstName(wanted)];
        if (!entry) {
            save({ preferredTherapist: null });
            go(PATHS.therapist);
            return;
        }
        let staff = [];
        try {
            staff = await get('/api/staff');
        } catch (err) { /* handled below */ }
        const match = staff.find((p) => firstName(p.name) === entry.zohoStaff);
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
        window.location.replace(state.creditMode ? PATHS.plan : PATHS.type);
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
                save({ sessionType: type, creditMode: false });
                go(PATHS.plan);
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

        $('plan-back').href = state.creditMode ? PATHS.credits : PATHS.type;
        $('plan-with').innerHTML = 'With <strong>' + escapeHtml(state.staffName) + '</strong> · ' +
            (state.creditMode ? 'prepaid session' : state.sessionType === 'couple' ? 'couple therapy' : 'individual therapy') +
            ' · online. <a href="' + PATHS.therapist + '">Change therapist</a>';
        if (state.creditMode) {
            const banner = $('credit-banner');
            banner.hidden = false;
            banner.querySelector('[data-credits]').textContent = state.credits;
        }

        const tabs = $('plan-tabs');
        const list = $('plan-list');
        const statusEl = $('plan-status');
        const nextBtn = $('plan-next');
        const footerSummary = $('plan-summary');

        let services = [];
        try {
            services = bookableServices(await get('/api/services'), state.staffId, state);
        } catch (err) {
            setStatus(statusEl, 'Could not load sessions right now. Please try again shortly or book on WhatsApp.', 'error');
            return;
        }
        const packages = services.filter((s) => isPackage(s.name)).sort((a, b) => packageSessions(a.name) - packageSessions(b.name));
        const singles = services.filter((s) => !isPackage(s.name)).sort((a, b) => Number(b.price) - Number(a.price));
        if (!services.length) {
            setStatus(statusEl, state.staffName + ' has no ' + (state.creditMode ? '' : state.sessionType + ' ') +
                'sessions open for online booking. Please choose another therapist or book on WhatsApp.', 'error');
            return;
        }

        // What one session costs without a package: the cheapest paid single session of this type.
        const paidSingles = singles.filter((s) => Number(s.price) >= 100).map((s) => Number(s.price));
        const singlePrice = paidSingles.length ? Math.min.apply(null, paidSingles) : 0;

        let picked = services.find((s) => String(s.id) === String(state.serviceId)) || null;
        // Lands on Packages unless they already chose a single session (or there are no packages).
        let tab = state.creditMode || !packages.length || (picked && !isPackage(picked.name)) ? 'single' : 'package';

        function packageCard(s) {
            const n = packageSessions(s.name);
            const price = Number(s.price) || 0;
            const full = n && singlePrice ? n * singlePrice : 0;
            const save = full > price ? Math.round((1 - price / full) * 100) : 0;
            return '<span class="option-body">' +
                    '<span class="option-kicker">' + (n ? n + ' sessions' : 'Package') + (save ? ' · save ' + save + '%' : '') + '</span>' +
                    '<span class="option-title">' + escapeHtml(n ? n + '-session package' : s.name) + '</span>' +
                    '<span class="option-meta">' + serviceMinutes(s) + ' min per session · online</span>' +
                    '<span class="plan-price"><span class="option-price">' + escapeHtml(money(price, s.currency)) + '</span>' +
                        (save ? '<s>' + escapeHtml(money(full, s.currency)) + '</s>' : '') + '</span>' +
                    (n ? '<span class="option-meta">' + escapeHtml(money(Math.round(price / n), s.currency)) + ' per session</span>' : '') +
                '</span>';
        }

        function singleCard(s) {
            return '<span class="option-body">' +
                    '<span class="option-kicker">Single session</span>' +
                    '<span class="option-title">' + escapeHtml(s.name) + '</span>' +
                    '<span class="option-meta">' + serviceMinutes(s) + ' min · online</span>' +
                    (state.creditMode ? '<span class="option-meta">Covered by your prepaid sessions</span>'
                        : '<span class="option-price">' + escapeHtml(Number(s.price) ? money(s.price, s.currency) : 'Free') + '</span>') +
                '</span>';
        }

        function render() {
            tabs.hidden = !!state.creditMode;
            tabs.querySelectorAll('[data-tab]').forEach((btn) => {
                const on = btn.dataset.tab === tab;
                btn.setAttribute('aria-selected', String(on));
                btn.classList.toggle('active', on);
            });
            const shown = tab === 'package' ? packages : singles;
            list.innerHTML = shown.length ? shown.map((s) =>
                '<button type="button" class="option-card plan-card" role="radio" aria-checked="' +
                    String(!!picked && picked.id === s.id) + '" data-value="' + escapeHtml(s.id) + '">' +
                    (tab === 'package' ? packageCard(s) : singleCard(s)) +
                '</button>'
            ).join('') : '<p class="booking-slots-empty">No ' + (tab === 'package' ? 'packages' : 'single sessions') +
                ' open for online booking with ' + escapeHtml(state.staffName) + '.</p>';
            list.querySelectorAll('.plan-card').forEach((card) => {
                card.addEventListener('click', () => {
                    picked = services.find((s) => s.id === card.dataset.value);
                    render();
                });
            });
            nextBtn.disabled = !picked;
            footerSummary.innerHTML = picked
                ? '<strong>' + escapeHtml(isPackage(picked.name) && packageSessions(picked.name) ? packageSessions(picked.name) + '-session package' : picked.name) + '</strong> ' +
                    (state.creditMode ? 'prepaid' : escapeHtml(money(picked.price, picked.currency)))
                : 'Choose a ' + (tab === 'package' ? 'package' : 'session') + '.';
            renderSummary(Object.assign({}, state, {
                serviceName: picked && picked.name,
                price: picked ? Number(picked.price) || 0 : undefined,
                currency: picked && picked.currency,
                date: null,
                time: null
            }));
        }

        tabs.querySelectorAll('[data-tab]').forEach((btn) => {
            btn.addEventListener('click', () => {
                tab = btn.dataset.tab;
                render();
            });
        });

        nextBtn.addEventListener('click', () => {
            if (!picked) {
                setStatus(statusEl, 'Please choose a plan.', 'error');
                return;
            }
            if (String(picked.id) !== String(state.serviceId)) {
                // A different plan can need a different length of time: let go of any held time.
                if (state.hold) post('/api/slots/release', { session_token: state.token }).catch(() => {});
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
        $('schedule-with').innerHTML = '<strong>' + escapeHtml(state.serviceName) + '</strong> with <strong>' + escapeHtml(state.staffName) + '</strong> · ' +
            (state.creditMode ? 'prepaid' : escapeHtml(money(state.price, state.currency))) +
            ' · online. <a href="' + PATHS.plan + '">Change plan</a>';
        if (rebook) {
            $('schedule-back').href = PATHS.confirmation + '?booking=waiting';
            $('schedule-with').innerHTML = 'Already paid: <strong>' + escapeHtml(state.serviceName) + '</strong> with <strong>' +
                escapeHtml(state.staffName) + '</strong>. Pick a new date and time - no payment needed.';
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
                footerSummary.textContent = !pick.date ? 'Pick a date to see open times.'
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
            dateStrip.querySelectorAll('.date-chip').forEach((chip) => {
                chip.addEventListener('click', () => chooseDate(chip.dataset.value));
            });
            const valid = pick.date && dateStrip.querySelector('[data-value="' + pick.date + '"]');
            chooseDate(valid ? pick.date : localIso(today), true);
        }

        async function chooseDate(iso, restoring) {
            if (!restoring && pick.date !== iso) pick.time = null;
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
                        '<button type="button" class="booking-slot' + (m === current ? ' selected' : '') + '" data-value="' + m + '">' + escapeHtml(niceTime(slotLabel(m))) + '</button>'
                    ).join('') + '</div></div>';
            }).join('');
            slotsWrap.querySelectorAll('.booking-slot').forEach((btn) => {
                btn.addEventListener('click', () => chooseTime(Number(btn.dataset.value), btn));
            });
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
            const service = pick.service;
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

        async function confirmRebook() {
            nextBtn.disabled = true;
            nextBtn.textContent = 'Booking…';
            setStatus(statusEl, 'Booking your new time…');
            try {
                const { res, data } = await post('/api/payment/rebook', {
                    session_token: state.token,
                    order_id: state.rebookOrderId,
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
                const all = await get('/api/services');
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
        renderStepper(6);
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
            staff_name: state.staffName,
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
            clearFrom(SCHEDULE_KEYS.concat(['notes', 'hp', 'creditMode', 'sessionType', 'credits', 'rebookOrderId']));
        }
    }

    // -----------------------------------------------------------------
    // /account/ - logged-in customer: sessions, prepaid credits, log out
    // -----------------------------------------------------------------

    async function initAccount() {
        const state = load();
        if (!tokenValid(state.token)) {
            window.location.replace(PATHS.verify + '?next=account');
            return;
        }
        $('account-logout').addEventListener('click', () => {
            signOut();
            go('/');
        });

        const account = await loadAccount(state.token);
        if (!account) return;
        if (account.known) saveAuthAccount(account.hasAccount, account.name);
        if (account.known && !account.hasAccount) {
            // New client: nothing booked and no prepaid sessions yet.
            window.location.replace('/?welcome=new#therapists');
            return;
        }

        const data = account.data;
        const name = data && data.customer && data.customer.name;
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

    // Set to true to pause online booking (everyone books on WhatsApp).
    const ONLINE_BOOKING_PAUSED = false;

    document.addEventListener('DOMContentLoaded', () => {
        const page = document.body.getAttribute('data-page');
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

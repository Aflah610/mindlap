/* -------------------------------------------------------------
   Mindlap - Book Online, one page per step:
     /book/               verify phone (WhatsApp OTP)
     /book/credits/       prepaid sessions found (Zoho CRM)
     /book/session-type/  individual or couple
     /book/schedule/      service, therapist, date, time
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

    function localIso(date) {
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function renderStepper(activeIndex) {
        const el = $('book-stepper');
        if (!el) return;
        const labels = ['Verify', 'Session', 'Schedule', 'Details', 'Payment'];
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
                signOut();
                save({ token: data.session_token, phone: data.phone || fullPhone() });
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
        go(PATHS.type);
    }

    // -----------------------------------------------------------------
    // Step 2a: /book/credits/
    // -----------------------------------------------------------------

    function initCredits() {
        const state = guard();
        if (!state) return;
        if (!(state.credits > 0)) {
            go(PATHS.type);
            return;
        }
        renderStepper(1);
        showVerifiedChip(state);

        const n = state.credits;
        $('credits-count').textContent = n + ' prepaid session' + (n === 1 ? '' : 's');

        $('use-credits-btn').addEventListener('click', () => {
            save({ creditMode: true, sessionType: 'any' });
            clearFrom(SCHEDULE_KEYS);
            go(PATHS.schedule);
        });
        $('pay-new-btn').addEventListener('click', () => {
            save({ creditMode: false });
            go(PATHS.type);
        });
    }

    // -----------------------------------------------------------------
    // Step 2b: /book/session-type/
    // -----------------------------------------------------------------

    function initType() {
        const state = guard();
        if (!state) return;
        renderStepper(1);
        showVerifiedChip(state);

        const back = $('type-back');
        if (back && state.credits > 0) {
            back.hidden = false;
            back.href = PATHS.credits;
        }

        document.querySelectorAll('[data-session-type]').forEach((card) => {
            if (card.getAttribute('data-session-type') === state.sessionType) card.classList.add('selected');
            card.addEventListener('click', () => {
                const type = card.getAttribute('data-session-type');
                if (type !== load().sessionType) clearFrom(SCHEDULE_KEYS);
                save({ sessionType: type, creditMode: false });
                go(PATHS.schedule);
            });
        });
    }

    // -----------------------------------------------------------------
    // Step 3: /book/schedule/
    // -----------------------------------------------------------------

    function initSchedule() {
        const state = guard([[['sessionType'], PATHS.type]]);
        if (!state) return;
        renderStepper(2);
        showVerifiedChip(state);

        $('schedule-back').href = state.creditMode ? PATHS.credits : PATHS.type;
        if (state.creditMode) {
            const banner = $('credit-banner');
            banner.hidden = false;
            banner.querySelector('[data-credits]').textContent = state.credits;
        }

        const serviceSelect = $('booking-service');
        const staffSelect = $('booking-staff');
        const dateInput = $('booking-date');
        const slotsWrap = $('booking-slots');
        const statusEl = $('schedule-status');
        const nextBtn = $('schedule-next');
        let services = [];
        let selectedSlot = state.time || null;

        const today = new Date();
        const max = new Date();
        max.setDate(max.getDate() + 60);
        dateInput.min = localIso(today);
        dateInput.max = localIso(max);

        function emptySlots(message) {
            selectedSlot = null;
            slotsWrap.innerHTML = '<p class="booking-slots-empty">' + (message || 'Choose a service, therapist and date to see available times.') + '</p>';
        }

        function matchesType(name) {
            if (state.creditMode) return true;
            const n = String(name || '').toLowerCase();
            return state.sessionType === 'couple' ? /couple|package/.test(n) : /individual|package/.test(n);
        }

        async function loadServices() {
            serviceSelect.innerHTML = '<option value="">Loading…</option>';
            try {
                services = (await get('/api/services')).filter((s) => matchesType(s.name));
                if (!services.length) {
                    serviceSelect.innerHTML = '<option value="">No services available</option>';
                    setStatus(statusEl, 'No bookable services were found. Please book via WhatsApp instead.', 'error');
                    return;
                }
                serviceSelect.innerHTML = '<option value="">Select a service</option>' + services.map((s) =>
                    '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) +
                    (state.creditMode ? '' : ' - ' + escapeHtml(money(s.price, s.currency))) + '</option>'
                ).join('');
                const keep = services.find((s) => String(s.id) === String(state.serviceId));
                if (keep) {
                    serviceSelect.value = keep.id;
                    await loadStaff(keep.id, state.staffId);
                } else if (services.length === 1) {
                    serviceSelect.value = services[0].id;
                    await loadStaff(services[0].id);
                }
            } catch (err) {
                serviceSelect.innerHTML = '<option value="">Unavailable</option>';
                setStatus(statusEl, 'Could not load services right now. Please try again shortly or book via WhatsApp.', 'error');
            }
        }

        async function loadStaff(serviceId, keepStaffId) {
            staffSelect.innerHTML = '<option value="">Loading…</option>';
            staffSelect.disabled = true;
            emptySlots();
            try {
                const staff = await get('/api/staff', { service_id: serviceId });
                if (!staff.length) {
                    staffSelect.innerHTML = '<option value="">No therapists available</option>';
                    return;
                }
                staffSelect.innerHTML = '<option value="">Select a therapist</option>' + staff.map((s) =>
                    '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.name) + '</option>'
                ).join('');
                staffSelect.disabled = false;
                if (keepStaffId && staff.some((s) => String(s.id) === String(keepStaffId))) {
                    staffSelect.value = keepStaffId;
                    if (state.date) {
                        dateInput.value = state.date;
                        await loadSlots();
                    }
                }
            } catch (err) {
                staffSelect.innerHTML = '<option value="">Unavailable</option>';
                setStatus(statusEl, 'Could not load therapists for this service.', 'error');
            }
        }

        async function loadSlots() {
            if (!serviceSelect.value || !staffSelect.value || !dateInput.value) {
                emptySlots();
                return;
            }
            const keep = selectedSlot;
            selectedSlot = null;
            slotsWrap.innerHTML = '<p class="booking-slots-loading">Loading available times…</p>';
            try {
                const slots = await get('/api/availability', {
                    service_id: serviceSelect.value,
                    staff_id: staffSelect.value,
                    date: dateInput.value
                });
                if (!slots.length) {
                    emptySlots('No slots available on this date. Try another date.');
                    return;
                }
                slotsWrap.innerHTML = '';
                slots.forEach((slot) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'booking-slot';
                    btn.textContent = slot;
                    if (slot === keep) {
                        btn.classList.add('selected');
                        selectedSlot = slot;
                    }
                    btn.addEventListener('click', () => {
                        slotsWrap.querySelectorAll('.booking-slot').forEach((el) => el.classList.remove('selected'));
                        btn.classList.add('selected');
                        selectedSlot = slot;
                        setStatus(statusEl, '');
                    });
                    slotsWrap.appendChild(btn);
                });
            } catch (err) {
                emptySlots('Could not load available times. Please try a different date.');
            }
        }

        serviceSelect.addEventListener('change', () => {
            selectedSlot = null;
            if (serviceSelect.value) {
                loadStaff(serviceSelect.value);
            } else {
                staffSelect.innerHTML = '<option value="">Select a service first</option>';
                staffSelect.disabled = true;
                emptySlots();
            }
        });
        staffSelect.addEventListener('change', () => { selectedSlot = null; loadSlots(); });
        dateInput.addEventListener('change', () => { selectedSlot = null; loadSlots(); });

        nextBtn.addEventListener('click', () => {
            if (!serviceSelect.value || !staffSelect.value || !dateInput.value || !selectedSlot) {
                setStatus(statusEl, 'Please choose a service, therapist, date and time.', 'error');
                return;
            }
            const service = services.find((s) => String(s.id) === String(serviceSelect.value)) || {};
            save({
                serviceId: serviceSelect.value,
                serviceName: service.name || serviceSelect.selectedOptions[0].textContent,
                price: Number(service.price) || 0,
                currency: service.currency || 'INR',
                staffId: staffSelect.value,
                staffName: staffSelect.selectedOptions[0].textContent,
                date: dateInput.value,
                time: selectedSlot
            });
            go(PATHS.details);
        });

        loadServices();
    }

    // -----------------------------------------------------------------
    // Step 4: /book/details/
    // -----------------------------------------------------------------

    function initDetails() {
        const state = guard([[['sessionType'], PATHS.type], [SCHEDULE_KEYS.filter((k) => k !== 'price'), PATHS.schedule]]);
        if (!state) return;
        renderStepper(3);

        $('details-phone').value = state.phone || '';
        $('details-name').value = state.name || '';
        $('details-email').value = state.email || '';
        $('details-notes').value = state.notes || '';
        $('details-when').textContent = state.serviceName + ' · ' + longDate(state.date) + ', ' + state.time;
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
        renderStepper(4);

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
        type: initType,
        schedule: initSchedule,
        details: initDetails,
        checkout: initCheckout,
        confirmation: initConfirmation
    };

    document.addEventListener('DOMContentLoaded', () => {
        const init = PAGES[document.body.getAttribute('data-page')];
        if (init) init();
    });
})();

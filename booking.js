/* -------------------------------------------------------------
   Mindlap - Book Online (Zoho Bookings via Cloudflare Worker)
   -------------------------------------------------------------
   This talks to a small Cloudflare Worker (see /worker) that
   proxies the Zoho Bookings REST API so no Zoho credentials are
   ever exposed in the browser.

   SETUP: replace BOOKING_API_BASE below with the URL of your
   deployed Worker (e.g. https://mindlap-booking-api.<your
   -subdomain>.workers.dev). Full setup steps are in
   docs/zoho-bookings-setup.md.
   ------------------------------------------------------------- */

(function () {
    'use strict';

    // TODO: replace with your deployed Cloudflare Worker URL
    const BOOKING_API_BASE = 'https://mindlap-booking-api.nasheel.workers.dev';

    document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('booking-modal');
        if (!modal) return;

        const closeBtn = modal.querySelector('.modal-close');
        const form = document.getElementById('booking-form');
        const serviceSelect = document.getElementById('booking-service');
        const staffSelect = document.getElementById('booking-staff');
        const dateInput = document.getElementById('booking-date');
        const slotsWrap = document.getElementById('booking-slots');
        const statusEl = document.getElementById('booking-status');
        const submitBtn = document.getElementById('booking-submit');

        const bookingStepEl = document.getElementById('booking-step');

        // --- Wizard chrome (otp -> credits/type -> details -> payment) ---
        const wizardBackBtn = document.getElementById('wizard-back-btn');
        const wizardProgress = document.getElementById('wizard-progress');
        const wizardTypeStep = document.getElementById('wizard-step-type');
        const sessionTypeCards = document.querySelectorAll('.session-type-card');

        // --- Phone verification + package credits ---
        const otpPhoneSubstep = document.getElementById('wizard-otp-phone-substep');
        const otpCodeSubstep = document.getElementById('wizard-otp-code-substep');
        const otpPhoneInput = document.getElementById('wizard-otp-phone');
        const otpCountrySelect = document.getElementById('wizard-otp-country');
        const otpCodeInput = document.getElementById('wizard-otp-code');
        const otpSendBtn = document.getElementById('wizard-otp-send-btn');
        const otpVerifyBtn = document.getElementById('wizard-otp-verify-btn');
        const otpResendBtn = document.getElementById('wizard-otp-resend-btn');
        const otpChangeNumberBtn = document.getElementById('wizard-otp-change-btn');
        const otpStatusEl = document.getElementById('wizard-otp-status');
        const otpVerifiedBadge = document.getElementById('wizard-otp-verified-badge');
        const creditsPackageList = document.getElementById('credits-package-list');
        const creditModeBanner = document.getElementById('credit-mode-banner');
        const bookingServiceField = document.getElementById('booking-service-field');

        const WIZARD_STEPS = ['wizard-step-otp', 'wizard-step-credits', 'wizard-step-type', 'booking-step'];
        let currentStepIndex = 0;
        let selectedSessionType = null;
        let sessionToken = null;
        let verifiedPhone = '';
        let otpVerifyInFlight = false;
        let creditBookingMode = false;
        let otpResendTimer = null;

        renderWizardDots();

        function renderWizardDots() {
            if (!wizardProgress) return;
            wizardProgress.innerHTML = WIZARD_STEPS.map((_, i) =>
                '<span class="wizard-dot' + (i === currentStepIndex ? ' active' : i < currentStepIndex ? ' done' : '') + '"></span>'
            ).join('');
        }

        function goToStep(stepId) {
            const index = WIZARD_STEPS.indexOf(stepId);
            currentStepIndex = index === -1 ? currentStepIndex : index;

            WIZARD_STEPS.forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.hidden = (id !== stepId);
            });

            if (wizardBackBtn) {
                wizardBackBtn.hidden = (stepId === 'wizard-step-otp' || stepId === 'wizard-step-credits');
            }
            renderWizardDots();
        }

        function filterServicesBySessionType(type) {
            const options = Array.from(serviceSelect.querySelectorAll('option[value]:not([value=""])'));
            options.forEach((opt) => {
                const name = (opt.textContent || '').toLowerCase();
                const matches = type === 'couple'
                    ? /couple/.test(name) || /package/.test(name)
                    : /individual/.test(name) || /package/.test(name);
                opt.hidden = !matches;
            });
            // If the currently selected service just got hidden, clear it.
            const current = serviceSelect.selectedOptions[0];
            if (current && current.hidden) {
                serviceSelect.value = '';
                serviceSelect.dispatchEvent(new Event('change'));
            }
        }

        sessionTypeCards.forEach((card) => {
            card.addEventListener('click', () => {
                selectedSessionType = card.getAttribute('data-session-type');
                sessionTypeCards.forEach((c) => c.classList.toggle('selected', c === card));

                const proceed = () => {
                    filterServicesBySessionType(selectedSessionType);
                    goToStep('booking-step');
                };

                if (!servicesLoaded) {
                    loadServices().then(proceed);
                } else {
                    proceed();
                }
            });
        });

        if (wizardBackBtn) {
            wizardBackBtn.addEventListener('click', () => {
                if (!bookingStepEl.hidden) {
                    goToStep(creditBookingMode ? 'wizard-step-credits' : 'wizard-step-type');
                }
            });
        }

        let servicesLoaded = false;
        let selectedSlot = null;
        let pendingStaffName = null;

        // Restrict date picker to today .. +60 days
        if (dateInput) {
            const today = new Date();
            const max = new Date();
            max.setDate(max.getDate() + 60);
            dateInput.min = today.toISOString().slice(0, 10);
            dateInput.max = max.toISOString().slice(0, 10);
        }

        function setStatus(message, type) {
            if (!statusEl) return;
            statusEl.textContent = message || '';
            statusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function resetSlots(message) {
            selectedSlot = null;
            slotsWrap.innerHTML = '<p class="booking-slots-empty">' + (message || 'Choose a service, therapist and date to see available times.') + '</p>';
        }

        function openModal(staffName) {
            pendingStaffName = staffName || null;
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            selectedSessionType = null;
            creditBookingMode = false;
            if (submitBtn) submitBtn.textContent = 'Continue to payment';
            sessionTypeCards.forEach((c) => c.classList.remove('selected'));
            if (bookingServiceField) bookingServiceField.hidden = false;
            if (creditModeBanner) creditModeBanner.hidden = true;

            if (sessionToken) {
                // Already verified earlier in this visit - re-check credits
                // (cheap) instead of asking for the phone number again.
                checkCreditsAndAdvance();
            } else {
                resetOtpUi();
                goToStep('wizard-step-otp');
            }
        }

        function closeModal() {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }

        document.querySelectorAll('[data-open-booking]').forEach((trigger) => {
            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                openModal(trigger.getAttribute('data-staff-name'));
            });
        });

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
        });

        // -----------------------------------------------------------------
        // Phone verification (also unlocks prepaid package credits)
        // -----------------------------------------------------------------

        function setOtpStatus(message, type) {
            if (!otpStatusEl) return;
            otpStatusEl.textContent = message || '';
            otpStatusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function resetOtpUi() {
            if (otpPhoneSubstep) otpPhoneSubstep.hidden = false;
            if (otpCodeSubstep) otpCodeSubstep.hidden = true;
            if (otpVerifiedBadge) otpVerifiedBadge.classList.remove('show');
            if (otpCodeInput) otpCodeInput.value = '';
            setOtpStatus('');
            clearInterval(otpResendTimer);
            if (otpResendBtn) {
                otpResendBtn.disabled = false;
                otpResendBtn.textContent = 'Resend code';
            }
        }

        function startOtpResendCooldown(seconds) {
            let remaining = seconds;
            otpResendBtn.disabled = true;
            otpResendBtn.textContent = 'Resend code (' + remaining + 's)';
            clearInterval(otpResendTimer);
            otpResendTimer = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(otpResendTimer);
                    otpResendBtn.disabled = false;
                    otpResendBtn.textContent = 'Resend code';
                } else {
                    otpResendBtn.textContent = 'Resend code (' + remaining + 's)';
                }
            }, 1000);
        }

        /**
         * Local number digits only. Tolerates pasted/autofilled numbers like
         * "+91 98765 43210", "0091..." or a leading trunk "0".
         */
        function getLocalDigits() {
            const raw = otpPhoneInput.value.trim();
            let digits = raw.replace(/\D/g, '');
            const ccDigits = otpCountrySelect.value.replace('+', '');
            if (/^(\+|00)/.test(raw)) {
                digits = digits.replace(/^00/, '');
                if (digits.startsWith(ccDigits)) digits = digits.slice(ccDigits.length);
            } else if (ccDigits === '91' && digits.length === 12 && digits.startsWith('91')) {
                digits = digits.slice(2);
            }
            return digits.replace(/^0+/, '');
        }

        function getFullPhone() {
            const digits = getLocalDigits();
            return digits ? otpCountrySelect.value + digits : '';
        }

        function isValidLocalNumber() {
            const len = getLocalDigits().length;
            return otpCountrySelect.value === '+91' ? len === 10 : len >= 6 && len <= 13;
        }

        function showOtpCodeEntry() {
            otpPhoneSubstep.hidden = true;
            otpCodeSubstep.hidden = false;
            otpCodeInput.value = '';
            otpCodeInput.focus();
            startOtpResendCooldown(60);
        }

        async function sendWizardOtp(isResend) {
            const phone = getFullPhone();
            if (!isValidLocalNumber()) {
                setOtpStatus(otpCountrySelect.value === '+91'
                    ? 'Please enter a valid 10-digit phone number.'
                    : 'Please enter a valid phone number.', 'error');
                return;
            }

            otpSendBtn.disabled = true;
            setOtpStatus(isResend ? 'Resending code…' : 'Sending code…');

            try {
                const res = await fetch(BOOKING_API_BASE + '/api/otp/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    // The code is saved before the WhatsApp send is attempted,
                    // so a delivery failure still leaves a usable code.
                    if (data.delivery_failed) {
                        showOtpCodeEntry();
                        setOtpStatus((data.error || "We couldn't deliver the code on WhatsApp.") +
                            ' If you already have a code, enter it below, or tap Resend in a minute.', 'error');
                    } else {
                        setOtpStatus(data.error || 'Could not send code.', 'error');
                    }
                    return;
                }

                showOtpCodeEntry();
                setOtpStatus('Code sent to ' + phone + ' on WhatsApp.', 'success');
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpSendBtn.disabled = false;
            }
        }

        function renderCredits(credits) {
            if (!creditsPackageList) return;
            creditsPackageList.innerHTML = '';
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'session-type-card';
            card.innerHTML =
                '<span class="session-type-icon">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                    '<rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M2 10h20"></path></svg>' +
                '</span>' +
                '<span class="session-type-text">' +
                    '<span class="session-type-name">Your prepaid sessions</span>' +
                    '<span class="session-type-desc">' + credits + ' session' + (credits === 1 ? '' : 's') + ' remaining</span>' +
                '</span>' +
                '<svg class="session-type-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';

            card.addEventListener('click', () => useCredits(credits));
            creditsPackageList.appendChild(card);
        }

        async function useCredits(credits) {
            creditBookingMode = true;
            if (submitBtn) submitBtn.textContent = 'Confirm booking';

            if (creditModeBanner) {
                creditModeBanner.hidden = false;
                creditModeBanner.innerHTML = '<p>Booking with your <strong>prepaid sessions</strong> (' +
                    credits + ' remaining). No payment needed.</p>';
            }

            if (!servicesLoaded) {
                await loadServices();
            }
            if (bookingServiceField) bookingServiceField.hidden = false;
            serviceSelect.querySelectorAll('option').forEach((opt) => { opt.hidden = false; });

            goToStep('booking-step');
        }

        async function checkCreditsAndAdvance() {
            setOtpStatus('Checking for prepaid sessions…');
            try {
                const res = await fetch(BOOKING_API_BASE + '/api/credits/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_token: sessionToken })
                });
                const data = await res.json().catch(() => ({}));

                if (res.status === 401) {
                    requireReverification();
                    return;
                }
                if (res.ok && data.has_credits && data.credits > 0) {
                    renderCredits(data.credits);
                    goToStep('wizard-step-credits');
                } else {
                    goToStep('wizard-step-type');
                }
            } catch (err) {
                // If the credit check itself fails, don't block booking -
                // just fall back to the normal flow.
                goToStep('wizard-step-type');
            }
        }

        async function verifyWizardOtp() {
            if (otpVerifyInFlight) return;
            const phone = getFullPhone();
            const code = otpCodeInput.value.replace(/\D/g, '');
            if (code.length !== 6) {
                setOtpStatus('Please enter the 6-digit code.', 'error');
                return;
            }

            otpVerifyInFlight = true;
            otpVerifyBtn.disabled = true;
            setOtpStatus('Verifying…');

            try {
                const res = await fetch(BOOKING_API_BASE + '/api/otp/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, code })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    setOtpStatus(data.error || 'Incorrect or expired code.', 'error');
                    return;
                }

                sessionToken = data.session_token || null;
                verifiedPhone = data.phone || phone;
                otpVerifiedBadge.classList.add('show');
                setOtpStatus('');
                fillVerifiedPhone();

                if (sessionToken) {
                    await checkCreditsAndAdvance();
                } else {
                    goToStep('wizard-step-type');
                }
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpVerifyInFlight = false;
                otpVerifyBtn.disabled = false;
            }
        }

        function fillVerifiedPhone() {
            const bookingPhoneInput = document.getElementById('booking-phone');
            if (bookingPhoneInput) bookingPhoneInput.value = verifiedPhone;
        }

        /** Token expired or missing - send them back to verify again. */
        function requireReverification(message) {
            sessionToken = null;
            verifiedPhone = '';
            resetOtpUi();
            goToStep('wizard-step-otp');
            setOtpStatus(message || 'Please verify your phone number again.', 'error');
        }

        if (otpSendBtn) otpSendBtn.addEventListener('click', () => sendWizardOtp(false));
        if (otpResendBtn) otpResendBtn.addEventListener('click', () => sendWizardOtp(true));
        if (otpVerifyBtn) otpVerifyBtn.addEventListener('click', verifyWizardOtp);
        if (otpChangeNumberBtn) {
            otpChangeNumberBtn.addEventListener('click', () => {
                resetOtpUi();
                otpPhoneInput.focus();
            });
        }
        if (otpCodeInput) {
            otpCodeInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') verifyWizardOtp();
            });
        }

        async function apiGet(path, params) {
            const url = new URL(BOOKING_API_BASE + path);
            Object.keys(params || {}).forEach((key) => {
                if (params[key] !== null && params[key] !== undefined && params[key] !== '') {
                    url.searchParams.set(key, params[key]);
                }
            });
            const res = await fetch(url.toString());
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error((data && data.error) || 'Request failed');
            }
            return data;
        }

        function extractList(data) {
            return (data && data.response && data.response.returnvalue && data.response.returnvalue.data) || [];
        }

        async function loadServices() {
            setStatus('Loading services…');
            serviceSelect.innerHTML = '<option value="">Loading…</option>';
            try {
                const data = await apiGet('/api/services', {});
                const services = extractList(data);
                if (!services.length) {
                    serviceSelect.innerHTML = '<option value="">No services available</option>';
                    setStatus('No bookable services were found. Please book via WhatsApp instead.', 'error');
                    return;
                }
                servicesLoaded = true;
                serviceSelect.innerHTML = '<option value="">Select a service</option>' +
                    services.map((s) => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
                setStatus('');
                if (services.length === 1) {
                    serviceSelect.value = services[0].id;
                    serviceSelect.dispatchEvent(new Event('change'));
                }
            } catch (err) {
                serviceSelect.innerHTML = '<option value="">Unavailable</option>';
                setStatus('Could not load services right now. Please try again shortly or book via WhatsApp.', 'error');
            }
        }

        async function loadStaff(serviceId) {
            staffSelect.innerHTML = '<option value="">Loading…</option>';
            staffSelect.disabled = true;
            resetSlots();
            try {
                const data = await apiGet('/api/staff', { service_id: serviceId });
                const staff = extractList(data);
                if (!staff.length) {
                    staffSelect.innerHTML = '<option value="">No therapists available</option>';
                    return;
                }
                staffSelect.innerHTML = '<option value="">Select a therapist</option>' +
                    staff.map((s) => '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
                staffSelect.disabled = false;

                if (pendingStaffName) {
                    const match = staff.find((s) => (s.name || '').toLowerCase().indexOf(pendingStaffName.toLowerCase()) !== -1);
                    if (match) {
                        staffSelect.value = match.id;
                        staffSelect.dispatchEvent(new Event('change'));
                    }
                    pendingStaffName = null;
                }
            } catch (err) {
                staffSelect.innerHTML = '<option value="">Unavailable</option>';
                setStatus('Could not load therapists for this service.', 'error');
            }
        }

        async function loadSlots(serviceId, staffId, date) {
            slotsWrap.innerHTML = '<p class="booking-slots-loading">Loading available times…</p>';
            selectedSlot = null;
            try {
                const data = await apiGet('/api/availability', { service_id: serviceId, staff_id: staffId, date });
                const slots = extractList(data);
                if (!slots.length) {
                    resetSlots('No slots available on this date. Try another date.');
                    return;
                }
                slotsWrap.innerHTML = '';
                slots.forEach((slot) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'booking-slot';
                    btn.textContent = slot;
                    btn.addEventListener('click', () => {
                        slotsWrap.querySelectorAll('.booking-slot').forEach((el) => el.classList.remove('selected'));
                        btn.classList.add('selected');
                        selectedSlot = slot;
                    });
                    slotsWrap.appendChild(btn);
                });
            } catch (err) {
                resetSlots('Could not load available times. Please try a different date.');
            }
        }

        function maybeLoadSlots() {
            if (serviceSelect.value && staffSelect.value && dateInput.value) {
                loadSlots(serviceSelect.value, staffSelect.value, dateInput.value);
            } else {
                resetSlots();
            }
        }

        if (serviceSelect) {
            serviceSelect.addEventListener('change', () => {
                resetSlots();
                if (serviceSelect.value) {
                    loadStaff(serviceSelect.value);
                } else {
                    staffSelect.innerHTML = '<option value="">Select a service first</option>';
                    staffSelect.disabled = true;
                }
            });
        }

        if (staffSelect) staffSelect.addEventListener('change', maybeLoadSlots);
        if (dateInput) dateInput.addEventListener('change', maybeLoadSlots);

        function escapeHtml(str) {
            return String(str || '').replace(/[&<>"']/g, (ch) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        if (form) {
            form.addEventListener('submit', async (event) => {
                event.preventDefault();

                if (!serviceSelect.value || !staffSelect.value || !dateInput.value || !selectedSlot) {
                    setStatus('Please choose a service, therapist, date and time.', 'error');
                    return;
                }

                const name = document.getElementById('booking-name').value.trim();
                const email = document.getElementById('booking-email').value.trim();
                const notes = document.getElementById('booking-notes').value.trim();
                const hpConfirm = document.getElementById('booking-hp').value; // honeypot, must stay empty

                if (!sessionToken) {
                    requireReverification();
                    return;
                }
                if (!name || !email) {
                    setStatus('Please fill in your name and email.', 'error');
                    return;
                }

                const booking = {
                    session_token: sessionToken,
                    service_id: serviceSelect.value,
                    staff_id: staffSelect.value,
                    date: dateInput.value,
                    time: selectedSlot,
                    name: name,
                    email: email,
                    notes: notes,
                    hp_confirm: hpConfirm
                };

                submitBtn.disabled = true;
                try {
                    if (creditBookingMode) {
                        setStatus('Booking with your prepaid sessions…');
                        await submitBooking('/api/credits/book', booking, "You're booked using your prepaid sessions! Check your email for confirmation.");
                    } else {
                        await startPaidBooking(booking);
                    }
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        /** Handles the error responses shared by every booking/payment call. Returns true if handled. */
        function handleBookingError(res, data) {
            if (res.status === 401 || data.reverify) {
                requireReverification('Your verification expired. Please verify your phone number again.');
            } else if (res.status === 409 || data.slot_conflict) {
                setStatus(data.error || 'That time was just booked by someone else. Pick another time below.', 'error');
                loadSlots(serviceSelect.value, staffSelect.value, dateInput.value);
            } else {
                setStatus(data.error || 'Something went wrong while booking. Please try again or book via WhatsApp.', 'error');
            }
        }

        function finishBooking(message) {
            form.reset();
            fillVerifiedPhone();
            resetSlots();
            setStatus(message, 'success');
            setTimeout(closeModal, 3000);
        }

        /** No-payment bookings: prepaid credits, or a free service. */
        async function submitBooking(endpoint, booking, successMessage) {
            try {
                const res = await fetch(BOOKING_API_BASE + endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(booking)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    handleBookingError(res, data);
                    return;
                }
                finishBooking(successMessage);
            } catch (err) {
                setStatus('Something went wrong while booking. Please try again or book via WhatsApp.', 'error');
            }
        }

        // -----------------------------------------------------------------
        // Paid bookings: pay first (Razorpay), and the slot is only booked
        // once the payment succeeds.
        // -----------------------------------------------------------------

        async function startPaidBooking(booking) {
            if (typeof Razorpay === 'undefined') {
                setStatus('Online payment could not load. Please refresh the page or book via WhatsApp.', 'error');
                return;
            }

            setStatus('Preparing secure payment…');
            let order;
            try {
                const res = await fetch(BOOKING_API_BASE + '/api/payment/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(booking)
                });
                order = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (order.free) {
                        setStatus('Booking your session…');
                        await submitBooking('/api/book', booking, "You're booked! Check your email for confirmation.");
                        return;
                    }
                    handleBookingError(res, order);
                    return;
                }
            } catch (err) {
                setStatus('Could not start the payment. Please try again.', 'error');
                return;
            }

            await new Promise((resolve) => {
                const checkout = new Razorpay({
                    key: order.key_id,
                    order_id: order.order_id,
                    amount: order.amount,
                    currency: order.currency,
                    name: 'Mindlap',
                    description: order.service_name || 'Therapy session',
                    prefill: order.prefill,
                    theme: { color: '#4A2E80' },
                    handler: async (response) => {
                        await confirmPayment(response);
                        resolve();
                    },
                    modal: {
                        ondismiss: () => {
                            setStatus('Payment cancelled, nothing was booked or charged. You can try again.', 'error');
                            resolve();
                        }
                    }
                });
                checkout.on('payment.failed', (response) => {
                    const reason = response && response.error && response.error.description;
                    setStatus('Payment failed' + (reason ? ': ' + reason : '') + '. You can try again.', 'error');
                });
                setStatus('Complete the payment in the Razorpay window.');
                checkout.open();
            });
        }

        async function confirmPayment(response) {
            setStatus('Payment received, booking your session… please don\'t close this window.');
            try {
                const res = await fetch(BOOKING_API_BASE + '/api/payment/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        razorpay_order_id: response.razorpay_order_id,
                        razorpay_payment_id: response.razorpay_payment_id,
                        razorpay_signature: response.razorpay_signature
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    handleBookingError(res, data);
                    return;
                }
                finishBooking("Payment successful and you're booked! Check your email for confirmation.");
            } catch (err) {
                // The payment went through; the server-side webhook will still
                // finish the booking even if this request failed.
                setStatus('Your payment went through, but we could not confirm the booking here. You will get a confirmation email shortly; if not, contact us on WhatsApp with payment ID ' +
                    response.razorpay_payment_id + '.', 'error');
            }
        }
    });
})();

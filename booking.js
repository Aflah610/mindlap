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
        const paymentStepEl = document.getElementById('payment-step');
        const paymentAmountLine = document.getElementById('payment-amount-line');
        const payNowBtn = document.getElementById('pay-now-btn');
        const payLaterBtn = document.getElementById('pay-later-btn');
        const paymentStatusEl = document.getElementById('payment-status');

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
        const otpStatusEl = document.getElementById('wizard-otp-status');
        const otpVerifiedBadge = document.getElementById('wizard-otp-verified-badge');
        const creditsPackageList = document.getElementById('credits-package-list');
        const creditModeBanner = document.getElementById('credit-mode-banner');
        const bookingServiceField = document.getElementById('booking-service-field');

        const WIZARD_STEPS = ['wizard-step-otp', 'wizard-step-credits', 'wizard-step-type', 'booking-step']; // payment-step is a post-booking outcome, not a navigable step
        let currentStepIndex = 0;
        let selectedSessionType = null;
        let sessionToken = null;
        let creditBookingMode = false;
        let selectedPackage = null; // { package_id, service_id, service_name, remaining }
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
            if (paymentStepEl) paymentStepEl.hidden = (stepId !== 'payment-step');

            if (wizardBackBtn) {
                wizardBackBtn.hidden = (stepId === 'wizard-step-otp' || stepId === 'wizard-step-credits');
            }
            if (wizardProgress) wizardProgress.hidden = (stepId === 'payment-step');
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
        let pendingPayment = null; // { bookingId, amount, currency }

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
            selectedPackage = null;
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

        function getLocalDigits() {
            return otpPhoneInput.value.replace(/\D/g, '');
        }

        function getFullPhone() {
            const digits = getLocalDigits();
            return digits ? otpCountrySelect.value + digits : '';
        }

        function isValidLocalNumber() {
            const len = getLocalDigits().length;
            return otpCountrySelect.value === '+91' ? len === 10 : len >= 6 && len <= 13;
        }

        otpCountrySelect.addEventListener('change', () => {
            otpPhoneInput.maxLength = otpCountrySelect.value === '+91' ? 10 : 13;
        });

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
                    // A code can still exist even when WhatsApp delivery
                    // itself failed (the code is generated and saved before
                    // the message is sent) - so still let them type one in,
                    // rather than dead-ending on the error.
                    const deliveryFailed = /whatsapp message/i.test(data.error || '');
                    if (deliveryFailed) {
                        setOtpStatus((data.error || 'Could not send the WhatsApp message.') + ' If you already have a code, you can still enter it below.', 'error');
                        otpPhoneSubstep.hidden = true;
                        otpCodeSubstep.hidden = false;
                        otpCodeInput.value = '';
                        otpCodeInput.focus();
                        startOtpResendCooldown(60);
                    } else {
                        setOtpStatus(data.error || 'Could not send code.', 'error');
                    }
                    return;
                }

                setOtpStatus('Code sent. Check WhatsApp on that number.', 'success');
                otpPhoneSubstep.hidden = true;
                otpCodeSubstep.hidden = false;
                otpCodeInput.value = '';
                otpCodeInput.focus();
                startOtpResendCooldown(60);
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpSendBtn.disabled = false;
            }
        }

        function renderCreditPackages(packages) {
            if (!creditsPackageList) return;
            creditsPackageList.innerHTML = '';
            packages.forEach((pkg) => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'session-type-card';
                card.innerHTML =
                    '<span class="session-type-icon">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                        '<rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M2 10h20"></path></svg>' +
                    '</span>' +
                    '<span class="session-type-text">' +
                        '<span class="session-type-name">' + escapeHtml(pkg.service_name) + '</span>' +
                        '<span class="session-type-desc">' + pkg.remaining + ' session' + (pkg.remaining === 1 ? '' : 's') + ' remaining</span>' +
                    '</span>' +
                    '<svg class="session-type-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';

                card.addEventListener('click', () => selectPackage(pkg));
                creditsPackageList.appendChild(card);
            });
        }

        async function selectPackage(pkg) {
            creditBookingMode = true;
            selectedPackage = pkg;

            if (creditModeBanner) {
                creditModeBanner.hidden = false;
                creditModeBanner.innerHTML = '<p>Booking with your package: <strong>' + escapeHtml(pkg.service_name) +
                    '</strong> (' + pkg.remaining + ' remaining). No payment needed.</p>';
            }
            if (bookingServiceField) bookingServiceField.hidden = true;

            if (!servicesLoaded) {
                await loadServices();
            }
            serviceSelect.value = pkg.service_id;
            serviceSelect.dispatchEvent(new Event('change'));

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

                if (res.ok && data.has_credits && data.packages && data.packages.length) {
                    renderCreditPackages(data.packages);
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
            const phone = getFullPhone();
            const code = otpCodeInput.value.trim();
            if (!code) {
                setOtpStatus('Please enter the code.', 'error');
                return;
            }

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
                otpVerifiedBadge.classList.add('show');
                setOtpStatus('');

                const bookingPhoneInput = document.getElementById('booking-phone');
                if (bookingPhoneInput) bookingPhoneInput.value = phone;

                if (sessionToken) {
                    await checkCreditsAndAdvance();
                } else {
                    goToStep('wizard-step-type');
                }
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpVerifyBtn.disabled = false;
            }
        }

        if (otpSendBtn) otpSendBtn.addEventListener('click', () => sendWizardOtp(false));
        if (otpResendBtn) otpResendBtn.addEventListener('click', () => sendWizardOtp(true));
        if (otpVerifyBtn) otpVerifyBtn.addEventListener('click', verifyWizardOtp);
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
                const phone = document.getElementById('booking-phone').value.trim();
                const notes = document.getElementById('booking-notes').value.trim();
                const hpConfirm = document.getElementById('booking-hp').value; // honeypot, must stay empty

                if (!name || !email || !phone) {
                    setStatus('Please fill in your name, email and phone number.', 'error');
                    return;
                }

                submitBtn.disabled = true;
                setStatus(creditBookingMode ? 'Booking with your package…' : 'Booking your session…');

                try {
                    const endpoint = creditBookingMode ? '/api/credits/book' : '/api/book';
                    const body = creditBookingMode
                        ? {
                            session_token: sessionToken,
                            package_id: selectedPackage && selectedPackage.package_id,
                            service_id: serviceSelect.value,
                            staff_id: staffSelect.value,
                            date: dateInput.value,
                            time: selectedSlot,
                            name: name,
                            email: email,
                            notes: notes,
                            hp_confirm: hpConfirm
                        }
                        : {
                            service_id: serviceSelect.value,
                            staff_id: staffSelect.value,
                            date: dateInput.value,
                            time: selectedSlot,
                            name: name,
                            email: email,
                            phone: phone,
                            notes: notes,
                            hp_confirm: hpConfirm,
                            timezone: 'Asia/Calcutta'
                        };

                    const res = await fetch(BOOKING_API_BASE + endpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    const data = await res.json().catch(() => ({}));

                    if (!res.ok) {
                        if (res.status === 409 || data.slot_conflict) {
                            // Someone else booked this exact time first.
                            setStatus('That time was just booked by someone else. Pick another time below.', 'error');
                            loadSlots(serviceSelect.value, staffSelect.value, dateInput.value);
                        } else {
                            setStatus(data.error || 'Something went wrong while booking. Please try again or book via WhatsApp.', 'error');
                        }
                        return;
                    }

                    form.reset();
                    resetSlots();

                    if (creditBookingMode) {
                        // Already paid for via the package - no payment step.
                        setStatus("You're booked using your package! Check your email for confirmation.", 'success');
                        setTimeout(closeModal, 2500);
                        return;
                    }

                    setStatus("You're booked! Check your email for confirmation.", 'success');

                    const returnvalue = (data.response && data.response.returnvalue) || {};
                    const bookingId = returnvalue.booking_id;
                    const amount = Number(returnvalue.due != null ? returnvalue.due : returnvalue.cost) || 0;
                    const currency = returnvalue.currency || 'INR';

                    if (bookingId && amount > 0) {
                        showPaymentStep(bookingId, amount, currency);
                    } else {
                        setTimeout(closeModal, 2500);
                    }
                } catch (err) {
                    setStatus('Something went wrong while booking. Please try again or book via WhatsApp.', 'error');
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        // -----------------------------------------------------------------
        // Payment (Razorpay), shown right after a booking is confirmed
        // -----------------------------------------------------------------

        function setPaymentStatus(message, type) {
            if (!paymentStatusEl) return;
            paymentStatusEl.textContent = message || '';
            paymentStatusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function showPaymentStep(bookingId, amount, currency) {
            pendingPayment = { bookingId, amount, currency };
            if (bookingStepEl) bookingStepEl.hidden = true;
            if (paymentStepEl) paymentStepEl.hidden = false;
            if (wizardBackBtn) wizardBackBtn.hidden = true;
            if (wizardProgress) wizardProgress.hidden = true;
            setPaymentStatus('');
            if (paymentAmountLine) {
                const symbol = currency === 'INR' ? '₹' : currency + ' ';
                paymentAmountLine.textContent = 'Amount due: ' + symbol + amount;
            }
        }

        async function startPayment() {
            if (!pendingPayment || typeof Razorpay === 'undefined') {
                setPaymentStatus('Payment is unavailable right now. Please pay later or contact us.', 'error');
                return;
            }

            payNowBtn.disabled = true;
            setPaymentStatus('Preparing payment…');

            try {
                const orderRes = await fetch(BOOKING_API_BASE + '/api/payment/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        booking_id: pendingPayment.bookingId,
                        amount: pendingPayment.amount,
                        currency: pendingPayment.currency
                    })
                });
                const order = await orderRes.json().catch(() => ({}));

                if (!orderRes.ok || !order.order_id) {
                    setPaymentStatus(order.error || 'Could not start payment. Please try again.', 'error');
                    return;
                }

                const checkout = new Razorpay({
                    key: order.key_id,
                    order_id: order.order_id,
                    amount: order.amount,
                    currency: order.currency,
                    name: 'Mindlap',
                    description: 'Therapy session booking',
                    theme: { color: '#4A2E80' },
                    handler: async (response) => {
                        setPaymentStatus('Confirming payment…');
                        try {
                            const verifyRes = await fetch(BOOKING_API_BASE + '/api/payment/verify', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_signature: response.razorpay_signature,
                                    booking_id: pendingPayment.bookingId
                                })
                            });
                            const verifyData = await verifyRes.json().catch(() => ({}));

                            if (!verifyRes.ok || !verifyData.success) {
                                setPaymentStatus(verifyData.error || 'Payment could not be verified. Please contact us.', 'error');
                                return;
                            }

                            setPaymentStatus('Payment successful, thank you!', 'success');
                            setTimeout(closeModal, 2000);
                        } catch (err) {
                            setPaymentStatus('Payment could not be verified. Please contact us.', 'error');
                        }
                    },
                    modal: {
                        ondismiss: () => {
                            setPaymentStatus('Payment cancelled. You can try again or pay later.', 'error');
                        }
                    }
                });

                checkout.open();
                setPaymentStatus('');
            } catch (err) {
                setPaymentStatus('Could not start payment. Please try again.', 'error');
            } finally {
                payNowBtn.disabled = false;
            }
        }

        if (payNowBtn) payNowBtn.addEventListener('click', startPayment);
        if (payLaterBtn) payLaterBtn.addEventListener('click', closeModal);
    });
})();

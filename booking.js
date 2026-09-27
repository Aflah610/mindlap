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

        // --- Wizard chrome (session type -> details -> payment) ---
        const wizardBackBtn = document.getElementById('wizard-back-btn');
        const wizardProgress = document.getElementById('wizard-progress');
        const wizardTypeStep = document.getElementById('wizard-step-type');
        const sessionTypeCards = document.querySelectorAll('.session-type-card');

        const WIZARD_STEPS = ['wizard-step-type', 'booking-step']; // payment-step is a post-booking outcome, not a navigable step
        let currentStepIndex = 0;
        let selectedSessionType = null;

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

            if (wizardBackBtn) wizardBackBtn.hidden = (stepId === 'wizard-step-type');
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
                    goToStep('wizard-step-type');
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
            // Always start a fresh visit at the session-type step.
            selectedSessionType = null;
            sessionTypeCards.forEach((c) => c.classList.remove('selected'));
            goToStep('wizard-step-type');
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
                setStatus('Booking your session…');

                try {
                    const res = await fetch(BOOKING_API_BASE + '/api/book', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
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
                        })
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

                    setStatus("You're booked! Check your email for confirmation.", 'success');

                    const returnvalue = (data.response && data.response.returnvalue) || {};
                    const bookingId = returnvalue.booking_id;
                    const amount = Number(returnvalue.due != null ? returnvalue.due : returnvalue.cost) || 0;
                    const currency = returnvalue.currency || 'INR';

                    form.reset();
                    resetSlots();

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

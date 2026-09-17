/* -------------------------------------------------------------
   Mindlap - Book Online (OTP verify, then Zoho Bookings via
   Cloudflare Worker)
   -------------------------------------------------------------
   This talks to a small Cloudflare Worker (see /worker) that
   proxies the Zoho Bookings REST API and the Zoho Creator OTP
   functions, so no Zoho credentials are ever exposed in the
   browser.

   Flow: the modal opens on a phone verification step (Send_OTP /
   Verify_OTP via Zoho Creator). Once verified, it reveals the
   existing service/therapist/date booking form, with the phone
   number carried over automatically.

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
        const bookingPhoneInput = document.getElementById('booking-phone');

        // --- OTP step elements ---
        const otpStep = document.getElementById('modal-otp-step');
        const bookingStep = document.getElementById('modal-booking-step');
        const otpPhoneSubstep = document.getElementById('modal-otp-phone-substep');
        const otpCodeSubstep = document.getElementById('modal-otp-code-substep');
        const otpPhoneInput = document.getElementById('modal-otp-phone');
        const otpCodeInput = document.getElementById('modal-otp-code');
        const otpSendBtn = document.getElementById('modal-otp-send-btn');
        const otpVerifyBtn = document.getElementById('modal-otp-verify-btn');
        const otpResendBtn = document.getElementById('modal-otp-resend-btn');
        const otpStatusEl = document.getElementById('modal-otp-status');
        const otpVerifiedBadge = document.getElementById('modal-otp-verified-badge');

        let servicesLoaded = false;
        let selectedSlot = null;
        let pendingStaffName = null;
        let verifiedPhone = null;
        let resendCooldownTimer = null;

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

        function setOtpStatus(message, type) {
            if (!otpStatusEl) return;
            otpStatusEl.textContent = message || '';
            otpStatusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function resetSlots(message) {
            selectedSlot = null;
            slotsWrap.innerHTML = '<p class="booking-slots-empty">' + (message || 'Choose a service, therapist and date to see available times.') + '</p>';
        }

        function showOtpStep() {
            otpStep.hidden = false;
            bookingStep.hidden = true;
        }

        function showBookingStep() {
            otpStep.hidden = true;
            bookingStep.hidden = false;
            if (!servicesLoaded) {
                loadServices();
            }
        }

        function resetOtpUi() {
            otpPhoneSubstep.hidden = false;
            otpCodeSubstep.hidden = true;
            otpVerifiedBadge.classList.remove('show');
            otpCodeInput.value = '';
            setOtpStatus('');
            clearInterval(resendCooldownTimer);
            otpResendBtn.disabled = false;
            otpResendBtn.textContent = 'Resend code';
        }

        function openModal(staffName) {
            pendingStaffName = staffName || null;
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';

            if (verifiedPhone) {
                // Already verified earlier in this page visit, skip straight in.
                showBookingStep();
            } else {
                resetOtpUi();
                showOtpStep();
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

        // ---------------------------------------------------------------
        // OTP: send / resend / verify
        // ---------------------------------------------------------------

        function startResendCooldown(seconds) {
            let remaining = seconds;
            otpResendBtn.disabled = true;
            otpResendBtn.textContent = 'Resend code (' + remaining + 's)';
            clearInterval(resendCooldownTimer);
            resendCooldownTimer = setInterval(() => {
                remaining -= 1;
                if (remaining <= 0) {
                    clearInterval(resendCooldownTimer);
                    otpResendBtn.disabled = false;
                    otpResendBtn.textContent = 'Resend code';
                } else {
                    otpResendBtn.textContent = 'Resend code (' + remaining + 's)';
                }
            }, 1000);
        }

        async function sendOtp(isResend) {
            const phone = otpPhoneInput.value.trim();
            if (!phone) {
                setOtpStatus('Please enter a phone number.', 'error');
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
                    setOtpStatus(data.error || 'Could not send code.', 'error');
                    return;
                }

                setOtpStatus('Code sent. Check WhatsApp on that number.', 'success');
                otpPhoneSubstep.hidden = true;
                otpCodeSubstep.hidden = false;
                otpCodeInput.value = '';
                otpCodeInput.focus();
                startResendCooldown(60);
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpSendBtn.disabled = false;
            }
        }

        async function verifyOtp() {
            const phone = otpPhoneInput.value.trim();
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

                verifiedPhone = phone;
                otpVerifiedBadge.classList.add('show');
                setOtpStatus('');

                if (bookingPhoneInput) {
                    bookingPhoneInput.value = phone;
                }

                setTimeout(showBookingStep, 600);
            } catch (err) {
                setOtpStatus('Network error, please try again.', 'error');
            } finally {
                otpVerifyBtn.disabled = false;
            }
        }

        if (otpSendBtn) otpSendBtn.addEventListener('click', () => sendOtp(false));
        if (otpResendBtn) otpResendBtn.addEventListener('click', () => sendOtp(true));
        if (otpVerifyBtn) otpVerifyBtn.addEventListener('click', verifyOtp);
        if (otpCodeInput) {
            otpCodeInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') verifyOtp();
            });
        }

        // ---------------------------------------------------------------
        // Booking form (service / therapist / date / slots)
        // ---------------------------------------------------------------

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
                    form.reset();
                    if (verifiedPhone) bookingPhoneInput.value = verifiedPhone;
                    resetSlots();
                    setTimeout(closeModal, 2500);
                } catch (err) {
                    setStatus('Something went wrong while booking. Please try again or book via WhatsApp.', 'error');
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }
    });
})();

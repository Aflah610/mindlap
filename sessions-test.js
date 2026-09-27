/* -------------------------------------------------------------
   Mindlap - "My Sessions" test harness (internal only)
   -------------------------------------------------------------
   Standalone page, not linked from the site. Verifies a phone
   number via OTP, then fetches that customer's past/upcoming
   appointments from Zoho Creator through the same Worker used by
   booking.js.
   ------------------------------------------------------------- */

(function () {
    'use strict';

    const BOOKING_API_BASE = 'https://mindlap-booking-api.nasheel.workers.dev';

    document.addEventListener('DOMContentLoaded', () => {
        const phoneInput = document.getElementById('otp-phone');
        const codeInput = document.getElementById('otp-code');
        const sendBtn = document.getElementById('otp-send-btn');
        const verifyBtn = document.getElementById('otp-verify-btn');
        const resendBtn = document.getElementById('otp-resend-btn');
        const stepPhone = document.getElementById('otp-step-phone');
        const stepCode = document.getElementById('otp-step-code');
        const statusEl = document.getElementById('otp-status');
        const verifiedBadge = document.getElementById('otp-verified-badge');
        const sessionsWrap = document.getElementById('sessions-wrap');
        const upcomingList = document.getElementById('upcoming-list');
        const pastList = document.getElementById('past-list');

        let resendCooldown = 0;
        let resendTimer = null;

        function setStatus(message, type) {
            statusEl.textContent = message || '';
            statusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function startResendCooldown(seconds) {
            resendCooldown = seconds;
            resendBtn.disabled = true;
            resendBtn.textContent = 'Resend code (' + resendCooldown + 's)';
            clearInterval(resendTimer);
            resendTimer = setInterval(() => {
                resendCooldown -= 1;
                if (resendCooldown <= 0) {
                    clearInterval(resendTimer);
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend code';
                } else {
                    resendBtn.textContent = 'Resend code (' + resendCooldown + 's)';
                }
            }, 1000);
        }

        async function sendOtp(isResend) {
            const phone = phoneInput.value.trim();
            if (!phone) {
                setStatus('Please enter a phone number.', 'error');
                return;
            }

            sendBtn.disabled = true;
            setStatus(isResend ? 'Resending code…' : 'Sending code…');

            try {
                const res = await fetch(BOOKING_API_BASE + '/api/otp/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    setStatus(data.error || 'Could not send code.', 'error');
                    return;
                }

                setStatus('Code sent. Check WhatsApp on that number.', 'success');
                stepPhone.hidden = true;
                stepCode.hidden = false;
                codeInput.value = '';
                codeInput.focus();
                startResendCooldown(60);
            } catch (err) {
                setStatus('Network error, please try again.', 'error');
            } finally {
                sendBtn.disabled = false;
            }
        }

        function escapeHtml(str) {
            return String(str || '').replace(/[&<>"']/g, (ch) => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[ch]));
        }

        function renderSessionCard(session) {
            const div = document.createElement('div');
            div.className = 'session-card';
            div.innerHTML =
                '<div class="session-card-top">' +
                    '<span class="session-card-service">' + escapeHtml(session.service_name) + '</span>' +
                    '<span class="session-card-badge">' + escapeHtml(session.booking_status) + '</span>' +
                '</div>' +
                '<span class="session-card-meta">' + escapeHtml(session.date) + ' &middot; ' +
                    escapeHtml((session.start_time || '').slice(0, 5)) + '</span>' +
                '<span class="session-card-meta">With ' + escapeHtml(session.therapist_name || 'your therapist') +
                    ' &middot; ' + escapeHtml(session.session_mode) + '</span>';
            return div;
        }

        function renderSessions(data) {
            upcomingList.innerHTML = '';
            pastList.innerHTML = '';

            if (!data.upcoming || !data.upcoming.length) {
                upcomingList.innerHTML = '<p class="sessions-empty">No upcoming sessions.</p>';
            } else {
                data.upcoming.forEach((s) => upcomingList.appendChild(renderSessionCard(s)));
            }

            if (!data.past || !data.past.length) {
                pastList.innerHTML = '<p class="sessions-empty">No past sessions yet.</p>';
            } else {
                data.past.forEach((s) => pastList.appendChild(renderSessionCard(s)));
            }

            sessionsWrap.hidden = false;
        }

        async function fetchSessions(sessionToken) {
            setStatus('Loading your sessions…');
            try {
                const res = await fetch(BOOKING_API_BASE + '/api/sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_token: sessionToken })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok) {
                    setStatus(data.error || 'Could not load sessions.', 'error');
                    return;
                }

                setStatus('');
                renderSessions(data);
            } catch (err) {
                setStatus('Network error while loading sessions.', 'error');
            }
        }

        async function verifyOtp() {
            const phone = phoneInput.value.trim();
            const code = codeInput.value.trim();
            if (!code) {
                setStatus('Please enter the code.', 'error');
                return;
            }

            verifyBtn.disabled = true;
            setStatus('Verifying…');

            try {
                const res = await fetch(BOOKING_API_BASE + '/api/otp/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, code })
                });
                const data = await res.json().catch(() => ({}));

                if (!res.ok || !data.success) {
                    setStatus(data.error || 'Incorrect or expired code.', 'error');
                    return;
                }

                stepCode.hidden = true;
                verifiedBadge.classList.add('show');

                if (data.session_token) {
                    await fetchSessions(data.session_token);
                } else {
                    setStatus('Verified, but no session token was returned.', 'error');
                }
            } catch (err) {
                setStatus('Network error, please try again.', 'error');
            } finally {
                verifyBtn.disabled = false;
            }
        }

        sendBtn.addEventListener('click', () => sendOtp(false));
        resendBtn.addEventListener('click', () => sendOtp(true));
        verifyBtn.addEventListener('click', verifyOtp);
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') verifyOtp();
        });
    });
})();

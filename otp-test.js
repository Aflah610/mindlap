/* -------------------------------------------------------------
   Mindlap - OTP verification test harness (internal only)
   -------------------------------------------------------------
   Standalone page, not linked from the site, used to confirm the
   Send_OTP / Verify_OTP flow works end to end through the
   Cloudflare Worker before it gets wired into the real booking
   form. Talks to the same Worker as booking.js.
   ------------------------------------------------------------- */

(function () {
    'use strict';

    // Same Worker used by booking.js.
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

        let resendCooldown = 0;
        let resendTimer = null;

        function setStatus(message, type) {
            statusEl.textContent = message || '';
            statusEl.className = 'booking-status' + (type ? ' ' + type : '');
        }

        function startResendCooldown(seconds) {
            resendCooldown = seconds;
            resendBtn.disabled = true;
            updateResendLabel();
            clearInterval(resendTimer);
            resendTimer = setInterval(() => {
                resendCooldown -= 1;
                if (resendCooldown <= 0) {
                    clearInterval(resendTimer);
                    resendBtn.disabled = false;
                    resendBtn.textContent = 'Resend code';
                } else {
                    updateResendLabel();
                }
            }, 1000);
        }

        function updateResendLabel() {
            resendBtn.textContent = 'Resend code (' + resendCooldown + 's)';
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

                setStatus('', '');
                stepCode.hidden = true;
                verifiedBadge.classList.add('show');
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

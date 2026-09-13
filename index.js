/* -------------------------------------------------------------
   Mindlap Platform - Core JS Functionality
   Handles: Nav Scroll, Mobile Menu, FAQ Accordion, Modal popups, Self-Assessment Quiz
   ------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. HEADER SCROLL STATE ---
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // --- 2. MOBILE MENU NAVIGATION ---
    const mobileToggle = document.getElementById('mobile-toggle');
    const navMenu = document.getElementById('nav-menu');
    const navLinks = document.querySelectorAll('.nav-link');

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navMenu.classList.toggle('open');
            mobileToggle.classList.toggle('active');
            
            const isOpen = mobileToggle.classList.contains('active');
            mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            
            // Animating hamburger bars
            const bars = mobileToggle.querySelectorAll('.bar');
            if (isOpen) {
                bars[0].style.transform = 'rotate(-45deg) translate(-5px, 6px)';
                bars[1].style.opacity = '0';
                bars[2].style.transform = 'rotate(45deg) translate(-5px, -6px)';
            } else {
                bars[0].style.transform = 'none';
                bars[1].style.opacity = '1';
                bars[2].style.transform = 'none';
            }
        });
    }

    // Close menu when navigation link is clicked
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.remove('open');
            if (mobileToggle) {
                mobileToggle.classList.remove('active');
                mobileToggle.setAttribute('aria-expanded', 'false');
                const bars = mobileToggle.querySelectorAll('.bar');
                bars[0].style.transform = 'none';
                bars[1].style.opacity = '1';
                bars[2].style.transform = 'none';
            }
            
            // Set active class
            navLinks.forEach(item => item.classList.remove('active'));
            link.classList.add('active');
        });
    });

    // --- 3. FAQ ACCORDION ---
    const faqItems = document.querySelectorAll('.faq-item');
    
    faqItems.forEach(item => {
        const trigger = item.querySelector('.faq-trigger');
        const content = item.querySelector('.faq-content');
        
        trigger.addEventListener('click', () => {
            const isActive = item.classList.contains('active');
            
            // Close all other FAQs
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
                otherItem.querySelector('.faq-content').style.maxHeight = null;
            });
            
            // Toggle current FAQ
            if (!isActive) {
                item.classList.add('active');
                content.style.maxHeight = content.scrollHeight + 'px';
            }
        });
    });

    // --- 4. THERAPIST DETAIL NAVIGATION ---
    // (Deprecated modals list; navigation is handled directly via <a> links in HTML)

    // --- 5. SELF-ASSESSMENT ---
    const categoryGrid = document.getElementById('category-grid');

    if (categoryGrid) {
        const WA_NUMBER = '917594000774';

        const SCALE = [
            { value: 0, label: 'Never' },
            { value: 1, label: 'Rarely' },
            { value: 2, label: 'Sometimes' },
            { value: 3, label: 'Often' },
            { value: 4, label: 'Very often' }
        ];

        const THERAPISTS = {
            anasooya: {
                name: 'Anasooya Pramod',
                role: 'Consultant Psychologist',
                focus: 'Stress & Anxiety Support, Trauma-Informed Care, Mindfulness & Self-Awareness',
                img: 'assets/anasooya_bg.jpeg',
                profileUrl: 'anasooya.html'
            },
            gouri: {
                name: 'Gouri Nandhana',
                role: 'Consultant Psychologist',
                focus: 'Depression & Anxiety, Couples Therapy, Trauma & PTSD',
                img: 'assets/gouri_bg.jpeg',
                profileUrl: 'gouri.html'
            },
            sajitha: {
                name: 'Sajitha KT',
                role: 'Consultant Psychologist',
                focus: 'Stress & Anxiety Management, Behaviour Modification, Trauma Therapy',
                img: 'assets/sajitha_bg.jpeg',
                profileUrl: 'sajitha.html'
            },
            athira: {
                name: 'Athira Asok',
                role: 'Consultant Psychologist',
                focus: 'Depression & Anxiety, Stress & Crisis Management, Couples Therapy',
                img: 'assets/athira_bg.jpeg',
                profileUrl: 'athira.html'
            },
            rashin: {
                name: 'Rashin PK',
                role: 'Consultant Psychologist',
                focus: 'Mood Disorders, Couples Therapy, Emotional Impulsiveness',
                img: 'assets/rashin_bg.jpeg',
                profileUrl: 'rashin.html'
            },
            theresa: {
                name: 'Theresa P Thomas',
                role: 'Consultant Psychologist',
                focus: 'Stress & Anxiety Management, Positive Behavioural Change, Anger Regulation',
                img: 'assets/theresa_bg.jpeg',
                profileUrl: 'theresa.html'
            }
        };

        const CATEGORIES = [
            {
                key: 'anxiety',
                label: 'Anxiety',
                blurb: 'Worry, tension, restlessness',
                noun: 'anxiety',
                icon: '<path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"></path><polyline points="13 11 9 17 15 17 11 23"></polyline>',
                match: { higher: 'anasooya', lower: 'theresa' },
                questions: [
                    'Do you feel worried often?',
                    'Do you feel tense or restless?',
                    'Do you feel afraid easily?',
                    'Do you have trouble sleeping?',
                    'Do you find it hard to concentrate?',
                    'Do you have physical symptoms when anxious?',
                    'Do unwanted thoughts keep coming back?',
                    'Do you feel the need to repeat certain actions?',
                    'Do you feel nervous around other people?',
                    'Do you worry about being judged by others?'
                ]
            },
            {
                key: 'depression',
                label: 'Depression',
                blurb: 'Low mood, loss of interest',
                noun: 'low mood',
                icon: '<line x1="16" y1="13" x2="16" y2="21"></line><line x1="8" y1="13" x2="8" y2="21"></line><line x1="12" y1="15" x2="12" y2="23"></line><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"></path>',
                match: { higher: 'gouri', lower: 'athira' },
                crisisIndex: 9,
                questions: [
                    'Do you feel sad often?',
                    'Have you lost interest in things you enjoy?',
                    'Do you feel hopeless about the future?',
                    'Do you feel tired or low on energy?',
                    'Do you have trouble sleeping?',
                    'Do you feel bad about yourself?',
                    'Do you find it hard to concentrate?',
                    'Have your eating habits changed?',
                    'Do you feel like crying often?',
                    'Do you feel that life is not worth living?'
                ]
            },
            {
                key: 'relationship',
                label: 'Relationship',
                blurb: 'Connection, trust, conflict',
                noun: 'relationship strain',
                icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
                match: { higher: 'rashin', lower: 'gouri' },
                // These read positively, so a high answer means things are going well.
                reverse: [0, 1, 2, 3, 4, 7, 9],
                questions: [
                    'Do you feel happy in your relationship?',
                    'Do you feel understood by your partner?',
                    'Do you trust your partner?',
                    'Do you communicate openly with your partner?',
                    'Do you feel supported by your partner?',
                    'Do you often argue with your partner?',
                    'Do you feel ignored or neglected?',
                    'Do you feel comfortable being yourself?',
                    'Do you worry about losing your partner?',
                    'Do you feel satisfied with your relationship?'
                ]
            },
            {
                key: 'stress',
                label: 'Stress',
                blurb: 'Pressure, overwhelm, burnout',
                noun: 'stress',
                icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
                match: { higher: 'sajitha', lower: 'athira' },
                questions: [
                    'Do you feel overwhelmed easily?',
                    'Do you feel under pressure?',
                    'Do you find it hard to relax?',
                    'Do you feel irritated often?',
                    'Do you worry about small things?',
                    'Do you feel mentally exhausted?',
                    'Do you have trouble concentrating?',
                    'Do you feel tired even after resting?',
                    'Do you have trouble sleeping due to stress?',
                    'Do you feel unable to handle your problems?'
                ]
            },
            {
                key: 'loneliness',
                label: 'Loneliness',
                blurb: 'Feeling alone or disconnected',
                noun: 'loneliness',
                icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
                match: { higher: 'anasooya', lower: 'theresa' },
                questions: [
                    'Do you feel lonely often?',
                    'Do you feel alone even with others?',
                    'Do you feel left out?',
                    'Do you feel disconnected from others?',
                    'Do you wish you had someone to talk to?',
                    'Do you find it hard to make friends?',
                    'Do you feel that others do not understand you?',
                    'Do you feel you have no one to rely on?',
                    'Do you avoid social situations?',
                    'Do you wish you had closer relationships?'
                ]
            },
            {
                key: 'other',
                label: 'Something else',
                blurb: 'Confidence, anger, burnout',
                noun: 'what you described',
                icon: '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
                match: { higher: 'rashin', lower: 'sajitha' },
                questions: [
                    'Do you feel low in confidence?',
                    'Do you doubt yourself often?',
                    'Do you struggle to control your anger?',
                    'Do you have trouble sleeping?',
                    'Do you feel burned out or exhausted?',
                    'Do you find it hard to make decisions?',
                    'Do you worry about your appearance?',
                    'Do you avoid things because of fear?',
                    'Do you find it hard to manage your emotions?',
                    'Do you feel overwhelmed by daily life?'
                ]
            }
        ];

        const BANDS = [
            {
                max: 9,
                key: 'low',
                label: 'Low',
                copy: function (n) { return 'Your answers suggest ' + n + ' is not weighing on you heavily at the moment. That is worth protecting — a session can help you build on what is already working.'; }
            },
            {
                max: 19,
                key: 'mild',
                label: 'Mild',
                copy: function (n) { return 'Your answers point to some mild ' + n + '. Talking it through early often stops it from building up.'; }
            },
            {
                max: 29,
                key: 'moderate',
                label: 'Moderate',
                copy: function (n) { return 'Your answers suggest ' + n + ' is affecting you fairly regularly. Structured, professional support can make a real difference here.'; }
            },
            {
                max: 40,
                key: 'high',
                label: 'High',
                copy: function (n) { return 'Your answers suggest ' + n + ' is weighing on you a great deal right now. You do not have to carry this alone — speaking with a professional soon is a good next step.'; }
            }
        ];

        const MAX_SCORE = SCALE[SCALE.length - 1].value * 10;

        const screens = {
            category: document.getElementById('screen-category'),
            question: document.getElementById('screen-question'),
            result: document.getElementById('screen-result')
        };
        const progressWrap = document.getElementById('assessment-progress-wrap');
        const progressBarEl = document.getElementById('assessment-progress');
        const chipEl = document.getElementById('assessment-chip');
        const countEl = document.getElementById('assessment-count');
        const questionEl = document.getElementById('question-text');
        const scaleListEl = document.getElementById('scale-list');
        const backBtn = document.getElementById('assessment-back');
        const cardEl = document.querySelector('.assessment-card');

        let current = null;
        let index = 0;
        let answers = [];

        function icon(inner, cls) {
            return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
        }

        function showScreen(name) {
            Object.keys(screens).forEach(function (key) {
                screens[key].classList.toggle('active', key === name);
            });
            progressWrap.hidden = (name === 'category');
        }

        // Screens differ a lot in height, so the top of the card can end up above
        // the fold after a switch. Only scroll when it actually has.
        function keepCardInView() {
            if (cardEl.getBoundingClientRect().top < 0) {
                cardEl.scrollIntoView({ block: 'start' });
            }
        }

        function buildCategories() {
            categoryGrid.innerHTML = CATEGORIES.map(function (cat) {
                return '<button type="button" class="category-tile" data-key="' + cat.key + '">' +
                    '<span class="category-icon">' + icon(cat.icon, 'category-svg') + '</span>' +
                    '<span class="category-label">' + cat.label + '</span>' +
                    '<span class="category-blurb">' + cat.blurb + '</span>' +
                    '</button>';
            }).join('');

            categoryGrid.querySelectorAll('.category-tile').forEach(function (tile) {
                tile.addEventListener('click', function () {
                    const cat = CATEGORIES.find(function (c) { return c.key === tile.dataset.key; });
                    start(cat);
                });
            });
        }

        function start(cat) {
            current = cat;
            index = 0;
            answers = [];
            chipEl.textContent = cat.label;
            showScreen('question');
            renderQuestion();
        }

        function renderQuestion() {
            const total = current.questions.length;
            questionEl.textContent = current.questions[index];
            countEl.textContent = 'Question ' + (index + 1) + ' of ' + total;
            progressBarEl.style.width = (((index) / total) * 100) + '%';

            scaleListEl.innerHTML = SCALE.map(function (opt) {
                const selected = answers[index] === opt.value ? ' is-selected' : '';
                return '<button type="button" class="scale-option' + selected + '" data-value="' + opt.value + '">' +
                    '<span class="scale-value">' + opt.value + '</span>' +
                    '<span class="scale-label">' + opt.label + '</span>' +
                    '</button>';
            }).join('');

            scaleListEl.querySelectorAll('.scale-option').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    answers[index] = parseInt(btn.dataset.value, 10);
                    if (index === current.questions.length - 1) {
                        progressBarEl.style.width = '100%';
                        showResult();
                    } else {
                        index++;
                        renderQuestion();
                    }
                });
            });

            backBtn.textContent = '';
            backBtn.insertAdjacentHTML('afterbegin',
                icon('<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>', '') +
                (index === 0 ? 'Choose a different area' : 'Previous question'));
        }

        function goBack() {
            if (index === 0) {
                current = null;
                showScreen('category');
            } else {
                index--;
                renderQuestion();
            }
        }

        function scoreOf() {
            const reverse = current.reverse || [];
            return answers.reduce(function (sum, value, i) {
                const v = typeof value === 'number' ? value : 0;
                return sum + (reverse.indexOf(i) !== -1 ? (4 - v) : v);
            }, 0);
        }

        function bandFor(score) {
            for (let i = 0; i < BANDS.length; i++) {
                if (score <= BANDS[i].max) return BANDS[i];
            }
            return BANDS[BANDS.length - 1];
        }

        function showResult() {
            const score = scoreOf();
            const band = bandFor(score);
            const isHigher = band.key === 'moderate' || band.key === 'high';
            const therapist = THERAPISTS[isHigher ? current.match.higher : current.match.lower];
            const pct = Math.round((score / MAX_SCORE) * 100);

            const needsCrisisNote = typeof current.crisisIndex === 'number' &&
                answers[current.crisisIndex] >= 2;

            const waText = 'Hello Mindlap, I completed the self-check (' + current.label + ' - ' + band.label +
                ') and would like to book a therapy session with ' + therapist.name + '.';

            const crisisBlock = needsCrisisNote
                ? '<div class="result-crisis">' +
                    '<strong>Please reach out today.</strong>' +
                    '<p>You mentioned thoughts that life may not be worth living. You deserve support right now, ' +
                    'not later. Tele-MANAS, India’s free 24/7 mental health helpline, is on ' +
                    '<a href="tel:14416">14416</a>, and KIRAN is on <a href="tel:18005990019">1800-599-0019</a>. ' +
                    'If you are in immediate danger, call <a href="tel:112">112</a>.</p>' +
                  '</div>'
                : '';

            screens.result.innerHTML =
                '<div class="result-head">' +
                    '<div class="result-ring" style="background: conic-gradient(var(--accent-color) ' + pct + '%, rgba(142, 102, 222, 0.16) ' + pct + '%)">' +
                        '<div class="result-ring-inner">' +
                            '<span class="result-score">' + score + '</span>' +
                            '<span class="result-total">of ' + MAX_SCORE + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="result-summary">' +
                        '<span class="result-band result-band-' + band.key + '">' + band.label + ' • ' + current.label + '</span>' +
                        '<h3 class="result-title">We are here to support you.</h3>' +
                        '<p class="result-description">' + band.copy(current.noun) + '</p>' +
                    '</div>' +
                '</div>' +
                crisisBlock +
                '<div class="result-rec">' +
                    '<p class="result-rec-header">Recommended specialist for you</p>' +
                    '<div class="result-rec-body">' +
                        '<img src="' + therapist.img + '" alt="' + therapist.name + '" class="result-rec-avatar" width="72" height="72" loading="lazy">' +
                        '<div class="result-rec-details">' +
                            '<h4>' + therapist.name + '</h4>' +
                            '<span class="result-rec-role">' + therapist.role + '</span>' +
                            '<p class="result-rec-focus">' + therapist.focus + '</p>' +
                            '<a href="' + therapist.profileUrl + '" class="result-rec-link">View detailed profile</a>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="result-actions">' +
                    '<button type="button" class="btn btn-outline" id="assessment-restart">Start over</button>' +
                    '<a href="https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(waText) + '" target="_blank" class="btn btn-primary">Book therapy session</a>' +
                '</div>';

            screens.result.querySelector('#assessment-restart').addEventListener('click', reset);
            showScreen('result');
            keepCardInView();
        }

        function reset() {
            current = null;
            index = 0;
            answers = [];
            progressBarEl.style.width = '0%';
            showScreen('category');
            keepCardInView();
        }

        backBtn.addEventListener('click', goBack);
        buildCategories();
    }

    // --- 6. TESTIMONIAL LIGHTBOX ---
    const lightboxModal = document.getElementById('lightbox-modal');
    if (lightboxModal) {
        const testimonialImages = document.querySelectorAll('.testimonial-image');
        const lightboxImg = document.getElementById('lightbox-img');
        const lightboxClose = lightboxModal.querySelector('.lightbox-close');
        const lightboxPrev = lightboxModal.querySelector('.lightbox-prev');
        const lightboxNext = lightboxModal.querySelector('.lightbox-next');
        const lightboxCounter = lightboxModal.querySelector('.lightbox-counter');
        const testimonialsGrid = document.querySelector('.testimonials-grid');

        let currentImgIndex = 0;
        const uniqueImageSources = [];
        const uniqueImageAlts = [];

        // Dynamically build arrays of unique images based on data-index attributes
        testimonialImages.forEach(img => {
            const indexVal = parseInt(img.getAttribute('data-index'), 10);
            if (!isNaN(indexVal) && uniqueImageSources[indexVal] === undefined) {
                uniqueImageSources[indexVal] = img.getAttribute('src');
                uniqueImageAlts[indexVal] = img.getAttribute('alt') || `Client story ${indexVal + 1}`;
            }
        });

        // Helper: Update lightbox image with a smooth cross-fade animation
        function updateLightboxImage() {
            const src = uniqueImageSources[currentImgIndex];
            const alt = uniqueImageAlts[currentImgIndex];
            
            if (src && lightboxImg) {
                lightboxImg.classList.add('fade-out');
                setTimeout(() => {
                    lightboxImg.setAttribute('src', src);
                    lightboxImg.setAttribute('alt', alt);
                    if (lightboxCounter) {
                        lightboxCounter.textContent = `Story ${currentImgIndex + 1} of ${uniqueImageSources.length}`;
                    }
                    lightboxImg.classList.remove('fade-out');
                }, 150); // Matches the half-point of our CSS fade transition
            }
        }

        // Open Lightbox
        function openLightbox(index) {
            currentImgIndex = index;
            updateLightboxImage();
            
            lightboxModal.classList.add('active');
            lightboxModal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('lightbox-open');
            
            // Pause carousel animation when viewing fullscreen
            if (testimonialsGrid) {
                testimonialsGrid.classList.add('paused');
            }
        }

        // Close Lightbox
        function closeLightbox() {
            lightboxModal.classList.remove('active');
            lightboxModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('lightbox-open');
            
            // Resume carousel animation
            if (testimonialsGrid) {
                testimonialsGrid.classList.remove('paused');
            }
        }

        // Navigate to next image (with loop wrap-around)
        function showNextImage() {
            currentImgIndex = (currentImgIndex + 1) % uniqueImageSources.length;
            updateLightboxImage();
        }

        // Navigate to previous image (with loop wrap-around)
        function showPrevImage() {
            currentImgIndex = (currentImgIndex - 1 + uniqueImageSources.length) % uniqueImageSources.length;
            updateLightboxImage();
        }

        // Add click listeners to all testimonial images
        testimonialImages.forEach(img => {
            // Change cursor to pointer inline as progressive enhancement
            img.style.cursor = 'pointer';
            img.addEventListener('click', () => {
                const indexVal = parseInt(img.getAttribute('data-index'), 10);
                if (!isNaN(indexVal)) {
                    openLightbox(indexVal);
                }
            });
        });

        // Pause animation on mouse hover (robust JavaScript fallback)
        if (testimonialsGrid) {
            testimonialsGrid.addEventListener('mouseenter', () => {
                testimonialsGrid.classList.add('paused');
            });
            testimonialsGrid.addEventListener('mouseleave', () => {
                // Only resume if the lightbox is closed
                if (!lightboxModal.classList.contains('active')) {
                    testimonialsGrid.classList.remove('paused');
                }
            });
        }

        // Event listeners for closing and navigating
        if (lightboxClose) {
            lightboxClose.addEventListener('click', closeLightbox);
        }

        if (lightboxPrev) {
            lightboxPrev.addEventListener('click', (e) => {
                e.stopPropagation();
                showPrevImage();
            });
        }

        if (lightboxNext) {
            lightboxNext.addEventListener('click', (e) => {
                e.stopPropagation();
                showNextImage();
            });
        }

        // Close when clicking on the backdrop overlay outside the image wrapper
        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                closeLightbox();
            }
        });

        // Keyboard Navigation support
        document.addEventListener('keydown', (e) => {
            if (!lightboxModal.classList.contains('active')) return;

            if (e.key === 'Escape') {
                closeLightbox();
            } else if (e.key === 'ArrowRight') {
                showNextImage();
            } else if (e.key === 'ArrowLeft') {
                showPrevImage();
            }
        });
    }

});

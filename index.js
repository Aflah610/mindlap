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

    // --- 5. SELF-ASSESSMENT Q&A LOGIC ---
    let currentQuizStep = 1;
    let quizAnswers = {
        sleep: null,
        anxiety: null,
        focusArea: null,
        regulation: null
    };

    const quizSteps = document.querySelectorAll('.quiz-step');
    const progressBar = document.getElementById('quiz-progress');
    const restartBtn = document.getElementById('btn-restart-quiz');
    const resultBox = document.getElementById('quiz-result');
    const resultDesc = document.getElementById('result-desc');
    const recommendedProfileBox = document.getElementById('recommended-profile-box');

    // Attach click events to options
    const options = document.querySelectorAll('.quiz-option');
    options.forEach(option => {
        option.addEventListener('click', () => {
            const stepElement = option.closest('.quiz-step');
            const stepIndex = parseInt(stepElement.getAttribute('data-step'));
            const value = option.getAttribute('data-value');
            
            // Record answer values
            if (stepIndex === 1) quizAnswers.sleep = value;
            if (stepIndex === 2) quizAnswers.anxiety = value;
            if (stepIndex === 3) quizAnswers.focusArea = value;
            if (stepIndex === 4) quizAnswers.regulation = value;

            // Advance to next step
            goToStep(stepIndex + 1);
        });
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', restartQuiz);
    }

    function goToStep(step) {
        // Hide all steps
        quizSteps.forEach(s => s.classList.remove('active'));
        
        currentQuizStep = step;
        
        if (step <= 4) {
            // Show current question step
            const targetStep = document.querySelector(`.quiz-step[data-step="${step}"]`);
            targetStep.classList.add('active');
            // Update progress bar
            progressBar.style.width = (step * 20) + '%';
        } else {
            // Show result
            progressBar.style.width = '100%';
            evaluateQuizResults();
        }
    }

    function evaluateQuizResults() {
        let recommendation = '';
        let matchedTherapist = null;
        
        const focus = quizAnswers.focusArea;
        const sleep = quizAnswers.sleep;
        const anxiety = quizAnswers.anxiety;
        const regulation = quizAnswers.regulation;

        const therapists = {
            anasooya: {
                name: 'Anasooya Pramod',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Trauma-Informed Care, Mindfulness & Self-Awareness, and Stress & Anxiety Support.',
                img: 'assets/anasooya_bg.jpeg',
                profileUrl: 'anasooya.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Anasooya Pramod.'
            },
            gouri: {
                name: 'Gouri Nandhana',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Couples Therapy, Depression & Anxiety Management, and Trauma Recovery.',
                img: 'assets/gouri_bg.jpeg',
                profileUrl: 'gouri.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Gouri Nandhana.'
            },
            sajitha: {
                name: 'Sajitha KT',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Behavior Modification, Stress & Anxiety Management, and Remedial Training.',
                img: 'assets/sajitha_bg.jpeg',
                profileUrl: 'sajitha.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Sajitha KT.'
            },
            athira: {
                name: 'Athira Asok',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Couples Therapy, Stress Management, Depression & Anxiety, and Career Guidance.',
                img: 'assets/athira_bg.jpeg',
                profileUrl: 'athira.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Athira Asok.'
            },
            rashin: {
                name: 'Rashin PK',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Mood Disorders, Personality Disorders, Emotional Impulsiveness, and Couples Therapy.',
                img: 'assets/rashin_bg.jpeg',
                profileUrl: 'rashin.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Rashin PK.'
            },
            theresa: {
                name: 'Theresa P Thomas',
                role: 'Consultant Psychologist',
                preview: 'Specializes in Stress & Anxiety Management, Behavioral Change, and Anger Regulation.',
                img: 'assets/theresa_bg.jpeg',
                profileUrl: 'theresa.html',
                waText: 'Hello Mindlap, I completed the self-check and would like to book a therapy session with Theresa P Thomas.'
            }
        };

        // Matching Logic based on Areas of Focus, Regulation & Anxiety
        if (focus === 'work') {
            recommendation = "You seem to be experiencing indicators of workplace burnout or performance stress. Professional guidance can help you rebuild healthy routines, establish strong boundaries, and adapt your response to stress.";
            if (regulation === 'hard') {
                matchedTherapist = therapists.sajitha;
            } else {
                matchedTherapist = therapists.athira;
            }
        } else if (focus === 'relationship') {
            recommendation = "You are currently working through relationship or interpersonal stress. Developing clear communication patterns, boundary definition, and emotional regulation supports a healthy relational space.";
            if (anxiety === 'constantly' || anxiety === 'often') {
                matchedTherapist = therapists.gouri;
            } else {
                matchedTherapist = therapists.athira;
            }
        } else if (focus === 'trauma') {
            recommendation = "Past emotional wounds or challenging experiences appear to be impacting your current state. Safe, gentle trauma-informed support can assist you in processing and restoring your resilience.";
            if (regulation === 'hard' || anxiety === 'constantly') {
                matchedTherapist = therapists.gouri;
            } else {
                matchedTherapist = therapists.anasooya;
            }
        } else { // focus === 'personal' or default
            recommendation = "You seem interested in internal growth, boosting self-worth, and establishing emotional balance. Setting tailored personal goals can help you align actions with your core values.";
            if (regulation === 'hard') {
                matchedTherapist = therapists.rashin;
            } else if (regulation === 'moderate') {
                matchedTherapist = therapists.theresa;
            } else {
                matchedTherapist = therapists.anasooya;
            }
        }

        // Render result text
        resultDesc.textContent = recommendation;

        // Render recommended profile HTML dynamically
        recommendedProfileBox.innerHTML = `
            <img src="${matchedTherapist.img}" alt="${matchedTherapist.name}" class="rec-avatar">
            <div class="rec-details">
                <h5>${matchedTherapist.name}</h5>
                <p class="role-desc">${matchedTherapist.role} • ${matchedTherapist.preview}</p>
                <a href="${matchedTherapist.profileUrl}" class="view-profile-lnk" style="font-size:0.75rem; color:var(--primary-color); font-weight:700;">View Detailed Profile</a>
            </div>
        `;

        // Update WhatsApp message link on result booking button
        const bookBtn = document.getElementById('quiz-book-btn');
        if (bookBtn) {
            bookBtn.setAttribute('href', `https://wa.me/917012437009?text=${encodeURIComponent(matchedTherapist.waText)}`);
        }

        // Display result step
        resultBox.classList.add('active');
    }

    function restartQuiz() {
        quizAnswers = { sleep: null, anxiety: null, focusArea: null, regulation: null };
        goToStep(1);
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

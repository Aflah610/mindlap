document.addEventListener('DOMContentLoaded', () => {
  // Theme Toggle Logic
  const themeToggle = document.getElementById('themeToggle');
  const currentTheme = localStorage.getItem('theme') || 'dark';

  if (currentTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  themeToggle.addEventListener('click', () => {
    let theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'light') {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    }
  });

  // Navbar scroll effect
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // Intersection Observer for fade-up animations
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  const fadeElements = document.querySelectorAll('.fade-up');
  fadeElements.forEach(el => observer.observe(el));

  // Contact Form Handler
  const contactForm = document.querySelector('.contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = contactForm.querySelector('input[type="text"]').value;
      const email = contactForm.querySelector('input[type="email"]').value;
      const message = contactForm.querySelector('textarea').value;
      const sendBtn = contactForm.querySelector('button');

      const originalText = sendBtn.textContent;
      sendBtn.textContent = 'Sending...';
      sendBtn.disabled = true;

      fetch("https://formsubmit.co/ajax/mindlapofficial@gmail.com", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name: name,
          email: email,
          message: message,
          _subject: `Mindlap Inquiry from ${name}`
        })
      })
        .then(response => response.json())
        .then(data => {
          sendBtn.textContent = 'Message Sent Successfully!';
          sendBtn.style.backgroundColor = '#25D366'; // Success green
          contactForm.reset();

          setTimeout(() => {
            sendBtn.textContent = originalText;
            sendBtn.style.backgroundColor = '';
            sendBtn.disabled = false;
          }, 4000);
        })
        .catch(error => {
          console.error(error);
          sendBtn.textContent = 'Error! Please try again.';
          sendBtn.style.backgroundColor = '#ef4444'; // Error red

          setTimeout(() => {
            sendBtn.textContent = originalText;
            sendBtn.style.backgroundColor = '';
            sendBtn.disabled = false;
          }, 4000);
        });
    });
  }
});

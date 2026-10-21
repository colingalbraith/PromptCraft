/**
 * PromptCraft Website
 */

// ── Hero: animate the headline and start the demo as soon as the page loads ──
const Hero = {
    init() {
        const content = document.querySelector('.hero-content');
        if (content) requestAnimationFrame(() => content.classList.add('hero-animate'));

        const video = document.getElementById('heroVideo');
        if (!video) return;
        // On phones the full recording is too small to read: use the crop around the card
        if (video.dataset.mobileSrc && window.matchMedia('(max-width: 768px)').matches) {
            video.poster = video.dataset.mobilePoster || video.poster;
            video.src = video.dataset.mobileSrc;
        }
        // A click plays or pauses; with reduced motion it doesn't start on its own
        video.addEventListener('click', () => (video.paused ? video.play() : video.pause()));
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) video.play().catch(() => {});
    }
};

// ── Copy buttons (chrome:// addresses can't be links) ──
const CopyButtons = {
    init() {
        document.querySelectorAll('[data-copy]').forEach(btn => {
            const label = btn.textContent;
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(btn.dataset.copy);
                    btn.textContent = 'Copied';
                } catch {
                    // Clipboard refused: select the text so a key press copies it
                    const code = btn.parentElement.querySelector('code');
                    if (code) window.getSelection().selectAllChildren(code);
                    btn.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Press ⌘C' : 'Press Ctrl+C';
                }
                setTimeout(() => { btn.textContent = label; }, 2500);
            });
        });
    }
};

// ── Header scroll effect ──
const Header = {
    el: null,
    init() {
        this.el = document.getElementById('header');
        if (!this.el) return;
        window.addEventListener('scroll', () => {
            this.el.classList.toggle('scrolled', window.scrollY > 20);
        }, { passive: true });
    }
};

// ── Mobile nav ──
const MobileNav = {
    init() {
        const toggle = document.getElementById('mobileToggle');
        const links = document.getElementById('navLinks');
        if (!toggle || !links) return;

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('open');
            links.classList.toggle('open');
        });

        // Close on link click
        links.querySelectorAll('a').forEach(a => {
            a.addEventListener('click', () => {
                toggle.classList.remove('open');
                links.classList.remove('open');
            });
        });
    }
};

// ── Smooth scroll ──
const SmoothScroll = {
    init() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', (e) => {
                const href = anchor.getAttribute('href');
                if (href === '#') return;
                e.preventDefault();
                const target = document.querySelector(href);
                if (!target) return;
                const offset = document.querySelector('.header')?.offsetHeight || 0;
                window.scrollTo({
                    top: target.offsetTop - offset - 16,
                    behavior: 'smooth'
                });
            });
        });
    }
};

// ── Scroll reveal ──
const Reveal = {
    init() {
        // Standard reveals
        const standards = '.section-header, .stats-bar, .cta-card, .demo-interactive';
        document.querySelectorAll(standards).forEach(el => el.classList.add('reveal'));

        // Staggered grid children
        document.querySelectorAll('.features-grid').forEach(grid => {
            grid.classList.add('stagger-children');
            grid.querySelectorAll('.feature-card').forEach(el => el.classList.add('reveal'));
        });

        // Steps get stagger too
        document.querySelectorAll('.step').forEach(el => el.classList.add('reveal'));

        // CTA steps stagger in
        document.querySelectorAll('.cta-step').forEach((el, i) => {
            el.classList.add('reveal');
            el.style.transitionDelay = `${0.15 * i}s`;
        });
        document.querySelectorAll('.cta-step-connector').forEach(el => el.classList.add('reveal'));
        document.querySelectorAll('.cta-buttons').forEach(el => el.classList.add('reveal'));

        // Provider chips scale in
        document.querySelectorAll('.provider-chip').forEach(el => el.classList.add('reveal-scale'));

        // Hero content from left, video from right (handled by CSS animation, but observe for trigger)
        const hero = document.querySelector('.hero-content');
        if (hero) hero.classList.add('reveal-left');
        // Don't add transform-based reveal to hero-visual — it degrades video quality
        // const heroVid = document.querySelector('.hero-visual');
        // if (heroVid) heroVid.classList.add('reveal-right');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

        document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale').forEach(el => {
            observer.observe(el);
        });
    }
};

// ── Interactive demo ──
const Demo = {
    transforms: {
        professional: (input) =>
            `Please provide a detailed, well-structured response to the following: ${input}. Include key considerations, best practices, and actionable recommendations.`,
        concise: (input) =>
            `${input.charAt(0).toUpperCase() + input.slice(1).replace(/\?$/, '')}. Be brief and direct.`,
        technical: (input) =>
            `Provide a technical analysis of the following: ${input}. Include architecture considerations, implementation details, and performance trade-offs where relevant.`,
        creative: (input) =>
            `Take an imaginative and unconventional approach to: ${input}. Think outside the box, explore unexpected angles, and surprise me with fresh perspectives.`
    },

    init() {
        this.input = document.getElementById('demoInput');
        this.output = document.getElementById('demoOutput');
        this.buttons = document.querySelectorAll('.style-btn');
        if (!this.input || !this.output) return;

        this.buttons.forEach(btn => {
            btn.addEventListener('click', () => this.handleStyle(btn));
        });

        this.input.addEventListener('input', () => {
            const active = document.querySelector('.style-btn.active');
            if (active) this.transform(active.dataset.style);
        });
    },

    handleStyle(btn) {
        this.buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.transform(btn.dataset.style);
    },

    transform(style) {
        const raw = this.input.value.trim();
        if (!raw) {
            this.output.textContent = 'Type something above to see the transformation.';
            return;
        }

        this.output.style.opacity = '0.4';
        setTimeout(() => {
            const fn = this.transforms[style];
            this.output.textContent = fn ? fn(raw) : raw;
            this.output.style.opacity = '1';
        }, 300);
    }
};


// ── Background particles ──
const Particles = {
    init() {
        const container = document.getElementById('bgParticles');
        if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        // Spawn initial batch already mid-flight
        for (let i = 0; i < 25; i++) {
            this.spawnMidFlight(container);
        }

        // Continuously spawn
        setInterval(() => this.spawn(container), 1200);
    },

    // Spawn a particle that appears already partway through its animation
    spawnMidFlight(container) {
        if (container.children.length > 40) return;

        const p = document.createElement('div');
        p.className = 'bg-particle';

        const size = 3 + Math.random() * 5;
        const x = Math.random() * 100;
        const duration = 10 + Math.random() * 14;
        const drift = -80 + Math.random() * 160;
        const opacity = 0.15 + Math.random() * 0.35;

        // Negative delay = starts partway through the animation
        const negativeDelay = -(Math.random() * duration * 0.8);

        p.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${x}%;
            bottom: -20px;
            animation-duration: ${duration}s;
            animation-delay: ${negativeDelay}s;
            --drift: ${drift}px;
            --peak-opacity: ${opacity};
        `;

        container.appendChild(p);

        // Remaining time until animation ends
        const remaining = duration + negativeDelay;
        setTimeout(() => {
            if (p.parentNode) p.parentNode.removeChild(p);
        }, remaining * 1000);
    },

    spawn(container) {
        // Cap max particles to avoid performance issues
        if (container.children.length > 40) return;

        const p = document.createElement('div');
        p.className = 'bg-particle';

        const size = 3 + Math.random() * 5;
        const x = Math.random() * 100;
        const duration = 10 + Math.random() * 14;
        const delay = Math.random() * 2;
        const drift = -80 + Math.random() * 160;
        const opacity = 0.15 + Math.random() * 0.35;

        p.style.cssText = `
            width: ${size}px;
            height: ${size}px;
            left: ${x}%;
            bottom: -20px;
            animation-duration: ${duration}s;
            animation-delay: ${delay}s;
            --drift: ${drift}px;
            --peak-opacity: ${opacity};
        `;

        container.appendChild(p);

        setTimeout(() => {
            if (p.parentNode) p.parentNode.removeChild(p);
        }, (duration + delay) * 1000);
    }
};

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    Hero.init();
    CopyButtons.init();
    Header.init();
    MobileNav.init();
    SmoothScroll.init();
    Reveal.init();
    Demo.init();
    Particles.init();

});

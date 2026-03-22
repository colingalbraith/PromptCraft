/**
 * PromptCraft Website
 */

// ── Splash screen ──
const Splash = {
    init() {
        const splash = document.getElementById('splash');
        if (!splash) return;

        // Start rotating tips in random order
        const tips = Array.from(document.querySelectorAll('.splash-tip'));
        if (tips.length > 1) {
            // Shuffle into random order
            const order = tips.map((_, i) => i);
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [order[i], order[j]] = [order[j], order[i]];
            }
            // Start with first random tip
            tips.forEach(t => t.classList.remove('active'));
            let pos = 0;
            tips[order[pos]].classList.add('active');

            setInterval(() => {
                tips[order[pos]].classList.remove('active');
                pos = (pos + 1) % order.length;
                tips[order[pos]].classList.add('active');
            }, 2000);
        }

        // Wait for loading bar animation to finish, then fade out
        setTimeout(() => {
            splash.classList.add('hidden');
            document.body.classList.remove('loading');

            // Trigger hero animations after splash is gone
            setTimeout(() => {
                const heroContent = document.querySelector('.hero-content');
                if (heroContent) heroContent.classList.add('hero-animate');

                // Start video after hero text begins
                const heroVideo = document.getElementById('heroVideo');
                if (heroVideo) setTimeout(() => heroVideo.play(), 1000);
            }, 400);
        }, 3200);

        // Remove from DOM after transition
        setTimeout(() => {
            if (splash.parentNode) splash.parentNode.removeChild(splash);
        }, 4000);
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
    Splash.init();
    Header.init();
    MobileNav.init();
    SmoothScroll.init();
    Reveal.init();
    Demo.init();
    Particles.init();

    // Video play is triggered after splash finishes (handled in Splash.init)
});

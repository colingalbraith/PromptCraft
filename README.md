<div align="center">

# PromptCraft Website

The landing page for [PromptCraft](https://github.com/colingalbraith/PromptCraft) — a free, open-source Chrome extension for one-click prompt enhancement.

[![Live Site](https://img.shields.io/badge/Live-getpromptcraft.vercel.app-orange)](https://getpromptcraft.vercel.app)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black)](https://vercel.com)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Pages](#pages)
- [Contributing](#contributing)

---

## Overview

Static landing page showcasing PromptCraft's features, demo video, and installation guide. Built with vanilla HTML/CSS/JS — no frameworks, no build step.

**Live at:** [getpromptcraft.vercel.app](https://getpromptcraft.vercel.app)

---

## Tech Stack

| Tool | Purpose |
|---|---|
| HTML5 | Semantic markup |
| CSS3 | Custom properties, grid, flexbox, animations |
| Vanilla JS | Splash screen, scroll reveals, particles, mobile nav |
| [Satoshi](https://www.fontshare.com/fonts/satoshi) | Primary typeface |
| Vercel | Hosting and deployment |

---

## Project Structure

```
website/
├── index.html           # Main landing page
├── privacy.html         # Privacy policy
├── og-card.html         # OG image template (screenshot at 1200x630)
├── vercel.json          # Vercel deployment config
├── package.json         # Dev dependencies (live-server, linting)
├── css/
│   └── styles.css       # All styles (~1600 lines, single file)
├── js/
│   └── main.js          # Splash, scroll reveals, particles, nav
└── assets/
    ├── demo.mp4         # Extension demo video
    ├── logo.png         # PromptCraft logo (full)
    ├── icon128.png      # Logo 128px
    ├── icon48.png       # Logo 48px (favicon)
    ├── gemini.png       # Gemini provider logo
    └── ollama.png       # Ollama provider logo
```

---

## Local Development

```bash
# Clone the repo (website branch)
git clone -b website https://github.com/colingalbraith/PromptCraft.git
cd PromptCraft

# Install dev dependencies
npm install

# Start dev server
npx live-server --port=8742
```

Open [http://localhost:8742](http://localhost:8742)

No build step needed — edit files and the browser auto-reloads.

---

## Deployment

The site is deployed on Vercel. Any push to the `website` branch triggers a redeploy.

**Manual deploy:**
```bash
vercel --prod
```

**Custom alias:**
```bash
vercel alias set <deployment-url> getpromptcraft.vercel.app
```

---

## Pages

| Page | Path | Description |
|---|---|---|
| Landing | `/` | Hero, features, demo video, how it works, CTA |
| Privacy | `/privacy.html` | Privacy policy for Chrome Web Store compliance |
| OG Card | `/og-card.html` | Template for social sharing preview image |

---

## Key Sections

### Landing Page (`index.html`)

- **Splash screen** — animated logo, progress bar, rotating tips
- **Hero** — headline with word-by-word reveal, demo video, CTA buttons
- **Stats bar** — writing styles, free forever, supported providers
- **Features** — 6 cards in 3x2 grid with scroll reveal animations
- **CTA** — 3-step how it works + GitHub link
- **Footer** — links, logo, copyright

### Design Tokens

```
Accent:     #D4872E (orange)
Gold:       #E5A83B
Teal:       #2A9D8F
Navy:       #1A2D45
Background: #F5F0E8 (warm off-white)
Surface:    #FAF7F2
```

---

## Contributing

This is the `website` branch of the PromptCraft repo. For extension contributions, see the `Development` branch.

1. Fork the repo
2. Checkout the `website` branch
3. Make your changes
4. Submit a PR to the `website` branch

---

<div align="center">

**Part of the [PromptCraft](https://github.com/colingalbraith/PromptCraft) project**

Built by [Colin Galbraith](https://github.com/colingalbraith)

</div>

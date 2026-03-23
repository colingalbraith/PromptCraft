# Contributing to PromptCraft

Thanks for your interest in contributing! Here's how to get started.

## Getting Started

1. Fork the repo and clone your fork
2. Load the extension in Chrome (`chrome://extensions/` → Developer mode → Load unpacked)
3. Make your changes on a new branch
4. Test your changes on at least one AI chat site (ChatGPT, Claude, or Gemini)
5. Submit a pull request to the `Development` branch

## Branch Structure

- `main` — stable releases (do not PR directly)
- `Development` — active development (submit PRs here)
- `website` — landing page, maintained by project owner (do not PR to this branch)

## What We're Looking For

- Bug fixes
- New AI platform support (content.js platform detection)
- New prompt templates (constants.js PROMPT_TEMPLATES)
- UI/UX improvements
- Performance optimizations
- Documentation improvements

## Code Style

- No build tools — vanilla JS, HTML, CSS
- Use existing patterns in the codebase
- Keep functions focused and under 50 lines where possible
- No external dependencies in the extension itself

## Testing

Before submitting a PR, please verify:
- Extension loads without errors in `chrome://extensions/`
- Enhancement works on at least one AI chat site
- Settings save and load correctly
- No console errors in production

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Which AI chat site and provider you were using
- Browser version

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

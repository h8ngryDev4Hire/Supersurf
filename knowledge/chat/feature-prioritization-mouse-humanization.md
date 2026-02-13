# Feature Prioritization & Mouse Humanization Strategy

**Date:** 2026-02-12
**Version:** v1

## Purpose
Evaluate high-value feature additions for SuperSurf and design a research-backed approach for mouse pattern humanization to strengthen anti-bot resistance.

## Summary
- **Prioritized features:** Cookie inspection (low effort, high value), mouse humanization (biggest competitive moat), WebSocket monitoring (completes network story)
- **Mouse humanization approach:** Bezier curves + velocity profiles + gaussian jitter, trained on academic datasets (BeCAPTCHA, ReMouse, SapiMouse), validated against BotD/reCAPTCHA locally then Cloudflare/DataDome live
- **Implementation location:** Extension (content script), not server — real Chrome pointer events vs CDP simulation
- **Data pipeline:** Raw CSVs → statistical analysis → compact JSON profile (~2KB) → runtime sampling (datasets don't ship)
- **Status:** Deferred for now, research documented for future implementation

## Research

### Academic Datasets (Public, Human-Labeled)
- **BeCAPTCHA-Mouse** — 15K trajectories (human vs bot labeled), GitHub available — https://github.com/rprouse/becaptcha-mouse
- **ReMouse** — 100 users, repeat sessions, longitudinal consistency data — https://dl.acm.org/doi/10.1145/3290607.3312961
- **SapiMouse** — 120 users, basis for DMTG diffusion model — https://www.mdpi.com/2079-9292/11/4/556
- **Bogazici University** — 2,550 hours free-use mouse data — https://www.cmpe.boun.edu.tr/~ethem/i2ml_old/datasets.htm

### Detection Benchmarks
- **BotD (FingerprintJS)** — Open-source bot detector with mouse behavior scoring — https://github.com/fingerprintjs/botd
- **CreepJS** — Fingerprinting test suite, mouse jitter analysis — https://abrahamjuliot.github.io/creepjs/
- **Sannysoft Anti-Bot** — Detection matrix (WebDriver, CDP, automation flags) — https://bot.sannysoft.com/
- **reCAPTCHA v3** — Risk scoring (0.0-1.0), mouse patterns influence score — https://developers.google.com/recaptcha/docs/v3
- **Cloudflare Turnstile** — Challenge page with mouse tracking — https://challenges.cloudflare.com/
- **DataDome/HUMAN (PerimeterX)** — Enterprise bot detection (live validation only)

### Key Papers
- **DMTG 2024** — Diffusion model for mouse trajectory generation, state-of-the-art realism — https://arxiv.org/abs/2403.19252
- **Bezier + Fitts's Law 2024** — Practical humanization implementation for automation — https://dl.acm.org/doi/10.1145/3613904.3642916
- **ACM Computing Surveys** — Comprehensive mouse dynamics survey, feature definitions — https://dl.acm.org/doi/10.1145/3469397

## Consensus

### Feature Priority Ranking
1. **Cookie inspection** — Low effort, high value (session debugging, auth state visibility)
2. **Mouse humanization** — Highest competitive moat, significant research investment required
3. **WebSocket monitoring** — Fills gap in network observability (real-time events, GraphQL subscriptions)

### Mouse Humanization Design
- **Implementation lives in extension** — Content script injects real pointer events (PointerEvent/MouseEvent) with human timing/paths, undetectable by page JS. CDP mouse emulation is detectable.
- **Movement generation:** Bezier curves (control points with noise), velocity bell curve (slow start → fast middle → slow end), overshoot + micro-corrections, gaussian jitter (0.5-2px drift)
- **Event timing:** Irregular intervals (not 16ms/60fps), mousemove events precede clicks (100-300ms lead-in), micro-movements during idle (breathing)
- **Data source:** Academic datasets (BeCAPTCHA preferred for size + labeling), extract statistical distributions (velocity profiles, curvature, pause patterns), ship compact JSON profile only

### Testing Strategy
1. **Local iteration:** Test page with embedded BotD + reCAPTCHA v3 (fast, isolated, diagnostic scores)
2. **Live validation:** Cloudflare Turnstile, DataDome trial accounts (ground truth for production detectors)
3. **Metrics:** BotD detection rate, reCAPTCHA score (target >0.7), Cloudflare challenge pass rate

### Data Pipeline
```
Raw CSVs (100MB+) → Analysis script → Distributions JSON (~2KB) → Extension runtime sampling
```
Datasets remain in dev environment, never shipped. Profile captures statistical distributions: velocity ranges, angle variance, pause frequency, submovement structure.

## Open Questions
- [ ] Which Bezier variant performs best in live tests (quadratic vs cubic, static vs adaptive control points)?
- [ ] Should we ship multiple profiles (cautious/normal/aggressive) or one adaptive profile?
- [ ] Does reCAPTCHA v3 weigh trajectory shape more than timing irregularity?
- [ ] Can we detect when a page is analyzing mouse data (listeners on mousemove) and adjust strategy?

## Deferred Work
- **Mouse pattern humanization** — Research complete, implementation deferred pending user prioritization
- **Profile preloading** — Synthesizing fake browsing data (cookies, history, localStorage) for fresh Chrome profiles
- **Session recording/replay** — DOM snapshot + event stream for test automation
- **Multi-tab orchestration** — Parallel workflows across tabs (e.g., scraping, form filling batches)

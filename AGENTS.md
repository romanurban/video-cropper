# Video Editor (Sprint 0) — Agents Guide

This document orients AI/code agents working on this repository. It explains the current state, constraints, and how to make focused, high‑quality changes.

## Overview
- Scope: Client‑only video previewer with canvas mirroring and basic transport controls.
- Status: Sprint 0 complete — open a local file, preview it, mirror frames to a `<canvas>`, show basic metadata, play/pause, and scrub.
- Stack: Vanilla JS (ES modules), HTML5 video, Canvas 2D, simple reactive state container.

## Quick Start
- Serve over HTTP (ES modules require it): `python3 -m http.server 8000` then open `http://localhost:8000`.
- Test files: Short MP4 (H.264 + AAC) recommended for compatibility.
- No build step, no dependencies, no bundler.

## Repository Structure
- `index.html`: App shell and DOM targets.
- `styles.css`: Layout and theming (dark, responsive).
- `js/main.js`: App bootstrap, DOM wiring, UI events, state subscriptions.
- `js/video-player.js`: File load, metadata, playback, seek, error mapping.
- `js/frame-renderer.js`: Canvas sizing (DPR-aware) and render loop.
- `js/state.js`: Central reactive state with keyed subscriptions.
- `js/utils.js`: Time formatting, size calc, DPR canvas helpers, guards.
- `js/timeline-view.js`: Placeholder for future timeline UI.
- `workers/`: Reserved for future Web Workers.

## Runtime Architecture
- Source of truth: The `<video>` element drives time and readiness; state reflects it.
- State flow: `AppState.set*` mutates and emits keyed updates → subscribers update UI/renderer.
- Rendering: `FrameRenderer` sizes canvas to container with DPR scaling, mirrors current video frame via `drawImage`, and uses `requestAnimationFrame` while playing.
- Controls: Play/pause toggles on state changes; slider maps percent → seek time.

## Constraints for Agents
- Keep it client‑only; do not add servers, build tools, or external dependencies.
- Preserve ES module structure and file layout unless scope explicitly includes refactors.
- Avoid unrelated changes; keep diffs small and targeted to the task.
- Align with current styles and patterns (class‑based modules, centralized state).
- Handle errors defensively; prefer user‑safe failure messages.

## Coding Guidelines
- Project style: Vanilla JS (no TypeScript), ES modules, single‑purpose classes.
- State: Mutate via `appState` methods (`setFile`, `setVideoMetadata`, etc.). Emit precise, minimal updates.
- DOM: Query once and cache references in `main.js`.
- Canvas: Use `setupCanvasForDPR` and `getCanvasSize`. Do not render at CSS size; render at device pixels, scale context once.
- Performance: Debounce resizes, reuse contexts, avoid unnecessary allocations in hot paths.
- Errors: Map media errors to user‑friendly messages; keep console noise minimal and actionable.

## Manual Testing
- Load a valid video via drag‑drop and file picker.
- Verify: filename, duration, resolution; play/pause updates; slider scrubs; canvas mirrors current frame; resize window maintains aspect ratio and sharpness on HiDPI.
- Try invalid files to confirm friendly error messages.

## Known Limitations (Sprint 0)
- No timeline UI beyond a basic slider.
- No trimming/export; canvas only mirrors, no overlays/effects yet.
- Rendering path reads CSS pixel sizes for `drawImage` in `frame-renderer.js`; future work may switch to using intrinsic canvas dimensions for sharper sampling.

## Backlog and Suggested Next Tasks
- Timeline UI: Replace placeholder with thumbnails and accurate scrubbing.
- Keyboard controls: Space to toggle play/pause, arrow keys to seek.
- Improved time display: HH:MM:SS, drop‑frame considerations for long media.
- Error surface: Inline, non‑blocking error component instead of `alert()`.
- Accessibility: Focus styles, ARIA roles/labels for controls, proper slider semantics.
- Frame export: Button to save current canvas frame as PNG.
- Worker prep: Scaffold a worker message protocol for future processing.
- Code health: Unit‑testable utilities for `utils.js` where feasible without adding deps.

## Definition of Done
- Changes are minimal, scoped, and consistent with architecture.
- No regressions in: load → metadata → play/pause → scrub → render.
- Tested manually on at least one MP4; window resize works; HiDPI looks crisp.
- Clear, user‑facing errors; no unhandled exceptions in console during the happy path.

## Notes for New Contributors (Agents)
- Prefer surgical edits over large refactors; if a refactor is justified, isolate it.
- When adding a feature, wire it through state subscriptions rather than ad‑hoc DOM updates.
- Keep `workers/` unused until a task explicitly requires it; keep the app functional without workers.


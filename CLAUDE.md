# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository is a single self-contained HTML file: `mindmap-tracker.html`. It is a shared, multi-user project/checkpoint tracker with two views — a project dashboard and a radial SVG mind map per project. There is no build system, package manager, bundler, test suite, or linter — everything (HTML, CSS, JS) lives in this one file inside a single IIFE `<script>` block.

## Running / developing

There are no build/test/lint commands. To work on this app:
- Open `mindmap-tracker.html` directly in a browser, or serve it with any static file server (e.g. `python -m http.server`) if `file://` restrictions cause issues with fonts/storage.
- Changes are made directly in the HTML file. Verify manually in a browser — check both the dashboard view and mind map view, and check `.demo-bar` fallback behavior (see Storage below).

## Storage model (critical to understand before editing)

The app does **not** use `localStorage`/`fetch` to a backend it owns. Instead it expects a **host-injected `window.storage` object** with an async KV API: `get(key, shared)`, `set(key, value, shared)`, `delete(key, shared)`, `list(prefix)`. This is designed to run inside a host environment that injects this API (e.g. an artifact/sandbox runtime) — `waitForStorage()` polls for up to 5s for `window.storage` to appear before falling back.

- If `window.storage` never appears, the app falls back to `memStore`, an in-memory `Map`-backed shim (data lost on reload) and shows the `#demo-bar` banner.
- All persisted values are JSON-stringified before `set` and parsed after `get` (see `sGet`/`sSet`/`sDel`).
- `SHARED = true` is passed on every call — this is a shared/multi-user workspace, not per-user local storage. Every open tab polls and can see others' edits.
- Data keys: `'projects-list'` (array of `{id, name, createdAt}`) and `'project:' + id` (per-project `{ team: string[], checkpoints: [] }`).
- Checkpoints are flat objects with `parentId` (or `null` for top-level) rather than a nested tree — parent/child relationships are reconstructed at render time via `childrenMap()`.

When editing anything that touches persistence, preserve the **read-merge-write** pattern used throughout (e.g. `panel-save`, `panel-delete`, team add/remove): re-fetch the latest project doc with `sGet` immediately before mutating and writing back, rather than trusting `state.project`, since another client may have written concurrently. Also preserve the orphan-adoption logic in delete (climbing `parentId` chains to also delete descendants of a deleted node, event though nothing enforces it structurally).

## Live sync / polling

There is no websocket/push — `startPoll()` sets a 10s `setInterval` that re-fetches and re-renders the current view (`loadProjects()` for dashboard, `loadProject(true)` for map). Polling is paused whenever `state.blocked` is true (a modal or the checkpoint panel is open) to avoid clobbering in-progress form edits, and whenever `document.hidden` is true. Any new UI that opens an overlay should set `state.blocked = true` on open and clear it in `closeOverlays()`, matching the existing modal/panel pattern.

## View/state architecture

Single global `state` object drives everything (`state.view`, `state.projects`, `state.pid`, `state.project`, `state.editing`, `state.draftStatus`, `state.blocked`). Views are plain `<div class="view" id="v-*">` elements toggled via `show(v)` (`loading`, `error`, `dash`, `map`). There is no router/history — navigation is just `show()` + data reload + `startPoll()`.

- **Dashboard** (`v-dash`): lists all projects as cards with progress bars, computed by fetching every `project:<id>` doc and counting `status === 'done'`. `renderDash()` rebuilds the whole grid; delete goes through `confirmBox()`.
- **Mind map** (`v-map`): renders one project's checkpoints as an SVG radial tree, centered on the project (`center` node at origin).

## Mind map layout & rendering

All in the `mind map` section of the script:
- `childrenMap(cps)` groups checkpoints by `parentId` (`'root'` for top-level), sorted by `createdAt`.
- `layout(cps)` computes polar coordinates recursively: root nodes are spread evenly around a circle of radius `R1` (auto-grows with node count), children are placed at `parent radius + 180` within an angular span capped at `Math.PI * 0.6`. Nodes whose parent was deleted (orphans) are placed as a synthetic outer ring rather than dropped.
- `edge(p, c)` draws a cubic bezier between parent/child polar coords for the connecting line.
- `renderMap()` rebuilds the entire `#viewport` `<g>` innerHTML (edges + center + nodes) on every change — there is no diffing/virtual DOM, so any interactive element inside a node (`.node`, `.add-btn`) must be re-wired via event delegation on the parent `<svg>`, not per-node listeners (see the single `svg.addEventListener('click', ...)` handler that dispatches based on `closest('[data-add]')` / `closest('.node[data-id]')` / `closest('[data-center]')`).
- Pan/zoom/pinch is hand-rolled via Pointer Events (`ptrs` map tracks active pointers for 1-finger pan vs 2-finger pinch) plus `wheel` for desktop zoom, all reading/writing the `view = { s, tx, ty }` transform state applied with `applyView()`.
- Text truncation (`fit()`) measures actual pixel width via an offscreen `<canvas>` context rather than CSS ellipsis, because it's used inside SVG `<text>` where CSS `text-overflow` doesn't apply.

## Editor panel & modal system

Two generic overlay primitives are reused for everything — do not build one-off dialogs:
- `openModal(bodyHTML, footButtons)` / `confirmBox({title, text, ok, onOk})`: generic modal used for new-project, delete-confirm, and team management. Footer buttons are declarative `{label, kind, onClick}` objects.
- The checkpoint editor is a dedicated slide-in `#panel` (right-side on desktop, bottom-sheet on mobile via the `@media(max-width:640px)` override), opened with `openEditor(id, parentId)`. `id` present = edit existing; `id` null with a `parentId` = add child under that node; both null = add top-level (from the center node or the `+ เพิ่ม checkpoint` button).

Both share `closeOverlays()` for teardown and `state.blocked` for pausing polling.

## Localization

UI is Thai-first with English micro-labels via the `.en` span class (e.g. "บันทึก <span class=\"en\">Save</span>"). `STATUS` map centralizes the three checkpoint states (`todo`/`in_progress`/`done`) with Thai/English labels and color — reuse this map (and its colors, mirrored in the SVG legend and CSS) rather than hardcoding status strings elsewhere. Dates/times are formatted with `toLocaleDateString('th-TH', ...)` / `toLocaleTimeString('th-TH', ...)`.

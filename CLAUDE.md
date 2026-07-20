# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This repository is a single self-contained HTML file: `index.html` ("Milemaps"). It is a shared, multi-user project/checkpoint tracker with a public landing page, a no-login guest sandbox, a project dashboard, an analytics dashboard, and a radial SVG mind map per project. There is no build system, package manager, bundler, test suite, or linter — everything (HTML, CSS, JS) lives in this one file inside a single IIFE `<script>` block. The backend is Supabase (Postgres + Auth + Realtime + Edge Functions), not a host-injected storage API.

## Running / developing

There are no build/test/lint commands.
- Open `index.html` directly in a browser, or serve it with any static file server if `file://` restrictions cause issues.
- Changes are made directly in the HTML file. Verify manually in a browser (or headless Chrome via CDP) — check the landing page, guest demo sandbox, dashboard, mind map, and analytics dashboard views, in both languages (see Localization below).
- Deployed to Vercel as a static site (zero-config, `index.html` at repo root).

## Backend: Supabase

- Client init: `const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)` — the anon key is safe client-side; **Row Level Security (RLS) is what actually protects data**.
- Tables (see `supabase-schema.sql` for the base schema, `supabase-schema-v2.sql` for the access-control + doc-link migration — **run both, in order, in the Supabase SQL Editor**; there is no CLI/migration runner wired up):
  - `projects (id, name, created_at, created_by)`
  - `checkpoints (id, project_id, parent_id, title, status, assignee, note, doc_url, created_at)` — self-referencing `parent_id` with `ON DELETE CASCADE`.
  - `project_team (project_id, name)` — `name` is actually an email address (validated client-side with a simple `@`/`.` check); despite the column name, this is the real invite/membership list.
- Realtime: `subscribeDash`/`subscribeMap` open `postgres_changes` channels; `startPoll`/`stopPoll` (30s) is the fallback, paused whenever `state.blocked` is true or `document.hidden`.

### Access control (RLS) — read this before touching policies

Only the project owner (`created_by`) and explicitly-invited teammates (their email present in `project_team.name`, case-insensitive) can read or write a project's data. A logged-in user who owns/is invited to nothing sees an empty dashboard, not other people's projects.

This was **not** a simple `created_by = auth.uid() OR EXISTS(...)` policy — two real bugs were hit and fixed while building it, and the fixes constrain how these policies must be written:

1. **Recursion**: a `projects` policy that queries `project_team`, combined with a `project_team` policy that queries `projects`, causes `infinite recursion detected in policy`. Fixed by giving `project_team` lookups their own `SECURITY DEFINER` function (`is_shared_with_me(pid)`) that only ever touches `project_team` — never `projects` or `checkpoints` — so it can't be part of a cycle no matter which table calls it.
2. **INSERT ... RETURNING failures**: `supabase-js`'s `.insert(...).select()` (used everywhere in this app) implicitly re-checks the table's SELECT policy against the row just inserted, in the *same statement*. If the owner-check goes through a function that re-queries the row's own table, that self-reference is unreliable. Fixed by keeping the owner check a **plain `created_by = auth.uid()` column comparison directly in the policy** (no function, no subquery) — always immediately visible for the row being evaluated, whichever table it's on.

**When adding new tables or policies**: never write a policy that queries another RLS-protected table whose own policy queries back to the first (recursion), and never route an ownership check that must work under `INSERT ... RETURNING` through a function that re-queries its own table (returning-visibility). Prefer plain column comparisons for same-table checks and `SECURITY DEFINER` helper functions only for genuine cross-table lookups.

`isProjectOwner()` in the client mirrors this: `state.project.createdBy === state.user.id` (or always `true` in demo mode) — used to hide team-management controls for non-owners; RLS is still the actual enforcement, the UI check is just to avoid showing a control that would silently fail.

## Guest demo mode (`state.demo`)

Landing page → "ลองใช้งานเลย" enters a no-login sandbox backed by `demoStore` (in-memory `{projects, data}`), never touching Supabase. Every CRUD path in the app branches on `state.demo` first. AI features (`generate-map`, `ask-gemini`) are Edge Functions gated by Supabase's default `verify_jwt`, which demo mode can never satisfy (no real session) — so their UI entry points are hidden entirely when `state.demo` is true (see `setDemoUI()`).

## View/state architecture

Single global `state` object drives everything (`state.view`, `state.user`, `state.demo`, `state.lang`, `state.projects`, `state.pid`, `state.project`, `state.editing`, `state.draftStatus`, `state.blocked`). Views are plain `<div class="view" id="v-*">` elements toggled via `show(v)` (`loading`, `error`, `landing`, `auth`, `dash`, `map`, `analytics`). There is no router/history — navigation is `show()` + data reload + `startPoll()`. Clicking the logo in any topbar calls `goHome()` (landing if demo/logged-out, otherwise back to dash).

- **Dashboard** (`v-dash`): lists projects the RLS policy actually returns (already scoped — no client-side filtering needed), as cards with progress bars. `renderDash()` rebuilds the whole grid; delete goes through `confirmBox()`.
- **Analytics dashboard** (`v-analytics`, reached via the "แดชบอร์ด" topbar button on dash): cross-project overview (total/done/in-progress/todo counts) plus per-project and per-assignee breakdowns, computed client-side in `loadAnalytics()`/`renderAnalytics()` from a fresh fetch — no due-date/overdue metric since the schema has no due-date column.
- **Mind map** (`v-map`): renders one project's checkpoints as an SVG radial tree, centered on the project.

## Mind map layout & rendering

All in the `mind map` section of the script:
- `childrenMap(cps)` groups checkpoints by `parentId` (`'root'` for top-level), sorted by `createdAt`.
- `layout(cps)` computes polar coordinates recursively: root nodes are spread evenly around a circle of radius `R1` (auto-grows with node count), children are placed at `parent radius + 180` within an angular span capped at `Math.PI * 0.6`. Orphaned nodes (parent deleted) are placed as a synthetic outer ring rather than dropped.
- `edge(p, c)` draws a cubic bezier between parent/child polar coords.
- `renderMap()` rebuilds the entire `#viewport` `<g>` innerHTML (edges + center + nodes) on every change — no diffing, so interactive elements inside a node must be re-wired via event delegation on the parent `<svg>` (single click handler dispatching on `closest('[data-add]')` / `closest('.node[data-id]')` / `closest('[data-center]')`), never per-node listeners.
- Pan/zoom/pinch is hand-rolled via Pointer Events (`ptrs` map for 1-finger pan vs 2-finger pinch) plus `wheel`, applied via `view = { s, tx, ty }` and `applyView()`.
- Text truncation (`fit()`) measures actual pixel width via an offscreen `<canvas>` context, since it's used inside SVG `<text>` where CSS `text-overflow` doesn't apply.

## Editor panel & modal system

Two generic overlay primitives are reused for everything — do not build one-off dialogs:
- `openModal(bodyHTML, footButtons)` / `confirmBox({title, text, ok, onOk})`: used for new-project, delete-confirm, team management, and the project-wide "ask AI" modal. Footer buttons are declarative `{label, kind, onClick}` objects.
- The checkpoint editor is a dedicated slide-in `#panel` (right-side on desktop, bottom-sheet on mobile), opened with `openEditor(id, parentId)`. `id` present = edit existing; `id` null with a `parentId` = add child; both null = add top-level.

Both share `closeOverlays()` for teardown and `state.blocked` for pausing polling. Any new overlay must set `state.blocked = true` on open and rely on `closeOverlays()` to clear it.

## AI features (two separate providers, two separate Edge Functions)

- **`supabase/functions/generate-map`** (Claude/Anthropic): takes a free-text business/project description, returns a 2-level `{nodes:[{title,children:[{title}]}]}` tree via structured output, inserted through the same `insertTree()` path as the hand-written `TEMPLATES`. Requires the `ANTHROPIC_API_KEY` Edge Function secret.
- **`supabase/functions/ask-gemini`** (Gemini): takes `{context, question, lang}`, returns free-text advice — used both per-checkpoint ("ถาม AI" in the editor panel) and project-wide ("ถาม AI เกี่ยวกับโปรเจกต์" in the map topbar, via `askAiProjectModal()`). Requires the `GEMINI_API_KEY` Edge Function secret. No structured output needed here since the response is just displayed as text, not inserted as data.

Both functions rely on Supabase's default `verify_jwt` as their only auth gate — do not disable it, since that's what keeps the guest demo sandbox from being able to call them (see above).

## Localization (`state.lang`, `th` or `en` — no mixed labels)

The UI is **either fully Thai or fully English**, chosen via a `.lang-toggle` segmented control present in every topbar/landing page, persisted in `localStorage` (`milemaps-lang`) — this is a personal UI preference, not shared workspace data, so `localStorage` is correct here (not Supabase).

- All UI strings live in the `STRINGS` dictionary (`{ key: { th, en } }`); `t(key)` returns the string for `state.lang`. Static markup uses `data-i18n`/`data-i18n-ph`/`data-i18n-aria`/`data-i18n-title` attributes, applied by `applyLang()` (called on boot and whenever `setLang()` runs); dynamically-rendered JS (toasts, `confirmBox`, dashboard cards, tour steps) calls `t(key)` directly at render time instead.
- **Never reintroduce a hardcoded bilingual string or a `.en` micro-label span** — add a `STRINGS` entry and use `t()`/`data-i18n` instead, matching the existing pattern.
- `STATUS` (`todo`/`in_progress`/`done`) has its own `{th, en, color}` shape (not part of `STRINGS`) — status pills, the map legend, and the checkpoint-editor status buttons all read from it directly, keyed by `state.lang`.
- The 7 hand-written `TEMPLATES` have `{th, en}` labels for their picker-card names, but their seeded checkpoint tree content (the actual titles inserted as data) is intentionally left as-authored in Thai (with parenthetical English where the original author already used it) rather than fully translated — that's business-template content, not UI chrome.
- Dates/times are formatted with `toLocaleDateString('th-TH', ...)` / `toLocaleTimeString('th-TH', ...)` regardless of `state.lang` (locale-formatting, not UI text).

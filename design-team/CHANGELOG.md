# Changelog

## 2026-11-06 — canonical repository cutover

Active source, release tooling, documentation and static links now use `Boom-Vitt/nose-erp`; GitHub Pages uses https://boom-vitt.github.io/nose-erp/ . The Go module/import namespace is `github.com/Boom-Vitt/nose-erp/boombignose`. Product names, installer tags, local directory paths and historical evidence stay unchanged. Release JSON and embedded snapshots are refreshed only by `site/fill-release.py` from the actual published release, not by manual edits.

## 2026-10-27 — repository slug

Download and source links use `Boom-Vitt/boombignose-erp-harness-ai`. The Pages canonical URL is https://boom-vitt.github.io/boombignose-erp-harness-ai/ . The previous Pages address is retired.

## 2026-10-27 — first pass

The download page in `site/index.html` was rebuilt for Midnight Local.

- Removed the face photo (`site/face-logo.png`) and the isometric poster graphic from the page.
- Added our mark: `site/assets/favicon.svg`, lockup `site/assets/logo.svg`, `site/assets/og.svg`, and a 1200×630 `site/assets/og.png`.
- Section order follows the brief: nav, hero, trust, modules, three steps, OS cards with SHA-256, unsigned install steps, privacy, FAQ and requirements, footer.
- The hero button points at the boombignose-v0.2.0 window installer for the visitor's OS. Sizes are the Release byte counts.
- ERP `app/globals.css` gained `--bbn-accent`, `--bbn-ink`, and `--bbn-paper` only. Existing component colors were left as they were.
- README banners now use `site/assets/logo.svg` instead of `.github/brand/banner.svg`.

References that shaped the pass: Obsidian (one card per OS), Ollama (one primary button; we did not copy the mascot), Linear (dark page, one accent, 1px cards, mock instead of their screenshot), LM Studio and Jan (local message and requirements), Supabase (source link), Odoo (module tiles, limited to modules we actually describe).

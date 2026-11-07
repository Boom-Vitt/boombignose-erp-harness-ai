# Design team

This folder is a set of roles and notes inside the BoomBigNose ERP repository. It is not a separate service and it does not call a model.

## Purpose

Find modern, clean references and use them to redesign two surfaces:

- The GitHub Pages download page in `site/`, published at https://boom-vitt.github.io/nose-erp/ . The previous Pages address is retired.
- The ERP web UI, only through tokens in `app/globals.css` unless a later pass says otherwise

## How to run a design pass

1. Read `REFERENCES.md` and `DESIGN_BRIEF.md`.
2. The reference scout adds only sites that were actually opened, and writes what to borrow.
3. The art director picks one palette and one accent. The accent matches `site/assets/logo.svg`.
4. The UI designer updates `DESIGN_SYSTEM.md` before any page edits.
5. The frontend implementer changes `site/index.html` and, when the pass includes the ERP, only CSS variables. No behavior change.
6. The QA reviewer checks contrast, the keyboard focus ring, reduced motion, Thai text, and that no claim is stronger than the repo.
7. Append the pass to `CHANGELOG.md`.

Do not copy artwork, screenshots, or mascots from the reference sites.

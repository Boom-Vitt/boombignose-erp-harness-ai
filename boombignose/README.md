# BoomBigNose ERP Harness AI

Local gate for the desktop shell. It does not open a window and it does not make network calls.

```sh
cd boombignose
go test ./...
go run ./cmd/boombignose check
go run ./cmd/boombignose cutover
```

`check` exits 0 when cloud credentials are unset and service URLs are empty or on loopback. `cutover` with no subcommand prints the switch plan and does not touch a database. `cutover dry-run`, `cutover apply`, and `cutover rollback` move rows only between two loopback databases. See `docs/boombignose/CUTOVER.md`.

Milestone 1 is `cmd/boombignose-desktop`, a Wails window built with `-tags desktop`. It runs the same gate, then navigates the window to `http://127.0.0.1:3100`. That origin is the product. Month-end close is used there: `/finance`, `/finance/bank`, `/finance/cash`, `/reports#month-end-close`, `/reports/statements`, and `/reports/accountant-pack`. The same window also reaches sheet import at `/import` and the local backup control in Settings. Milestone 2 bundles the local stack. See `docs/boombignose/ARCHITECTURE_LOCAL.md`. The static brochure in `site/` only points at the installer. It does not host these screens.

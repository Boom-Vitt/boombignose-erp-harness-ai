# Expected `pnpm moli:fetch` outcome

This file is the committed sample of a successful run from the ERP checkout. It is not a live dump. Fetched pages stay in gitignored `artifacts/moli/`.

The command does not open `boombignose/cmd/boombignose-desktop` and does not fetch the ERP at `http://127.0.0.1:3100`. The brochure under `site/` is not the sample.

## Command

```bash
pnpm moli:fetch
```

URL: `https://www.rd.go.th/272.html`

That is the public Revenue Department main page. The site root `https://www.rd.go.th/` is a short splash whose own link title points here ("เข้าสู่เว็บไซต์หน้าหลักของกรมสรรพากร"). It is not an e-Filing login.

## Process

1. The policy accepts the URL as public https. Layout stays off.
2. The wrapper runs `moli fetch --dump markdown --wait-until done --block-private-networks --timeout 25000` plus that URL.
3. On success it writes two files and prints one line. Exit code is 0.

```text
wrote artifacts/moli/2026-11-01/rd-go-th-272-html-1efa52fd.md (<bytes> bytes)
```

The date is the UTC day of the run. `1efa52fd` is the first eight hex characters of the SHA-256 of the exact URL `https://www.rd.go.th/272.html`. A different query uses a different suffix. Byte count changes when the page changes. A run on 2026-11-01 with Moli 1.1.20 wrote 41055 bytes.

## Sidecar

`artifacts/moli/<UTC date>/rd-go-th-272-html-1efa52fd.meta.json`

```json
{
  "policyVersion": 1,
  "sourceUrl": "https://www.rd.go.th/272.html",
  "dump": "markdown",
  "layout": false,
  "bytes": 41055,
  "createdAt": "2026-11-01T04:46:00.000Z",
  "note": "Public-page dump. No cookies or credentials are stored."
}
```

`bytes` and `createdAt` come from the run. The sidecar has no cookie, header, or secret field.

## Page text you should see

The Markdown is a conversion of the public main page. A useful dump names the agency and includes the public heading:

```text
กรมสรรพากร
```

```text
# ทำภาษีให้เป็นเรื่องง่าย ให้บริการแบบไร้รอยต่อ
```

Navigation on that page includes บุคคลธรรมดา, นิติบุคคล, and รวมกฎหมายภาษี. The same page also links to e-Filing, including `https://efiling.rd.go.th/rd-efiling-web/authen/ONE`. Do not fetch those service URLs. The wrapper refuses a path segment `authen`.

A login wall, an empty shell, or a browser error page is not a successful reading. Do not invent the missing text, and do not type a credential to get past a wall.

## If Moli is not installed

Exit code 2. Stderr prints the upstream installer URL and points at `docs/moli/README.md`. The wrapper does not run the installer. `boombignose serve` does not install Moli either.

## Refused desktop target

```bash
pnpm moli:fetch -- --url http://127.0.0.1:3100/
```

Exit code 1. The desktop window already owns that URL. Moli is not a second client for it.

## Screenshot shape

```bash
pnpm moli:fetch -- --dump screenshot
```

The same folder receives a `.png` whose first bytes are the PNG signature, and the command Moli sees includes `--layout`. The wrapper refuses to write a non-PNG body that used a screenshot dump.

# Statutory tax invoice — what this app does and does not do

An owner or admin can issue an invoice as a full tax invoice (**TX**) or an abbreviated tax invoice (**ABB**). Those documents carry their own number series and frozen tax fields. They are still produced inside this app only. Nothing is sent to the Revenue Department, there is no e-Tax Invoice, and the app does not file anything. The close roadmap, including who files, is `docs/boombignose/LEGAL_CLOSE.md`.

A plain issue (**INV**) is still an operational invoice, even when the seller is VAT-registered. Its PDF says "Invoice", not ใบกำกับภาษี.

## What TX and ABB do

| Item | TX | ABB |
| --- | --- | --- |
| Number | `TX-YYYY-000001`, own series | `ABB-YYYY-000001`, own series |
| Buyer name | Required | Required |
| Buyer address | Required | Not printed, not frozen |
| Buyer tax ID | Frozen when present, must be 13 digits | Not printed, not frozen |
| Seller VAT registration and 13-digit tax ID | Required | Required |
| Branch code (5 digits, `00000` head office) | Required, frozen | Required, frozen |
| At least one VAT line | Required | Required |
| Finance lock | Refused on a locked date | Refused on a locked date |
| Original label | Frozen on issue (`ต้นฉบับ` unless the profile label says otherwise) | Same |

- **Gap-free.** The counter row moves in the same database transaction that writes the snapshot. A refusal (non-VAT seller, missing branch code, locked date, missing buyer address, a failed command) rolls it back, so the next issue takes the next number. Concurrent issues take consecutive numbers because the counter row is locked until commit. An issued number is never deleted or reused. A cancelled or credited document keeps its number.
- **Snapshot.** The issued snapshot freezes seller, buyer, lines, totals, doc type, branch code, and the original label. It stays immutable.
- **PDF.** `/finance/invoices/[id]/pdf` prints the frozen document. Add `?copy=1` to print a reprint labelled `สำเนา`. The footer says it is not an e-Tax Invoice and not filed.
- **Retry.** The same key and doc type returns the same snapshot. The same key with the other doc type is an idempotency conflict.

## Still missing for a statutory tax invoice

- No submission to the Revenue Department and no e-Tax Invoice
- No authorized signature as a legal control
- No cash-versus-credit classification
- Original versus copy is a printed label. The app does not count prints or control who holds the original.
- No abbreviated-invoice eligibility check (for example retail-to-public). The issuer chooses ABB.
- No tax-invoice cancellation or replacement flow. Corrections use credit notes.
- A profile that is not VAT-registered cannot issue TX or ABB
- Whether a document meets the Revenue Code for your business is an accountant's call. This list is the product boundary, not tax advice.

## Profile fields

Saved on the business profile (`/finance/business-profile`):

| Field | Limit | Used by |
| --- | --- | --- |
| Seller phone | 40 characters | Not printed on TX or ABB |
| Branch code | empty, or 5 digits | Required to issue TX or ABB |
| Original/copy label | 40 characters | Frozen as the original label on TX and ABB |

Saving these fields issues nothing.

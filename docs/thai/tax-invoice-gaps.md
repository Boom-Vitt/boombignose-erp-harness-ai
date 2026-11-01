# Statutory tax invoice — what this app does not do

Operational invoices can show a seller, a buyer, lines, VAT, and withholding. That is a working document. It is not a statutory tax invoice (ใบกำกับภาษี), a tax filing, or an e-Tax Invoice. The close roadmap, including who files, is `docs/boombignose/LEGAL_CLOSE.md`.

## Already stored when someone fills them

- Seller legal name, address, 13-digit tax ID, and branch text
- Buyer name, address, and tax ID, copied onto each issued invoice
- Document number and issue date (Gregorian date plus the Buddhist-era label)
- Lines with quantity and price
- VAT when the business profile is registered, in THB
- Withholding as a document calculation

## Optional template fields

These can be saved on the business profile. They are not copied into the issued invoice snapshot. Saving them does not make the document statutory.

| Field | Limit |
| --- | --- |
| Seller phone | 40 characters |
| Branch code | empty, or 5 digits |
| Original/copy label | 40 characters, for example ต้นฉบับ or สำเนา |

## Still missing for a statutory tax invoice

- The product will not call the document a statutory ใบกำกับภาษี
- No submission to the Revenue Department and no e-Tax Invoice
- No tax-invoice number series separate from the operational INV series
- No authorized signature as a legal control
- No cash-versus-credit classification
- An original/copy label is not a legal control of which copy is the original
- A profile that is not VAT-registered does not issue a tax invoice

Review any real filing with an accountant. This list is the product boundary, not tax advice.

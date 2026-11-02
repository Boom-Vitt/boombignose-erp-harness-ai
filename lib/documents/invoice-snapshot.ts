import { z } from "zod"
import { outstandingSatang } from "@/lib/metrics/invoice-status"
import { calculateTax, WHT_RATES } from "@/lib/tax/totals"
import { TAX_DOC_TYPES } from "./numbering"
import type { PrintableDocument } from "./printable"

const satang = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const InvoiceSnapshot = z.object({
  version: z.literal(1),
  kind: z.enum(["operational_invoice", "legacy_operational_invoice"]).default("operational_invoice"),
  seller: z.object({ legalName: z.string().min(1), address: z.string(), taxId: z.string().nullable(), taxStatus: z.enum(["unknown", "not_registered", "registered"]), vatRegistered: z.boolean().default(false), branchLabel: z.string().nullable().optional() }),
  buyer: z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), taxId: z.string().nullable(), branchLabel: z.string().nullable().optional() }),
  document: z.object({ number: z.string(), issueDate: z.string().nullable(), dueDate: z.string().nullable(), notes: z.string().nullable(), subtotalSatang: satang, discountSatang: satang, totalSatang: satang, vatSatang: satang.default(0), whtSatang: satang.default(0), whtRateBps: z.number().refine(value => (WHT_RATES as readonly number[]).includes(value)).default(0), amountDueSatang: satang.optional(), pricesIncludeVat: z.boolean().default(false), vatByRate: z.array(z.object({ rateBps: z.number().int().min(0).max(10000), baseSatang: satang.optional(), vatSatang: satang })).default([]) }),
  taxInvoice: z.object({ docType: z.enum(TAX_DOC_TYPES), branchCode: z.string().regex(/^\d{5}$/), copyLabel: z.string().min(1).max(40) }).optional(),
  lines: z.array(z.object({ description: z.string(), quantity: z.number().positive().max(999999999.999), unit: z.string().nullable().optional(), unitPriceSatang: satang, amountSatang: satang, position: z.number().int().min(0), taxRateBps: z.number().int().min(0).max(10000).default(0) })),
}).refine(snapshot => snapshot.kind === "legacy_operational_invoice" || snapshot.lines.length > 0, { path: ["lines"], message: "Issued snapshots require priced lines" })

/** Validated issued snapshot. Live seller and buyer profiles are not substituted. */
export function parseInvoiceSnapshot(value: unknown) {
  return InvoiceSnapshot.parse(value)
}

/** Read immutable issued content; live seller and buyer profiles never substitute. */
export function invoiceSnapshotDocument(value: unknown, status: string, verifiedPaidSatang: number, creditedSatang = 0, options: { copy?: boolean } = {}): PrintableDocument {
  const snapshot = parseInvoiceSnapshot(value)
  const document = snapshot.document
  const legacy = snapshot.kind === "legacy_operational_invoice"
  const tax = snapshot.taxInvoice
  const totals = legacy ? { ...document, amountDueSatang: document.amountDueSatang ?? document.totalSatang } : calculateTax(snapshot.lines.map(line => ({ amount_satang: line.amountSatang, tax_rate_bps: line.taxRateBps })), document.discountSatang, document.pricesIncludeVat, document.whtRateBps)
  if (!legacy && (totals.subtotalSatang !== document.subtotalSatang || totals.totalSatang !== document.totalSatang || totals.vatSatang !== document.vatSatang || totals.whtSatang !== document.whtSatang || totals.amountDueSatang !== (document.amountDueSatang ?? document.totalSatang))) throw new Error("Invalid issued snapshot totals")
  return {
    kind: !legacy && tax ? (tax.docType === "ABB" ? "Abbreviated Tax Invoice / ใบกำกับภาษีอย่างย่อ" : "Tax Invoice / ใบกำกับภาษี") : "Invoice", number: document.number, status,
    orgName: snapshot.seller.legalName, sellerAddress: snapshot.seller.address, sellerTaxId: snapshot.seller.taxId, sellerBranch: snapshot.seller.branchLabel,
    taxInvoice: tax ? { docType: tax.docType, branchCode: tax.branchCode, copyLabel: options.copy ? "สำเนา" : tax.copyLabel } : undefined,
    clientName: snapshot.buyer.name, buyerAddress: tax?.docType === "ABB" ? null : snapshot.buyer.address, buyerTaxId: tax?.docType === "ABB" ? null : snapshot.buyer.taxId, buyerBranch: snapshot.buyer.branchLabel,
    issueDate: document.issueDate, dueDate: document.dueDate, notes: document.notes,
    items: snapshot.lines.map(line => ({ description: line.description, quantity: line.quantity, unit: line.unit, unit_price_satang: line.unitPriceSatang, amount_satang: line.amountSatang })),
    subtotalSatang: totals.subtotalSatang, discountSatang: totals.discountSatang, totalSatang: totals.totalSatang,
    vatSatang: totals.vatSatang, vatByRate: totals.vatByRate, whtSatang: totals.whtSatang, whtRateBps: document.whtRateBps, amountDueSatang: totals.amountDueSatang, pricesIncludeVat: document.pricesIncludeVat,
    verifiedPaidSatang, creditedSatang, outstandingSatang: outstandingSatang(totals.amountDueSatang, verifiedPaidSatang, creditedSatang),
  }
}

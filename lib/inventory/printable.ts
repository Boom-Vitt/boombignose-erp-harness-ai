import { escapeHtml } from "@/lib/documents/printable"
import type { Tables } from "@/lib/types/database"

export function renderStockDocument(orgName: string, doc: Pick<Tables<"stock_documents">, "kind" | "number" | "document_date">, lines: Pick<Tables<"stock_document_lines">, "description" | "unit" | "quantity">[], publicReference?: string | null): string {
  const title = doc.kind === "receipt" ? "Goods receipt" : "Delivery order"
  const reference = publicReference ? `<p>Public reference ${escapeHtml(publicReference)}</p>` : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(doc.number)}</title><style>body{font:16px system-ui;margin:40px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #ccc}@media print{button{display:none}}</style></head><body><h1>${title}</h1><p>${escapeHtml(orgName)}</p><h2>${escapeHtml(doc.number)}</h2>${reference}<p>Date ${escapeHtml(doc.document_date)}</p><table><thead><tr><th>Description</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>${lines.map(line => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(String(line.quantity))}</td><td>${escapeHtml(line.unit)}</td></tr>`).join("")}</tbody></table><p>Received by ____________________ Date __________</p><button type="button" onclick="window.print()">Print / Save PDF</button></body></html>`
}

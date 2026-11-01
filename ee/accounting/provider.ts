/**
 * Provider-neutral accounting seam.
 *
 * This is an export to an external book of record, not a general ledger and
 * not an e-Tax filing. FlowAccount is the one adapter this build can run.
 * PEAK and Xero stay on the same interface so a later adapter can replace
 * `unavailable` without changing the sync map.
 */
import {
  pushFlowAccountInvoice,
  toFlowAccountDocument,
  type AccountingTransport,
  type ExportInvoice,
} from "@/ee/accounting/flowaccount"

/** Providers expect baht. Convert satang with `satangToBaht` in the mapper. */
export type ExternalInvoicePayload = {
  reference: string
  customerName: string
  issueDate: string | null
  dueDate: string | null
  currency: string
  totalBaht: number
  status: string
}

/** Matches the `accounting_provider` enum. */
export type ProviderKey = "flowaccount" | "peak" | "xero"

export type PushInvoiceOptions = {
  transport: AccountingTransport
  fetchImpl?: typeof fetch
  token?: string
  baseUrl?: string
}

export interface AccountingProvider {
  key: ProviderKey
  label: string
  /** False until that provider has an adapter in this build. */
  available: boolean
  pushInvoice(invoice: ExportInvoice, options: PushInvoiceOptions): Promise<{ externalId: string }>
}

const LABELS: Record<ProviderKey, string> = {
  flowaccount: "FlowAccount",
  peak: "PEAK",
  xero: "Xero",
}

function unavailable(key: Exclude<ProviderKey, "flowaccount">): AccountingProvider {
  return {
    key,
    label: LABELS[key],
    available: false,
    async pushInvoice() {
      throw new Error("This build exports to FlowAccount only. PEAK and Xero use the same adapter later.")
    },
  }
}

export const PROVIDERS: Record<ProviderKey, AccountingProvider> = {
  flowaccount: {
    key: "flowaccount",
    label: LABELS.flowaccount,
    available: true,
    pushInvoice(invoice, options) {
      return pushFlowAccountInvoice(toFlowAccountDocument(invoice), options)
    },
  },
  peak: unavailable("peak"),
  xero: unavailable("xero"),
}

export function getProvider(key: ProviderKey): AccountingProvider {
  return PROVIDERS[key]
}

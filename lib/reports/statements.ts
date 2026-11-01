export type StatementInvoice = {
  issueDate: string
  dueDate: string | null
  status: string
  netSatang: number
  vatSatang: number
  outstandingSatang: number
}

export type StatementCost = {
  incurredOn: string
  dueDate: string | null
  paidAt: string | null
  netSatang: number
  inputVatSatang: number
  payableSatang: number
}

export type AgingBuckets = {
  current: number
  days1to30: number
  days31to60: number
  days61to90: number
  days91plus: number
}

const ISSUED = new Set(["sent", "partially_paid", "paid", "overdue"])

export function profitAndLoss(input: {
  from: string
  to: string
  invoices: StatementInvoice[]
  costs: StatementCost[]
  cogsSatang: number
}) {
  const invoices = issuedInRange(input.invoices, input.from, input.to)
  const costs = input.costs.filter((cost) => inRange(cost.incurredOn, input.from, input.to))
  const revenueSatang = sum(invoices.map((row) => row.netSatang))
  const outputVatSatang = sum(invoices.map((row) => row.vatSatang))
  const expenseSatang = sum(costs.map((row) => row.netSatang))
  const inputVatSatang = sum(costs.map((row) => row.inputVatSatang))
  return {
    revenueSatang,
    outputVatSatang,
    cogsSatang: input.cogsSatang,
    expenseSatang,
    inputVatSatang,
    profitSatang: revenueSatang - input.cogsSatang - expenseSatang,
  }
}

export function balanceSupport(input: {
  asOf: string
  cashSatang: number
  invoices: StatementInvoice[]
  costs: StatementCost[]
}) {
  const receivablesSatang = sum(input.invoices.filter((row) => ISSUED.has(row.status) && row.issueDate <= input.asOf).map((row) => row.outstandingSatang))
  const payablesSatang = sum(input.costs.filter((row) => !row.paidAt && row.incurredOn <= input.asOf).map((row) => row.payableSatang))
  return {
    cashSatang: input.cashSatang,
    receivablesSatang,
    payablesSatang,
    balances: false,
  }
}

export function vatSupport(input: { from: string; to: string; invoices: StatementInvoice[]; costs: StatementCost[] }) {
  const profit = profitAndLoss({ ...input, cogsSatang: 0 })
  return {
    outputVatSatang: profit.outputVatSatang,
    inputVatSatang: profit.inputVatSatang,
    netVatSatang: profit.outputVatSatang - profit.inputVatSatang,
  }
}

export function aging(asOf: string, rows: { dueDate: string | null; amountSatang: number }[]): AgingBuckets {
  const buckets: AgingBuckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days91plus: 0 }
  for (const row of rows) {
    if (row.amountSatang <= 0) continue
    const late = row.dueDate ? daysAfter(row.dueDate, asOf) : 0
    if (late <= 0) buckets.current += row.amountSatang
    else if (late <= 30) buckets.days1to30 += row.amountSatang
    else if (late <= 60) buckets.days31to60 += row.amountSatang
    else if (late <= 90) buckets.days61to90 += row.amountSatang
    else buckets.days91plus += row.amountSatang
  }
  return buckets
}

export function monthBounds(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null
  const [year, monthNumber] = month.split("-").map(Number)
  if (!year || !monthNumber || monthNumber > 12) return null
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` }
}

function issuedInRange(invoices: StatementInvoice[], from: string, to: string) {
  return invoices.filter((row) => ISSUED.has(row.status) && inRange(row.issueDate, from, to))
}

function inRange(date: string, from: string, to: string) {
  return date >= from && date <= to
}

function daysAfter(due: string, asOf: string) {
  const start = Date.parse(`${due}T00:00:00Z`)
  const end = Date.parse(`${asOf}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.round((end - start) / 86_400_000)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { databaseFixture, pageContent } from './__tests__/tenant-fixture'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ orgId: 'A', client: {} as unknown }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('No service role for business reads') } }))
vi.mock('@/lib/auth', () => ({ requireOrgContext: async () => ({ userId: 'user', orgId: state.orgId, role: 'owner' }) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND') }, redirect: vi.fn(), useRouter: vi.fn(), useSearchParams: vi.fn(), usePathname: () => '' }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/(app)/clients/_components/clients-toolbar', () => ({ ClientsToolbar: () => null }))

import ClientsPage from '@/app/(app)/clients/page'
import ClientDetailPage from '@/app/(app)/clients/[id]/page'
import EditClientPage from '@/app/(app)/clients/[id]/edit/page'
import DealsPage from '@/app/(app)/deals/page'
import DealDetailPage from '@/app/(app)/deals/[id]/page'
import EditDealPage from '@/app/(app)/deals/[id]/edit/page'
import NewDealPage from '@/app/(app)/deals/new/page'
import ProjectsPage from '@/app/(app)/projects/page'
import { addActivity } from '@/app/(app)/deals/actions'
import { GET as exportDeals } from '@/app/(app)/deals/export/route'
import { currentMonthKey } from '@/lib/dates'
import { getDashboardData } from '@/lib/queries/dashboard'
import DashboardPage from '@/app/(app)/dashboard/page'

afterEach(() => vi.useRealTimers())

beforeEach(() => {
  state.orgId = 'A'
  const date = `${currentMonthKey()}-05`
  state.client = databaseFixture({
    clients: ['A','B'].map((org_id, index) => ({ id: `c0000000-0000-4000-8000-00000000000${index + 1}`, org_id, name: `CLIENT_${org_id}`, created_at: '2026-10-01' })),
    deals: ['A','B'].map((org_id, index) => ({ id: `deal-${org_id}`, org_id, title: `DEAL_${org_id}`, stage: 'lead', probability: 10, sequence: 0, value_satang: org_id === 'A' ? 100 : 999, client_id: `c0000000-0000-4000-8000-00000000000${index + 1}`, created_at: '2026-10-01' })),
    activities: ['A','B'].map(org_id => ({ id: `activity-${org_id}`, org_id, body: `ACTIVITY_${org_id}`, type: 'note', client_id: 'c0000000-0000-4000-8000-000000000001', deal_id: 'deal-A', done: false, due_date: '2026-10-01' })),
    contacts: ['A','B'].map(org_id => ({ id: `contact-${org_id}`, org_id, name: `CONTACT_${org_id}`, client_id: 'c0000000-0000-4000-8000-000000000001' })),
    org_settings: ['A','B'].map(org_id => ({ org_id, cash_balance_satang: org_id === 'A' ? 500 : 800 })),
    invoices: ['A','B'].map(org_id => ({id:`invoice-${org_id}`,org_id,status:'sent',amount_satang:org_id==='A'?1000:3000,total_satang:org_id==='A'?1070:3210,vat_satang:org_id==='A'?70:210,issue_date:date,due_date:'2000-01-01',is_recurring:true,recurring_interval:'monthly'})),
    invoice_balances: ['A','B'].map(org_id => ({ org_id, invoice_id: `invoice-${org_id}`, paid_satang: org_id === 'A' ? 100 : 500, credited_satang: 0 })),
    payments: ['A','B'].map(org_id => ({org_id,invoice_id:`invoice-${org_id}`,amount_satang:org_id==='A'?100:500,paid_at:date,verification_state:'verified'})).concat([{org_id:'A',invoice_id:'invoice-A',amount_satang:777,paid_at:date,verification_state:'legacy_unverified'}]),
    costs: ['A','B'].map(org_id => ({org_id,amount_satang:org_id==='A'?300:900,incurred_on:date})),
    monthly_inventory_cogs: ['A','B'].map(org_id => ({org_id, month: `${currentMonthKey()}-01`, amount_satang: org_id === 'A' ? 200 : 700})),
    subscriptions: ['A','B'].map(org_id => ({org_id,status:'active',amount_satang:org_id==='A'?600:1800,interval:'monthly'})),
    time_entries: ['A','B'].map(org_id => ({org_id,project_id:`project-${org_id}`,minutes:org_id==='A'?60:180,billable:true,rate_satang:100,work_date:date})),
    projects: [{ org_id: 'A', status: 'in_progress' },{ org_id: 'B', status: 'in_progress' }],
    saved_views: ['A','B'].map(org_id => ({ id: org_id, org_id, user_id: 'user', module: 'deals', name: `VIEW_${org_id}`, config: {} })),
    quotes: ['A','B'].map(org_id => ({ org_id, status: 'sent', total_satang: org_id === 'A' ? 200 : 1000 })),
  })
})

describe('active workspace business reads', () => {
  it.each([
    ['clients', () => ClientsPage({ searchParams: Promise.resolve({}) }), 'CLIENT'],
    ['deals', () => DealsPage({ searchParams: Promise.resolve({}) }), 'DEAL'],
    ['new deal client selector', () => NewDealPage({ searchParams: Promise.resolve({}) }), 'CLIENT'],
    ['edit deal client selector', () => EditDealPage({ params: Promise.resolve({ id: 'deal-A' }) }), 'CLIENT'],
  ])('%s show only the active workspace', async (_name, render, marker) => {
    const content = pageContent(await render())
    expect(content).toContain(`${marker}_A`)
    expect(content).not.toContain(`${marker}_B`)
  })

  it('switching workspaces changes list results', async () => {
    state.orgId = 'B'
    const content = pageContent(await ClientsPage({ searchParams: Promise.resolve({}) }))
    expect(content).toContain('CLIENT_B')
    expect(content).not.toContain('CLIENT_A')
  })

  it('deal due dots survive the 1,000-row cap', async () => {
    const busy = Array.from({ length: 1000 }, (_, i) => `deal-busy-${i}`)
    state.client = databaseFixture({
      clients: [{ id: 'c0000000-0000-4000-8000-000000000001', org_id: 'A', name: 'CLIENT_A' }],
      deals: [{ id: 'deal-A', org_id: 'A', title: 'DEAL_A', stage: 'lead', probability: 10, sequence: 0, value_satang: 100, client_id: 'c0000000-0000-4000-8000-000000000001', next_follow_up_date: '2026-12-31', created_at: '2026-10-01' }],
      activities: [...busy, 'deal-A'].map((deal_id) => ({ org_id: 'A', deal_id, done: false, due_date: deal_id === 'deal-A' ? '2026-01-15' : '2026-01-01' })),
      deal_next_activity: [...busy, 'deal-A'].map((deal_id) => ({ org_id: 'A', deal_id, next_due_date: deal_id === 'deal-A' ? '2026-01-15' : '2026-01-01', open_count: 1 })),
    })
    const content = pageContent(await DealsPage({ searchParams: Promise.resolve({}) }))
    expect(content).toContain('2026-01-15')
  })

  it('boards list every deal and project past the 1,000-row cap, so column counts and sums are complete', async () => {
    state.client = databaseFixture({
      deals: Array.from({ length: 1001 }, (_, i) => ({ id: `deal-${i}`, org_id: 'A', title: `DEAL_${i}`, stage: 'lead', probability: 10, sequence: 0, value_satang: 1, client_id: 'c0000000-0000-4000-8000-000000000001', created_at: '2026-10-01' })),
      projects: Array.from({ length: 1001 }, (_, i) => ({ id: `project-${i}`, org_id: 'A', name: `PROJECT_${i}`, status: 'in_progress' })),
    })
    expect(pageContent(await DealsPage({ searchParams: Promise.resolve({}) }))).toContain('DEAL_1000')
    expect(pageContent(await ProjectsPage({ searchParams: Promise.resolve({ view: 'board' }) }))).toContain('PROJECT_1000')
  })

  it('clients show open deal counts, including zero, without counting closed or other-workspace deals', async () => {
    state.client = databaseFixture({
      clients: ['active', 'second', 'closed', 'empty'].map(id => ({
        id, org_id: 'A', name: id, created_at: '2026-10-01',
      })).concat([{ id: 'foreign', org_id: 'B', name: 'foreign', created_at: '2026-10-01' }]),
      deals: [
        ...['lead', 'contacted', 'discovery', 'proposal', 'negotiation', 'won', 'lost'].map(stage => ({
          org_id: 'A', client_id: 'active', stage,
        })),
        { org_id: 'A', client_id: 'second', stage: 'proposal' },
        { org_id: 'A', client_id: 'closed', stage: 'won' },
        { org_id: 'A', client_id: 'closed', stage: 'lost' },
        { org_id: 'B', client_id: 'active', stage: 'lead' },
      ],
    })
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Open deals')
    const rows = [...html.matchAll(/<tr\b[^>]*>(.*?)<\/tr>/g)].slice(1)
    expect(rows.map(([, row]) => {
      const cells = [...row.matchAll(/<td\b[^>]*>(.*?)<\/td>/g)]
        .map(([, cell]) => cell.replace(/<[^>]+>/g, ''))
      return [cells[0], cells[3]]
    })).toEqual([['active', '5'], ['second', '1'], ['closed', '0'], ['empty', '0']])
  })

  it('client search keeps open deal counts and the no-results state', async () => {
    const html = renderToStaticMarkup(await ClientsPage({ searchParams: Promise.resolve({ q: ' CLIENT_A ' }) }))
    expect(html).toContain('CLIENT_A')
    expect(html).not.toContain('CLIENT_B')
    expect(html).toContain('Open deals')
    expect(html).toMatch(/<td[^>]*>1<\/td>/)
    expect(pageContent(await ClientsPage({ searchParams: Promise.resolve({ q: 'missing' }) })))
      .toContain('No matching clients')
  })

  it.each([
    ['client detail', ClientDetailPage, 'c0000000-0000-4000-8000-000000000002'],
    ['client edit', EditClientPage, 'c0000000-0000-4000-8000-000000000002'],
    ['deal detail', DealDetailPage, 'deal-B'],
    ['deal edit', EditDealPage, 'deal-B'],
  ])('direct inactive workspace navigation to %s returns not found', async (_name, render, id) => {
    await expect(render({ params: Promise.resolve({ id }) })).rejects.toThrow('NOT_FOUND')
  })

  it('client children and deal views remain in the active workspace', async () => {
    const content = pageContent(await ClientDetailPage({ params: Promise.resolve({ id: 'c0000000-0000-4000-8000-000000000001' }) }))
    expect(content).toContain('CONTACT_A')
    expect(content).not.toContain('CONTACT_B')
    expect(content).not.toContain('ACTIVITY_B')
    expect(pageContent(await DealsPage({ searchParams: Promise.resolve({}) }))).not.toContain('VIEW_B')
  })

  it('dashboard totals use only the active workspace', async () => {
    const a = await getDashboardData()
    expect(a.pipelineSatang).toBe(100)
    expect(a.openQuotesValueSatang).toBe(200)
    expect(a.activeProjectCount).toBe(1)
    expect(a.cashSatang).toBe(500)
    expect(a.monthlyRevenueSatang).toBe(1000)
    expect(a.revenueHistory).toHaveLength(6)
    expect(a.revenueHistory[5]).toEqual({ month: currentMonthKey(), revenueSatang: a.monthlyRevenueSatang })
    expect(a.monthlyBurnSatang).toBe(300)
    expect(a.monthlyCogsSatang).toBe(200)
    expect(a.unpaidSatang).toBe(900)
    expect(a.unpaidInvoiceCount).toBe(1)
    expect(a.overdueInvoiceCount).toBe(1)
    expect(a.mrrSatang).toBe(600)
    expect(a.invoiceMrrSatang).toBe(1000)
    expect(a.billableHoursThisMonth).toBe(1)
    expect(a.billableValueThisMonthSatang).toBe(100)
    expect(a.overdueFollowUps).toHaveLength(1)
    state.orgId = 'B'
    const b = await getDashboardData()
    expect(b.pipelineSatang).toBe(999)
    expect(b.openQuotesValueSatang).toBe(1000)
    expect(b.cashSatang).toBe(800)
    expect(b.monthlyRevenueSatang).toBe(3000)
    expect(b.monthlyCogsSatang).toBe(700)
    expect(b.revenueHistory[5]).toEqual({ month: currentMonthKey(), revenueSatang: b.monthlyRevenueSatang })
    expect(b.unpaidSatang).toBe(2500)
    expect(b.mrrSatang).toBe(1800)
    expect(b.billableHoursThisMonth).toBe(3)
  })
})

it('dashboard revenue history uses issued base revenue and the Bangkok current month', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-31T17:00:00Z'))
  const invoice = { org_id: 'A', status: 'sent', vat_satang: 0, amount_satang: 0 }
  state.client = databaseFixture({ invoices: [
    { ...invoice, issue_date: '2025-08-31', total_satang: 9999 },
    { ...invoice, issue_date: '2025-09-01', total_satang: 101 },
    { ...invoice, issue_date: '2026-01-31', total_satang: 202 },
    { ...invoice, issue_date: '2026-02-01', total_satang: 303 },
    { ...invoice, issue_date: '2026-02-28', total_satang: 404 },
    { ...invoice, issue_date: '2026-03-01', total_satang: 9999 },
    { ...invoice, org_id: 'B', issue_date: '2026-02-01', total_satang: 9999 },
    { ...invoice, status: 'draft', issue_date: '2026-02-01', total_satang: 9999 },
    { ...invoice, status: 'cancelled', issue_date: '2026-02-01', total_satang: 9999 },
  ] })
  const data = await getDashboardData()
  expect(data.revenueHistory).toEqual([
    { month: '2025-09', revenueSatang: 101 },
    { month: '2025-10', revenueSatang: 0 },
    { month: '2025-11', revenueSatang: 0 },
    { month: '2025-12', revenueSatang: 0 },
    { month: '2026-01', revenueSatang: 202 },
    { month: '2026-02', revenueSatang: 707 },
  ])
  expect(data.monthlyRevenueSatang).toBe(707)
  const html = renderToStaticMarkup(await DashboardPage())
  expect(html).toContain('รายได้ 6 เดือนล่าสุด')
  expect(html).toContain('Asia/Bangkok')
  expect(html.match(/<time /g)).toHaveLength(6)
  expect(html).toContain('height:100%')
  expect(html).toContain('฿7.07')
})

it('dashboard shows six zero months and safe bars when there are no issued invoices', async () => {
  state.client = databaseFixture({})
  expect((await getDashboardData()).revenueHistory.map(row => row.revenueSatang)).toEqual([0, 0, 0, 0, 0, 0])
  const html = renderToStaticMarkup(await DashboardPage())
  expect(html).toContain('ยังไม่มีรายได้ในช่วง 6 เดือนนี้')
  expect(html.match(/height:0%/g)).toHaveLength(6)
  expect(html).not.toMatch(/(?:NaN|Infinity)%/)
})

it('an inactive deal cannot create an activity in the active workspace', async () => {
 const id = '00000000-0000-4000-8000-000000000011'
 const activities: Record<string,unknown>[] = []
 state.client = databaseFixture({deals:[{id,org_id:'B',client_id:'c0000000-0000-4000-8000-000000000002'}],activities})
 expect(await addActivity({dealId:id,type:'note',body:'Wrong workspace'})).toEqual({error:'Deal not found in the active workspace'})
 expect(activities).toHaveLength(0)
})
it('an activity can be added to a deal whose seed-shaped id is not an RFC UUID', async () => {
 const id = '20000000-0000-0000-0000-000000000001'
 const activities: Record<string,unknown>[] = []
 state.client = databaseFixture({deals:[{id,org_id:'A',client_id:'c0000000-0000-4000-8000-000000000001'}],activities})
 expect(await addActivity({dealId:id,type:'note',body:'Seeded'})).toEqual({})
 expect(activities).toEqual([expect.objectContaining({org_id:'A',deal_id:id,client_id:'c0000000-0000-4000-8000-000000000001'})])
})
it('a failed dashboard query cannot report invented zero balances', async () => {
 const client = state.client as ReturnType<typeof databaseFixture>
 state.client = {from: (table:string) => table === 'costs'
   ? {select: () => { const q = { eq: () => q, order: () => q, range: async () => ({data:null,error:{message:'Unavailable'}}) }; return q }}
   : client.from(table)}
 await expect(getDashboardData()).rejects.toThrow('Unable to load dashboard data')
})

it('deal exports contain only the active workspace and its client names',async()=>{
 const a=await (await exportDeals(new Request('https://app.example.test/deals/export'))).text()
 expect(a).toContain('DEAL_A');expect(a).toContain('CLIENT_A');expect(a).not.toContain('DEAL_B')
 state.orgId='B'
 const b=await (await exportDeals(new Request('https://app.example.test/deals/export'))).text()
 expect(b).toContain('DEAL_B');expect(b).toContain('CLIENT_B');expect(b).not.toContain('DEAL_A')
})

it('dashboard reads beyond 1000 net receivables and uses issued pre-VAT revenue', async () => {
 vi.useFakeTimers().setSystemTime(new Date('2026-10-23T06:00:00Z'))
 const invoices = Array.from({length:1501},(_,n)=>({id:`vat-${n}`,org_id:'A',status:'sent',amount_satang:104000,total_satang:107000,vat_satang:7000,issue_date:'2026-10-01',due_date:'2026-10-01',is_recurring:false}))
 const payments = invoices.map(i=>({id:`paid-${i.id}`,org_id:'A',invoice_id:i.id,amount_satang:100000,paid_at:'2026-10-23T05:00:00Z',verification_state:'verified'}))
 state.client = databaseFixture({invoices,payments,invoice_balances:invoices.map(i=>({org_id:i.org_id,invoice_id:i.id,paid_satang:100000,credited_satang:0}))})
 const result = await getDashboardData()
 expect(result.unpaidSatang).toBe(1501*4000)
 expect(result.unpaidInvoiceCount).toBe(1501)
 expect(result.overdueInvoiceCount).toBe(1501)
 expect(result.monthlyRevenueSatang).toBe(1501*100000)
})

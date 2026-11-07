// Fixed schema projections, not a schema-introspection or arbitrary SQL interface.
// Read policy mirrors the existing pages and migrations; session RLS remains authoritative.
const KIND = { m: "money-in-satang", i: "integer", n: "number", b: "boolean", d: "date", j: "json", a: "text-array" }
// UUID and enum columns are represented as text for display, but do not support ILIKE.
const SEARCHABLE_TEXT_FIELDS = new Set(["name", "name_th", "name_en", "title", "description", "notes", "note", "body", "content", "summary", "reason", "reference", "close_note", "memo", "full_name", "legal_name", "business_address", "billing_address", "address", "email", "phone", "tax_id", "filename", "number", "sku", "industry", "vendor", "vendor_reference", "vendor_invoice_reference", "verification_reference", "review_reference", "certificate_no", "success_message", "decision_note", "variance_reason", "reusable_notes", "locale", "actor_email", "requester_email"])
const LABELS_TH = {
  id: "รหัส", org_id: "รหัสองค์กร", name: "ชื่อ", title: "หัวข้อ", description: "รายละเอียด", notes: "หมายเหตุ", body: "เนื้อหา", content: "เนื้อหา", status: "สถานะ", number: "เลขที่", amount_satang: "จำนวนเงิน (สตางค์)", total_satang: "ยอดรวม (สตางค์)", created_at: "สร้างเมื่อ", updated_at: "แก้ไขเมื่อ", client_id: "รหัสลูกค้า", project_id: "รหัสโครงการ", invoice_id: "รหัสใบแจ้งหนี้", email: "อีเมล", phone: "โทรศัพท์", due_date: "วันครบกำหนด", filename: "ชื่อไฟล์", reason: "เหตุผล", reference: "ข้อมูลอ้างอิง", quantity: "จำนวน", full_name: "ชื่อเต็ม", role: "บทบาท",
}
const title = key => key.replace(/_/g, " ").replace(/^./, character => character.toUpperCase())
const common = "id org_id created_at:d updated_at:d"
/**
 * @typedef {{key:string,labelEn:string,labelTh:string,kind:string,unit?:string,
 *   searchable:boolean,textReadable:boolean}} ReaderField
 * @typedef {{key:string,labelEn:string,labelTh:string,fields:ReadonlyArray<Readonly<ReaderField>>,
 *   primaryKey:ReadonlyArray<string>,requiredCapability:import("../permissions").Capability|null,
 *   scope:string,exclusions:Record<string,string>,readable?:boolean,route?:string,
 *   financialAuthority?:string,reason?:string,excludedFields?:ReadonlyArray<string>}} ReaderEntity
 */
/**
 * @param {string} key
 * @param {string} labelTh
 * @param {string} fields
 * @param {Partial<Omit<ReaderEntity,"key"|"labelEn"|"labelTh"|"fields">>} [options]
 * @returns {Readonly<ReaderEntity>}
 */
function entity(key, labelTh, fields, options = {}) {
  const definitions = fields.replace(/\$common/g, common).split(/\s+/).filter(Boolean).map(spec => {
    const [name, code] = spec.split(":")
    const kind = KIND[code] ?? "text"
    return Object.freeze({ key: name, labelEn: title(name), labelTh: LABELS_TH[name] ?? `${labelTh} · ${title(name)}`, kind, ...(kind === "money-in-satang" ? { unit: "satang" } : name === "average_cost" || name === "average_cost_after" ? { unit: "satang-per-unit" } : {}), searchable: kind === "text" && SEARCHABLE_TEXT_FIELDS.has(name), textReadable: kind === "text" || kind === "json" || kind === "text-array" })
  })
  return Object.freeze({ key, labelEn: title(key), labelTh, fields: Object.freeze(definitions), primaryKey: ["id"], requiredCapability: null, scope: "current organization; session RLS", exclusions: {}, ...options })
}
const internal = (key, labelTh, reason, fields) => entity(key, labelTh, "", { readable: false, reason, excludedFields: fields })

export const ERP_DATA_ENTITIES = Object.freeze([
  entity("accounting_connections", "การเชื่อมต่อบัญชี", "$common provider status", { requiredCapability: "accounting:manage", exclusions: { config: "Opaque provider configuration contains accounting credentials." } }),
  entity("accounting_sync_map", "สถานะซิงก์บัญชี", "$common external_id last_synced_at:d local_entity local_id provider status", { requiredCapability: "accounting:manage", exclusions: { last_error: "Provider diagnostics may contain credentials or credential-bearing URLs." } }),
  entity("activities", "กิจกรรม", "$common body client_id deal_id done:b due_date:d owner type record_type record_id completed_at:d completed_by"),
  entity("ai_outputs", "ผลลัพธ์ AI ที่บันทึก", "id org_id content created_at:d created_by entity entity_id kind model"),
  entity("audit_log", "บันทึกตรวจสอบ", "id org_id action actor_email actor_id created_at:d entity entity_id summary close_chain_prev close_chain_seq:i close_chain_sha256", { requiredCapability: "audit:view", exclusions: { meta: "Opaque audit metadata can retain command keys, invite/public codes and provider diagnostics." } }),
  entity("automation_templates", "แม่แบบอัตโนมัติ", "$common category_id description implementation_checklist:j internal_value_satang:m name price_satang:m reusable_notes tags:a"),
  entity("bank_lines", "รายการธนาคาร", "id org_id booked_on:d amount_satang:m reference matched_payment_id close_note created_at:d", { requiredCapability: "profit:view" }),
  entity("clients", "ลูกค้า", "$common branch_label billing_address industry name notes owner portal_enabled:b source tax_id", { route: "/clients/{id}", exclusions: { portal_token: "Customer portal bearer credential." } }),
  entity("contacts", "ผู้ติดต่อ", "$common client_id email name phone role"),
  entity("costs", "ต้นทุน", "$common amount_satang:m category incurred_on:d notes project_id vendor vendor_id purchase_order_id expense_claim_id bill_number bill_date:d due_date:d paid_at:d vendor_bill_match_id vendor_invoice_reference input_vat_rate:n input_vat_satang:m purchase_cost_kind"),
  entity("credit_note_lines", "รายการใบลดหนี้", "id org_id credit_note_id invoice_item_id raw_satang:m quantity:n"),
  entity("credit_notes", "ใบลดหนี้", "id org_id invoice_id number issue_date:d reason amount_satang:m snapshot:j issued_by created_at:d"),
  entity("deal_lost_reasons", "เหตุผลที่แพ้ดีล", "id org_id name active:b created_at:d"),
  entity("deals", "ดีล", "$common probability:i lost_reason_id won_at:d lost_at:d sequence:i client_id currency expected_close_date:d next_follow_up_date:d notes owner source stage title value_satang:m", { route: "/deals/{id}" }),
  internal("document_counters", "ตัวนับเอกสาร", "Internal issuance counters: authenticated has no SELECT grant or read policy. Issued document numbers remain readable on business records.", ["org_id", "kind", "year", "value"]),
  entity("document_public_refs", "การอ้างอิงเอกสารสาธารณะ", "org_id kind record_id created_at:d created_by", { primaryKey: ["kind", "record_id"], exclusions: { reference: "Public document lookup bearer code." } }),
  entity("document_sections", "ส่วนและบันทึกเอกสาร", "$common quote_id invoice_id purchase_order_id kind description lines_before:i position:i"),
  entity("draft_close_acceptance_requests", "การรับรองยอดปิดบัญชีฉบับร่าง", "id org_id requested_by through_date:d debit_satang:m credit_satang:m line_count:i figures_sha256 status confirmed_by created_at:d confirmed_at:d", { requiredCapability: "profit:view" }),
  entity("expense_claims", "ใบเบิกค่าใช้จ่าย", "$common number employee title status submitted_at:d decided_by decided_at:d decision_note paid_at:d", { route: "/expenses/{id}", scope: "current organization; staff see all, other roles see their own claims through RLS" }),
  entity("expense_lines", "รายการเบิกค่าใช้จ่าย", "id org_id claim_id spent_on:d category description amount_satang:m project_id position:i", { scope: "current organization; visible parent expense claim through RLS" }),
  entity("finance_lock_reopen_requests", "คำขอเปิดงวดบัญชี", "id requested_by lock_date:d previous_lock_date:d reason created_at:d requester_email", { requiredCapability: "settings:manage", scope: "current organization; pending requests only via existing list_finance_lock_reopen_requests RPC; confirmed/cancelled history is in audit_log", exclusions: { status: "Existing authorized RPC returns pending requests only.", confirmed_by: "Not returned by the existing pending-request RPC.", confirmed_at: "Not returned by the existing pending-request RPC." } }),
  entity("gl_accounts", "ผังบัญชี", "org_id code name_th name_en kind", { primaryKey: ["code"], requiredCapability: "profit:view" }),
  internal("integration_receipts", "ใบรับเหตุการณ์ระบบ", "Internal integration idempotency store: no authenticated read policy; payload may include integration secrets.", ["id", "org_id", "key", "event_type", "payload", "created_at"]),
  entity("invitations", "คำเชิญทีม", "$common accepted_by email expires_at:d invited_by role status", { requiredCapability: "team:manage", exclusions: { token: "Invitation bearer credential." } }),
  internal("invoice_issue_requests", "คำสั่งออกใบแจ้งหนี้", "Internal issuance idempotency store: authenticated SELECT revoked and no read policy. Use invoices and invoice_snapshots.", ["org_id", "key", "invoice_id", "source_version", "snapshot_id"]),
  entity("invoice_items", "รายการใบแจ้งหนี้", "$common quote_item_id wht_rate_bps:i tax_rate_bps:i amount_satang:m description invoice_id position:i quantity:n unit_price_satang:m product_id unit"),
  entity("invoice_line_stock", "การส่งสินค้าใบแจ้งหนี้", "org_id line_id invoice_id delivered_quantity:n returned_quantity:n", { primaryKey: ["line_id"] }),
  entity("invoice_snapshots", "เอกสารใบแจ้งหนี้ที่ออกแล้ว", "id org_id invoice_id issued_at:d issued_by number snapshot:j source_version:i"),
  entity("invoices", "ใบแจ้งหนี้", "$common source_subscription_id quote_invoice_kind quote_invoice_sealed:b quote_deposit_satang:m quote_deposit_deduction_satang:m quote_discount_satang:m prices_include_vat:b wht_rate_bps:i subtotal_satang:m vat_satang:m wht_satang:m total_satang:m tax_breakdown:j amount_satang:m client_id discount_satang:m due_date:d is_recurring:b issue_date:d issued_snapshot_id notes number project_id recurring_interval source_milestone_id source_quote_id status version:i", { route: "/finance/invoices/{id}", financialAuthority: "Raw document fields only. Use list_invoices for effective status, verified receipts, credits and complete issued-unpaid coverage; finance_summary for complete finance totals." }),
  entity("journal_entries", "รายการสมุดรายวัน", "id org_id entry_date:d memo created_by created_at:d source_invoice_id source_credit_note_id source_payment_id", { requiredCapability: "profit:view" }),
  entity("journal_lines", "รายการย่อยสมุดรายวัน", "org_id entry_id line_no:i account_code debit_satang:m credit_satang:m", { primaryKey: ["entry_id", "line_no"], requiredCapability: "profit:view" }),
  entity("lead_forms", "แบบฟอร์มรับลูกค้า", "id org_id name enabled:b default_owner success_message created_at:d", { requiredCapability: "settings:manage", exclusions: { token: "Public lead-form submission bearer code." } }),
  entity("lead_submissions", "การส่งแบบฟอร์มลูกค้า", "id org_id form_id client_id deal_id created_at:d", { requiredCapability: "settings:manage", exclusions: { ip_hash: "Anti-abuse network identity fingerprint, not business message content. Submitted business text is retained in the related client/deal/activity." } }),
  entity("member_cost_rates", "อัตราต้นทุนบุคลากร", "org_id user_id cost_rate_satang:m", { primaryKey: ["user_id"], requiredCapability: "team:manage", scope: "current organization; owner/admin only per member_cost_rates_staff_read (accountant profit:view does not grant individual rate access)" }),
  entity("memberships", "สมาชิกองค์กร", "$common role user_id", { scope: "current organization; owner/admin see team, others see own membership through RLS" }),
  entity("milestones", "หลักหมายโครงการ", "$common done:b due_date:d project_id source_quote_id title"),
  internal("mobile_devices", "อุปกรณ์มือถือ", "Service-only mobile authentication store: authenticated SELECT revoked; no read policy. Never expose token_hash.", ["id", "org_id", "user_id", "name", "token_hash", "created_at", "last_seen_at", "revoked_at"]),
  internal("mobile_pairings", "การจับคู่มือถือ", "Service-only one-time mobile pairing store: authenticated SELECT revoked; no read policy. Never expose token_hash.", ["id", "org_id", "created_by", "token_hash", "created_at", "expires_at", "consumed_at"]),
  entity("network_devices", "อุปกรณ์เครือข่าย", "id org_id name created_by created_at:d revoked_at:d last_received_at:d latest_captured_at:d latest_report:j", { requiredCapability: "settings:manage", scope: "current organization; owner/admin plus database MFA assurance gate", exclusions: { token_hash: "Ingest credential hash; session column SELECT explicitly denied." } }),
  entity("network_policy", "นโยบายเครือข่าย", "org_id allowed_cidrs:a updated_by updated_at:d", { primaryKey: ["org_id"], requiredCapability: "settings:manage", scope: "current organization; owner/admin plus database MFA assurance gate" }),
  entity("org_settings", "ข้อมูลและการตั้งค่าองค์กร", "$common require_different_payment_reviewer:b bill_variance_tolerance_bps:i scheduled_replenishment_enabled:b public_document_refs_enabled:b purchase_approval_threshold_satang:m over_receipt_tolerance_percent:n wht_rate_bps:i lock_date:d vat_registered:b vat_rate_bps:i prices_include_vat:b branch_label tax_invoice_template:j allow_negative_stock:b business_address cash_balance_satang:m legal_name monthly_burn_satang:m tax_id tax_status", { primaryKey: ["org_id"] }),
  entity("organizations", "องค์กรปัจจุบัน", "id name slug created_at:d updated_at:d"),
  entity("outbound_events", "สถานะการส่งข้อความ", "id org_id attempts:i created_at:d delivered_at:d event_type lease_expires_at:d next_attempt_at:d reminder_id status", { requiredCapability: "settings:manage", exclusions: { lease_token: "Worker lease bearer material.", payload: "Opaque outbound payload may contain portal links, recipients and credentials.", last_error: "Transport diagnostics may contain credential-bearing URLs." } }),
  entity("payment_allocations", "การจัดสรรเงินรับ", "id org_id amount_satang:m created_at:d invoice_id payment_id"),
  entity("payment_claims", "รายการแจ้งชำระเงิน", "$common amount_satang:m client_id invoice_id payment_id reference review_reference reviewed_at:d reviewed_by source status submitted_by requested_allocations:j", { exclusions: { idempotency_key: "Payment command replay identity, not business evidence." } }),
  internal("payment_command_results", "ผลคำสั่งชำระเงิน", "Internal payment command store: authenticated has no direct SELECT grant/read policy; request contains command evidence. Use payments, allocations and claims.", ["org_id", "key", "request", "result", "created_at"]),
  entity("payments", "การรับชำระเงิน", "$common client_id reversal_of refund_of amount_satang:m invoice_id method notes paid_at:d reconciled_payment_id verification_reference verification_state verified_by", { exclusions: { command_key: "Internal payment replay identity." } }),
  internal("portal_claim_requests", "คำสั่งแจ้งชำระจากพอร์ทัล", "Internal portal command idempotency store: no authenticated SELECT/read policy. Use payment_claims.", ["org_id", "key", "request", "result", "created_at"]),
  entity("product_vendor_lead_times", "ระยะเวลาจัดหาสินค้า", "org_id product_id vendor_id lead_days:i", { primaryKey: ["product_id", "vendor_id"] }),
  entity("products", "สินค้าและบริการ", "$common wht_rate_bps:i sku name description type unit list_price_satang:m cost_satang:m reorder_min:n reorder_qty:n default_vendor_id tax_rate_bps:i is_stockable:b active:b", { route: "/products/{id}" }),
  entity("profiles", "โปรไฟล์สมาชิก", "id full_name locale created_at:d updated_at:d", { scope: "current organization via session-visible memberships; profile RLS also applies", exclusions: { avatar_url: "Untrusted external URL can contain bearer query material; no URL is needed to read a member profile." } }),
  entity("project_tasks", "งานโครงการ", "$common assignee done:b due_date:d project_id status title"),
  entity("projects", "โครงการ", "$common budget_satang:m client_id deadline:d deal_id name owner source_quote_id status", { route: "/projects/{id}" }),
  entity("purchase_order_items", "รายการใบสั่งซื้อ", "id org_id purchase_order_id product_id description quantity:n unit unit_cost_satang:m received_quantity:n returned_quantity:n billed_quantity:n position:i"),
  entity("purchase_orders", "ใบสั่งซื้อ", "$common approved_by approved_at:d approval_snapshot:j rfq_snapshot:j rfq_delivered_at:d number vendor_id status order_date:d expected_date:d notes created_by", { route: "/purchases/{id}", exclusions: { rfq_delivery_key: "Delivery command replay identity.", rfq_delivery_error: "Transport diagnostics may contain credential-bearing URLs." } }),
  entity("purchase_withholdings", "ภาษีหัก ณ ที่จ่ายซื้อ", "id org_id cost_id paid_on:d form income_type rate_bps:i base_satang:m wht_satang:m certificate_year:i certificate_seq:i certificate_no created_by created_at:d", { requiredCapability: "profit:view" }),
  internal("quote_conversion_requests", "คำสั่งแปลงใบเสนอราคา", "Internal conversion command store: authenticated SELECT revoked and no read policy. Use quotes and linked invoices.", ["org_id", "key", "quote_id", "invoice_id", "created_at"]),
  entity("quote_items", "รายการใบเสนอราคา", "$common invoiced_quantity:n tax_rate_bps:i amount_satang:m description position:i quantity:n quote_id unit_price_satang:m product_id unit"),
  entity("quotes", "ใบเสนอราคา", "$common deal_id accepted_at:d accepted_by_name accepted_by_email prices_include_vat:b vat_satang:m tax_breakdown:j client_id converted_invoice_id discount_satang:m issue_date:d notes number owner project_id status subtotal_satang:m total_satang:m valid_until:d", { route: "/quotes/{id}" }),
  entity("record_attachments", "ไฟล์แนบรายการ", "id org_id record_type record_id filename size:i content_type uploaded_by created_at:d", { scope: "current organization; attachment and parent record RLS; content requires the existing authorized storage helper", exclusions: { path: "Private storage locator; never return a public/invented file URL." } }),
  entity("record_notes", "บันทึกรายการ", "id org_id record_type record_id author body created_at:d"),
  entity("reminders", "การแจ้งเตือน", "$common channel due_date:d entity entity_id sent_at:d status title", { requiredCapability: "settings:manage", exclusions: { meta: "Opaque delivery metadata may include credentials or bearer links." } }),
  entity("saved_views", "มุมมองที่บันทึก", "$common module name user_id config:j", { scope: "current organization and authenticated user's own saved views; config exposes only the existing ViewConfig string keys", exclusions: { "config.*": "Unknown/non-string JSON keys outside q/status/stage/period/mine/groupBy/warehouse/product/sourceId are not part of the readable business projection." } }),
  entity("scheduled_replenishment_runs", "การจัดซื้อเติมสต็อกอัตโนมัติ", "org_id run_date:d vendor_id purchase_order_id created_at:d", { primaryKey: ["run_date", "vendor_id"] }),
  entity("stock_balances", "ยอดสินค้าคงคลัง", "org_id product_id warehouse_id quantity:n average_cost:n", { primaryKey: ["product_id", "warehouse_id"] }),
  entity("stock_counts", "ผลตรวจนับสินค้า", "org_id key product_id warehouse_id quantity:n reason unit_cost_satang:m", { primaryKey: ["key"] }),
  entity("stock_document_lines", "รายการเอกสารคลัง", "id org_id document_id product_id source_line_id description unit quantity:n"),
  entity("stock_documents", "เอกสารรับส่งสินค้า", "id org_id kind number document_date:d warehouse_id purchase_order_id invoice_id created_at:d created_by"),
  entity("stock_moves", "ความเคลื่อนไหวสินค้า", "id org_id document_id stock_value_satang:m source_line_id return_of_move_id sequence:i product_id warehouse_id kind quantity:n unit_cost_satang:m source_type source_id note moved_at:d created_by balance_after:n average_cost_after:n"),
  entity("stock_transfers", "การโอนคลังสินค้า", "org_id key product_id from_warehouse_id to_warehouse_id quantity:n reason created_at:d created_by", { primaryKey: ["key"] }),
  entity("subscription_occurrences", "รอบบิลสมาชิก", "org_id subscription_id occurrence_date:d invoice_id created_at:d", { primaryKey: ["subscription_id", "occurrence_date"] }),
  entity("subscriptions", "รอบการเรียกเก็บเงิน", "$common tax_rate_bps:i wht_rate_bps:i prices_include_vat:b product_id unit amount_satang:m auto_generate:b client_id interval last_generated_on:d name next_run_date:d notes project_id start_date:d status", { route: "/finance/subscriptions/{id}" }),
  entity("template_categories", "หมวดแม่แบบ", "$common name slug"),
  entity("time_billing_requests", "การเรียกเก็บเวลางาน", "org_id key project_id invoice_id", { primaryKey: ["key"], requiredCapability: "settings:manage" }),
  entity("time_entries", "เวลาปฏิบัติงาน", "$common invoice_id invoice_item_id billable:b minutes:i notes project_id rate_satang:m task_id user_id work_date:d"),
  entity("vendor_bill_matches", "การจับคู่ใบแจ้งหนี้ผู้ขาย", "id org_id vendor_id purchase_order_id vendor_reference kind bill_date:d due_date:d original_bill_id lines:j variances:j variance_reason tolerance_bps:i created_at:d", { exclusions: { credit_request: "Opaque command replay payload; readable bill lines/variances remain available." } }),
  entity("vendor_return_credit_sources", "ต้นทางลดหนี้คืนผู้ขาย", "org_id cost_id purchase_order_item_id quantity:n", { primaryKey: ["cost_id", "purchase_order_item_id"] }),
  entity("vendors", "ผู้ขาย", "$common name tax_id email phone address payment_terms_days:i notes active:b", { route: "/vendors/{id}" }),
  entity("warehouses", "คลังสินค้า", "id org_id code name address is_default:b active:b"),
  internal("workspace_requests", "คำสั่งสร้างองค์กร", "Internal workspace provisioning command store: no authenticated SELECT/read policy; not a cross-workspace discovery interface. Current organization remains readable.", ["user_id", "key", "name", "org_id", "created_at"]),
])

export const ERP_DATA_ENTITY_MAP = new Map(ERP_DATA_ENTITIES.map(definition => [definition.key, definition]))
export const ERP_DATA_TOOL_NAMES = Object.freeze(["erp_data_catalog", "erp_data_read", "erp_data_text"])

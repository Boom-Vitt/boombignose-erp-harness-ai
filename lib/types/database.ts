
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {

            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
      credit_notes: {
        Row: { id: string; org_id: string; invoice_id: string; number: string; issue_date: string; reason: string; amount_satang: number; snapshot: Json; issued_by: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      credit_note_lines: {
        Row: { id: string; org_id: string; credit_note_id: string; invoice_item_id: string | null; raw_satang: number; quantity: number | null }
        Insert: never
        Update: never
        Relationships: []
      }
      document_sections: {
        Row: { id: string; org_id: string; quote_id: string | null; invoice_id: string | null; purchase_order_id: string | null; kind: "section" | "note"; description: string; lines_before: number; position: number; created_at: string; updated_at: string }
        Insert: { id?: string; org_id: string; quote_id?: string | null; invoice_id?: string | null; purchase_order_id?: string | null; kind: "section" | "note"; description: string; lines_before: number; position: number; created_at?: string; updated_at?: string }
        Update: { kind?: "section" | "note"; description?: string; lines_before?: number; position?: number }
        Relationships: []
      }
      deal_lost_reasons: {
        Row: { id: string; org_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; org_id: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; org_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: [{ foreignKeyName: "deal_lost_reasons_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }]
      }
      member_cost_rates: {
        Row: { org_id: string; user_id: string; cost_rate_satang: number }
        Insert: { org_id: string; user_id: string; cost_rate_satang?: number }
        Update: { org_id?: string; user_id?: string; cost_rate_satang?: number }
        Relationships: [
          { foreignKeyName: "member_cost_rates_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "member_cost_rates_org_id_user_id_fkey"; columns: ["org_id", "user_id"]; isOneToOne: true; referencedRelation: "memberships"; referencedColumns: ["org_id", "user_id"] }
        ]
      }
      stock_balances: {
        Row: { org_id: string; product_id: string; warehouse_id: string; quantity: number; average_cost: number }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_transfers: {
        Row: { org_id: string; key: string; product_id: string; from_warehouse_id: string; to_warehouse_id: string; quantity: number; reason: string; created_at: string; created_by: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      gl_accounts: {
        Row: { org_id: string; code: string; name_th: string; name_en: string; kind: "asset" | "liability" | "equity" | "income" | "expense" }
        Insert: { org_id: string; code: string; name_th: string; name_en: string; kind: "asset" | "liability" | "equity" | "income" | "expense" }
        Update: { name_th?: string; name_en?: string; kind?: "asset" | "liability" | "equity" | "income" | "expense" }
        Relationships: []
      }
      bank_lines: {
        Row: { id: string; org_id: string; booked_on: string; amount_satang: number; reference: string; matched_payment_id: string | null; created_at: string }
        Insert: { id?: string; org_id: string; booked_on: string; amount_satang: number; reference: string; matched_payment_id?: string | null; created_at?: string }
        Update: { matched_payment_id?: string | null }
        Relationships: []
      }
      product_vendor_lead_times: {
        Row: { org_id: string; product_id: string; vendor_id: string; lead_days: number }
        Insert: never
        Update: never
        Relationships: []
      }
      scheduled_replenishment_runs: {
        Row: { org_id: string; run_date: string; vendor_id: string; purchase_order_id: string; created_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      warehouses: {
        Row: { id: string; org_id: string; code: string; name: string; address: string | null; is_default: boolean; active: boolean }
        Insert: { id?: string; org_id: string; code: string; name: string; address?: string | null; is_default?: boolean; active?: boolean }
        Update: { code?: string; name?: string; address?: string | null; is_default?: boolean; active?: boolean }
        Relationships: []
      }
      invoice_line_stock: {
        Row: { org_id: string; line_id: string; invoice_id: string; delivered_quantity: number; returned_quantity: number }
        Insert: { org_id: string; line_id: string; invoice_id: string; delivered_quantity?: number; returned_quantity?: number }
        Update: { delivered_quantity?: number; returned_quantity?: number }
        Relationships: []
      }
      stock_documents: {
        Row: { id: string; org_id: string; kind: "receipt" | "delivery"; number: string; document_date: string; warehouse_id: string | null; purchase_order_id: string | null; invoice_id: string | null; created_at: string; created_by: string | null }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_document_lines: {
        Row: { id: string; org_id: string; document_id: string; product_id: string | null; source_line_id: string; description: string; unit: string; quantity: number }
        Insert: never
        Update: never
        Relationships: []
      }
      stock_counts: {
        Row: { unit_cost_satang: number | null; org_id: string; key: string; product_id: string; warehouse_id: string; quantity: number; reason: string }
        Insert: { unit_cost_satang?: number | null; org_id: string; key: string; product_id: string; warehouse_id: string; quantity: number; reason: string }
        Update: never
        Relationships: []
      }
      stock_moves: {
        Row: { document_id: string | null; stock_value_satang: number; source_line_id: string | null; return_of_move_id: string | null; id: string; sequence: number; org_id: string; product_id: string; warehouse_id: string; kind: Database["public"]["Enums"]["stock_move_kind"]; quantity: number; unit_cost_satang: number; source_type: "purchase_order" | "invoice" | "adjustment" | "transfer"; source_id: string; note: string | null; moved_at: string; created_by: string | null; balance_after: number; average_cost_after: number }
        Insert: { document_id?: string | null; stock_value_satang?: number; source_line_id?: string | null; return_of_move_id?: string | null; id?: string; org_id: string; product_id: string; warehouse_id: string; kind: Database["public"]["Enums"]["stock_move_kind"]; quantity: number; unit_cost_satang: number; source_type: string; source_id: string; note?: string | null; balance_after: number; average_cost_after: number }
        Update: never
        Relationships: []
      }
      vendors: {
        Row: { id: string; org_id: string; name: string; tax_id: string | null; email: string | null; phone: string | null; address: string | null; payment_terms_days: number; notes: string | null; active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; org_id: string; name: string; tax_id?: string | null; email?: string | null; phone?: string | null; address?: string | null; payment_terms_days?: number; notes?: string | null; active?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; org_id?: string; name?: string; tax_id?: string | null; email?: string | null; phone?: string | null; address?: string | null; payment_terms_days?: number; notes?: string | null; active?: boolean; created_at?: string; updated_at?: string }
        Relationships: [{ foreignKeyName: "vendors_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }]
      }
      purchase_orders: {
        Row: { approved_by: string | null; approved_at: string | null; approval_snapshot: Json | null; rfq_snapshot: Json | null; rfq_delivery_key: string | null; rfq_delivered_at: string | null; rfq_delivery_error: string | null; id: string; org_id: string; number: string; vendor_id: string; status: Database["public"]["Enums"]["purchase_status"]; order_date: string; expected_date: string | null; notes: string | null; created_by: string | null; created_at: string; updated_at: string }
        Insert: { approved_by?: string | null; approved_at?: string | null; approval_snapshot?: Json | null; rfq_snapshot?: Json | null; rfq_delivery_key?: string | null; rfq_delivered_at?: string | null; rfq_delivery_error?: string | null; id?: string; org_id: string; number: string; vendor_id: string; status?: Database["public"]["Enums"]["purchase_status"]; order_date?: string; expected_date?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Update: { approved_by?: string | null; approved_at?: string | null; approval_snapshot?: Json | null; rfq_snapshot?: Json | null; rfq_delivery_key?: string | null; rfq_delivered_at?: string | null; rfq_delivery_error?: string | null; id?: string; org_id?: string; number?: string; vendor_id?: string; status?: Database["public"]["Enums"]["purchase_status"]; order_date?: string; expected_date?: string | null; notes?: string | null; created_by?: string | null; created_at?: string; updated_at?: string }
        Relationships: [{ foreignKeyName: "purchase_orders_org_id_vendor_id_fkey"; columns: ["org_id", "vendor_id"]; isOneToOne: false; referencedRelation: "vendors"; referencedColumns: ["org_id", "id"] }]
      }
      expense_claims: {
        Row: { id: string; org_id: string; number: string; employee: string; title: string; status: Database["public"]["Enums"]["expense_status"]; submitted_at: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null; paid_at: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; org_id: string; number: string; employee: string; title: string; status?: Database["public"]["Enums"]["expense_status"]; submitted_at?: string | null; decided_by?: string | null; decided_at?: string | null; decision_note?: string | null; paid_at?: string | null; created_at?: string; updated_at?: string }
        Update: { id?: string; org_id?: string; number?: string; employee?: string; title?: string; status?: Database["public"]["Enums"]["expense_status"]; submitted_at?: string | null; decided_by?: string | null; decided_at?: string | null; decision_note?: string | null; paid_at?: string | null; created_at?: string; updated_at?: string }
        Relationships: [{ foreignKeyName: "expense_claims_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }]
      }
      expense_lines: {
        Row: { id: string; org_id: string; claim_id: string; spent_on: string; category: Database["public"]["Enums"]["cost_category"]; description: string; amount_satang: number; project_id: string | null; position: number }
        Insert: { id?: string; org_id: string; claim_id: string; spent_on: string; category?: Database["public"]["Enums"]["cost_category"]; description: string; amount_satang: number; project_id?: string | null; position?: number }
        Update: { id?: string; org_id?: string; claim_id?: string; spent_on?: string; category?: Database["public"]["Enums"]["cost_category"]; description?: string; amount_satang?: number; project_id?: string | null; position?: number }
        Relationships: [{ foreignKeyName: "expense_lines_org_id_claim_id_fkey"; columns: ["org_id", "claim_id"]; isOneToOne: false; referencedRelation: "expense_claims"; referencedColumns: ["org_id", "id"] }, { foreignKeyName: "expense_lines_org_id_project_id_fkey"; columns: ["org_id", "project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["org_id", "id"] }]
      }
      purchase_order_items: {
        Row: { id: string; org_id: string; purchase_order_id: string; product_id: string | null; description: string; quantity: number; unit: string; unit_cost_satang: number; received_quantity: number; returned_quantity: number; billed_quantity: number; position: number }
        Insert: { id?: string; org_id: string; purchase_order_id: string; product_id?: string | null; description: string; quantity: number; unit?: string; unit_cost_satang: number; received_quantity?: number; returned_quantity?: number; billed_quantity?: number; position?: number }
        Update: { id?: string; org_id?: string; purchase_order_id?: string; product_id?: string | null; description?: string; quantity?: number; unit?: string; unit_cost_satang?: number; received_quantity?: number; returned_quantity?: number; billed_quantity?: number; position?: number }
        Relationships: [{ foreignKeyName: "purchase_order_items_org_id_purchase_order_id_fkey"; columns: ["org_id", "purchase_order_id"]; isOneToOne: false; referencedRelation: "purchase_orders"; referencedColumns: ["org_id", "id"] }, { foreignKeyName: "purchase_order_items_org_id_product_id_fkey"; columns: ["org_id", "product_id"]; isOneToOne: false; referencedRelation: "products"; referencedColumns: ["org_id", "id"] }]
      }
            "accounting_connections": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status": Database["public"]['Enums']["accounting_conn_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_conn_status"],"updated_at"?: string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id"?: string,"provider"?: Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_conn_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounting_connections_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"accounting_sync_map": {
                  Row: {
                    "created_at": string,"external_id": string | null,"id": string,"last_error": string | null,"last_synced_at": string | null,"local_entity": string,"local_id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status": Database["public"]['Enums']["accounting_sync_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"local_entity": string,"local_id": string,"org_id": string,"provider": Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_sync_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"external_id"?: string | null,"id"?: string,"last_error"?: string | null,"last_synced_at"?: string | null,"local_entity"?: string,"local_id"?: string,"org_id"?: string,"provider"?: Database["public"]['Enums']["accounting_provider"],"status"?: Database["public"]['Enums']["accounting_sync_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounting_sync_map_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"activities": {
                  Row: {
                    "body": string | null,"client_id": string | null,"created_at": string,"deal_id": string | null,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"owner": string | null,"type": Database["public"]['Enums']["activity_type"],"updated_at": string,"record_type": Database["public"]["Enums"]["record_type"] | null,"record_id": string | null,"completed_at": string | null,"completed_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"client_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"owner"?: string | null,"type"?: Database["public"]['Enums']["activity_type"],"updated_at"?: string,"record_type"?: Database["public"]["Enums"]["record_type"] | null,"record_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"client_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"owner"?: string | null,"type"?: Database["public"]['Enums']["activity_type"],"updated_at"?: string,"record_type"?: Database["public"]["Enums"]["record_type"] | null,"record_id"?: string | null,"completed_at"?: string | null,"completed_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "activities_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "activities_deal_id_fkey_tenant"
      columns: ["org_id","deal_id"]
isOneToOne: false
      referencedRelation: "deals"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "activities_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_outputs": {
                  Row: {
                    "content": string,"created_at": string,"created_by": string | null,"entity": string,"entity_id": string | null,"id": string,"kind": Database["public"]['Enums']["ai_output_kind"],"model": string | null,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string,"created_by"?: string | null,"entity": string,"entity_id"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["ai_output_kind"],"model"?: string | null,"org_id": string
                  }
                  Update: {
                    "content"?: string,"created_at"?: string,"created_by"?: string | null,"entity"?: string,"entity_id"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["ai_output_kind"],"model"?: string | null,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_outputs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_email": string | null,"actor_id": string | null,"created_at": string,"entity": string,"entity_id": string | null,"id": string,"meta": NonNullable<Json>,"org_id": string,"summary": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_email"?: string | null,"actor_id"?: string | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id": string,"summary": string
                  }
                  Update: {
                    "action"?: string,"actor_email"?: string | null,"actor_id"?: string | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_templates": {
                  Row: {
                    "category_id": string | null,"created_at": string,"description": string | null,"id": string,"implementation_checklist": NonNullable<Json>,"internal_value_satang": number | null,"name": string,"org_id": string,"price_satang": number | null,"reusable_notes": string | null,"tags": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"implementation_checklist"?: NonNullable<Json>,"internal_value_satang"?: number | null,"name": string,"org_id": string,"price_satang"?: number | null,"reusable_notes"?: string | null,"tags"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "category_id"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"implementation_checklist"?: NonNullable<Json>,"internal_value_satang"?: number | null,"name"?: string,"org_id"?: string,"price_satang"?: number | null,"reusable_notes"?: string | null,"tags"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_templates_category_id_fkey_tenant"
      columns: ["org_id","category_id"]
isOneToOne: false
      referencedRelation: "template_categories"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "automation_templates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
"branch_label": string | null,
                    "billing_address": string | null,"created_at": string,"id": string,"industry": string | null,"name": string,"notes": string | null,"org_id": string,"owner": string | null,"portal_enabled": boolean,"portal_token": string | null,"source": string | null,"tax_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
"branch_label"?: string | null,
                    "billing_address"?: string | null,"created_at"?: string,"id"?: string,"industry"?: string | null,"name": string,"notes"?: string | null,"org_id": string,"owner"?: string | null,"portal_enabled"?: boolean,"portal_token"?: string | null,"source"?: string | null,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
"branch_label"?: string | null,
                    "billing_address"?: string | null,"created_at"?: string,"id"?: string,"industry"?: string | null,"name"?: string,"notes"?: string | null,"org_id"?: string,"owner"?: string | null,"portal_enabled"?: boolean,"portal_token"?: string | null,"source"?: string | null,"tax_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "client_id": string,"created_at": string,"email": string | null,"id": string,"name": string,"org_id": string,"phone": string | null,"role": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"email"?: string | null,"id"?: string,"name": string,"org_id": string,"phone"?: string | null,"role"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"email"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"phone"?: string | null,"role"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "contacts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"vendor_bill_matches": {
                  Row: { id: string; org_id: string; vendor_id: string; purchase_order_id: string; vendor_reference: string; kind: "bill" | "credit"; bill_date: string; due_date: string; original_bill_id: string | null; credit_request: Json | null; lines: Json; variances: Json; variance_reason: string | null; tolerance_bps: number; created_at: string }
                  Insert: never
                  Update: never
                  Relationships: []
                },"vendor_return_credit_sources": {
                  Row: { org_id: string; cost_id: string; purchase_order_item_id: string; quantity: number }
                  Insert: never
                  Update: never
                  Relationships: []
                },"costs": {
                  Row: {
                    vendor_bill_match_id: string | null; vendor_invoice_reference: string | null; input_vat_rate: number; input_vat_satang: number;
                    purchase_cost_kind: "bill" | "credit" | "return_adjustment" | null,
                    vendor_id: string | null; purchase_order_id: string | null; expense_claim_id: string | null; bill_number: string | null; bill_date: string | null; due_date: string | null; paid_at: string | null;
                    "amount_satang": number,"category": Database["public"]['Enums']["cost_category"],"created_at": string,"id": string,"incurred_on": string,"notes": string | null,"org_id": string,"project_id": string | null,"updated_at": string,"vendor": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    vendor_bill_match_id?: string | null; vendor_invoice_reference?: string | null; input_vat_rate?: number; input_vat_satang?: number;
                    purchase_cost_kind?: "bill" | "credit" | "return_adjustment" | null,
                    vendor_id?: string | null; purchase_order_id?: string | null; expense_claim_id?: string | null; bill_number?: string | null; bill_date?: string | null; due_date?: string | null; paid_at?: string | null;
                    "amount_satang": number,"category"?: Database["public"]['Enums']["cost_category"],"created_at"?: string,"id"?: string,"incurred_on"?: string,"notes"?: string | null,"org_id": string,"project_id"?: string | null,"updated_at"?: string,"vendor"?: string | null
                  }
                  Update: {
                    vendor_bill_match_id?: string | null; vendor_invoice_reference?: string | null; input_vat_rate?: number; input_vat_satang?: number;
                    purchase_cost_kind?: "bill" | "credit" | "return_adjustment" | null,
                    vendor_id?: string | null; purchase_order_id?: string | null; expense_claim_id?: string | null; bill_number?: string | null; bill_date?: string | null; due_date?: string | null; paid_at?: string | null;
                    "amount_satang"?: number,"category"?: Database["public"]['Enums']["cost_category"],"created_at"?: string,"id"?: string,"incurred_on"?: string,"notes"?: string | null,"org_id"?: string,"project_id"?: string | null,"updated_at"?: string,"vendor"?: string | null
                  }
                  Relationships: [
 { foreignKeyName: "costs_vendor_tenant_fkey"; columns: ["org_id", "vendor_id"]; isOneToOne: false; referencedRelation: "vendors"; referencedColumns: ["org_id", "id"] },
 { foreignKeyName: "costs_purchase_order_tenant_fkey"; columns: ["org_id", "purchase_order_id"]; isOneToOne: false; referencedRelation: "purchase_orders"; referencedColumns: ["org_id", "id"] },
                    {
      foreignKeyName: "costs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "costs_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"deals": {
                  Row: {
"probability": number,"lost_reason_id": string | null,"won_at": string | null,"lost_at": string | null,"sequence": number,
                    "client_id": string,"created_at": string,"currency": string,"expected_close_date": string | null,"id": string,"next_follow_up_date": string | null,"notes": string | null,"org_id": string,"owner": string | null,"source": string | null,"stage": Database["public"]['Enums']["deal_stage"],"title": string,"updated_at": string,"value_satang": number
                  }
                  ComputedFields: never
                  Insert: {
"probability"?: number,"lost_reason_id"?: string | null,"won_at"?: string | null,"lost_at"?: string | null,"sequence"?: number,
                    "client_id": string,"created_at"?: string,"currency"?: string,"expected_close_date"?: string | null,"id"?: string,"next_follow_up_date"?: string | null,"notes"?: string | null,"org_id": string,"owner"?: string | null,"source"?: string | null,"stage"?: Database["public"]['Enums']["deal_stage"],"title": string,"updated_at"?: string,"value_satang"?: number
                  }
                  Update: {
"probability"?: number,"lost_reason_id"?: string | null,"won_at"?: string | null,"lost_at"?: string | null,"sequence"?: number,
                    "client_id"?: string,"created_at"?: string,"currency"?: string,"expected_close_date"?: string | null,"id"?: string,"next_follow_up_date"?: string | null,"notes"?: string | null,"org_id"?: string,"owner"?: string | null,"source"?: string | null,"stage"?: Database["public"]['Enums']["deal_stage"],"title"?: string,"updated_at"?: string,"value_satang"?: number
                  }
                  Relationships: [
                    { foreignKeyName: "deals_lost_reason_tenant_fkey"; columns: ["org_id", "lost_reason_id"]; isOneToOne: false; referencedRelation: "deal_lost_reasons"; referencedColumns: ["org_id", "id"] },
                    {
      foreignKeyName: "deals_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "deals_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"document_counters": {
                  Row: {
                    "kind": string,"org_id": string,"value": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"org_id": string,"value": number,"year": number
                  }
                  Update: {
                    "kind"?: string,"org_id"?: string,"value"?: number,"year"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_counters_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"integration_receipts": {
                  Row: {
                    "created_at": string,"event_type": string,"id": string,"key": string,"org_id": string,"payload": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_type": string,"id"?: string,"key": string,"org_id": string,"payload": NonNullable<Json>
                  }
                  Update: {
                    "created_at"?: string,"event_type"?: string,"id"?: string,"key"?: string,"org_id"?: string,"payload"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "integration_receipts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invitations": {
                  Row: {
                    "accepted_by": string | null,"created_at": string,"email": string,"expires_at": string | null,"id": string,"invited_by": string | null,"org_id": string,"role": Database["public"]['Enums']["role_enum"],"status": Database["public"]['Enums']["invitation_status"],"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string | null,"id"?: string,"invited_by"?: string | null,"org_id": string,"role"?: Database["public"]['Enums']["role_enum"],"status"?: Database["public"]['Enums']["invitation_status"],"token": string,"updated_at"?: string
                  }
                  Update: {
                    "accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string | null,"id"?: string,"invited_by"?: string | null,"org_id"?: string,"role"?: Database["public"]['Enums']["role_enum"],"status"?: Database["public"]['Enums']["invitation_status"],"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invitations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"invoice_issue_requests": {
                  Row: {
                    "invoice_id": string,"key": string,"org_id": string,"snapshot_id": string | null,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "invoice_id": string,"key": string,"org_id": string,"snapshot_id"?: string | null,"source_version": number
                  }
                  Update: {
                    "invoice_id"?: string,"key"?: string,"org_id"?: string,"snapshot_id"?: string | null,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_issue_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_issue_requests_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoice_issue_requests_org_id_snapshot_id_fkey"
      columns: ["org_id","snapshot_id"]
isOneToOne: false
      referencedRelation: "invoice_snapshots"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invoice_items": {
                  Row: {
"quote_item_id": string | null, "wht_rate_bps": number,

"tax_rate_bps": number,
                    "amount_satang": number,"created_at": string,"description": string,"id": string,"invoice_id": string,"org_id": string,"position": number,"quantity": number,"unit_price_satang": number,"updated_at": string,"product_id": string | null,"unit": string | null
                  }
                  ComputedFields: never
                  Insert: {
"quote_item_id"?: string | null, "wht_rate_bps"?: number,

"tax_rate_bps"?: number,
                    "amount_satang"?: number,"created_at"?: string,"description": string,"id"?: string,"invoice_id": string,"org_id": string,"position"?: number,"quantity"?: number,"unit_price_satang"?: number,"updated_at"?: string,"product_id"?: string | null,"unit"?: string | null
                  }
                  Update: {
"quote_item_id"?: string | null, "wht_rate_bps"?: number,

"tax_rate_bps"?: number,
                    "amount_satang"?: number,"created_at"?: string,"description"?: string,"id"?: string,"invoice_id"?: string,"org_id"?: string,"position"?: number,"quantity"?: number,"unit_price_satang"?: number,"updated_at"?: string,"product_id"?: string | null,"unit"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_items_invoice_tenant_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoice_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_items_product_tenant_fkey"
      columns: ["org_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invoice_snapshots": {
                  Row: {
                    "id": string,"invoice_id": string,"issued_at": string,"issued_by": string,"number": string,"org_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"invoice_id": string,"issued_at"?: string,"issued_by": string,"number": string,"org_id": string,"snapshot": NonNullable<Json>,"source_version": number
                  }
                  Update: {
                    "id"?: string,"invoice_id"?: string,"issued_at"?: string,"issued_by"?: string,"number"?: string,"org_id"?: string,"snapshot"?: NonNullable<Json>,"source_version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_snapshots_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_snapshots_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: true
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"invoices": {
                  Row: {
"source_subscription_id": string | null,
"quote_invoice_kind": string,"quote_invoice_sealed": boolean,"quote_deposit_satang": number,"quote_deposit_deduction_satang": number,"quote_discount_satang": number,

"prices_include_vat": boolean, "wht_rate_bps": number,"subtotal_satang": number,"vat_satang": number,"wht_satang": number,"total_satang": number,"tax_breakdown": Json,
                    "amount_satang": number,"client_id": string,"created_at": string,"discount_satang": number,"due_date": string | null,"id": string,"is_recurring": boolean,"issue_date": string,"issued_snapshot_id": string | null,"notes": string | null,"number": string,"org_id": string,"project_id": string | null,"recurring_interval": Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id": string | null,"source_quote_id": string | null,"status": Database["public"]['Enums']["invoice_status"],"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
"source_subscription_id"?: string | null,
"quote_invoice_kind"?: string,"quote_invoice_sealed"?: boolean,"quote_deposit_satang"?: number,"quote_deposit_deduction_satang"?: number,"quote_discount_satang"?: number,

"prices_include_vat"?: boolean, "wht_rate_bps"?: number,"subtotal_satang"?: number,"vat_satang"?: number,"wht_satang"?: number,"total_satang"?: number,"tax_breakdown"?: Json,
                    "amount_satang"?: number,"client_id": string,"created_at"?: string,"discount_satang"?: number,"due_date"?: string | null,"id"?: string,"is_recurring"?: boolean,"issue_date"?: string,"issued_snapshot_id"?: string | null,"notes"?: string | null,"number": string,"org_id": string,"project_id"?: string | null,"recurring_interval"?: Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string,"version"?: number
                  }
                  Update: {
"source_subscription_id"?: string | null,
"quote_invoice_kind"?: string,"quote_invoice_sealed"?: boolean,"quote_deposit_satang"?: number,"quote_deposit_deduction_satang"?: number,"quote_discount_satang"?: number,

"prices_include_vat"?: boolean, "wht_rate_bps"?: number,"subtotal_satang"?: number,"vat_satang"?: number,"wht_satang"?: number,"total_satang"?: number,"tax_breakdown"?: Json,
                    "amount_satang"?: number,"client_id"?: string,"created_at"?: string,"discount_satang"?: number,"due_date"?: string | null,"id"?: string,"is_recurring"?: boolean,"issue_date"?: string,"issued_snapshot_id"?: string | null,"notes"?: string | null,"number"?: string,"org_id"?: string,"project_id"?: string | null,"recurring_interval"?: Database["public"]['Enums']["recurring_interval"] | null,"source_milestone_id"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_snapshot_tenant"
      columns: ["org_id","issued_snapshot_id"]
isOneToOne: false
      referencedRelation: "invoice_snapshots"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_client_tenant_fkey"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoices_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_source_milestone_tenant"
      columns: ["org_id","source_milestone_id"]
isOneToOne: false
      referencedRelation: "milestones"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "invoices_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"org_id": string,"role": Database["public"]['Enums']["role_enum"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"org_id": string,"role"?: Database["public"]['Enums']["role_enum"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["role_enum"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"milestones": {
                  Row: {
                    "created_at": string,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"project_id": string,"source_quote_id": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"project_id": string,"source_quote_id"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"project_id"?: string,"source_quote_id"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "milestones_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "milestones_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "milestones_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"org_settings": {
                  Row: { require_different_payment_reviewer: boolean;
bill_variance_tolerance_bps: number, "scheduled_replenishment_enabled": boolean,"purchase_approval_threshold_satang": number | null,"over_receipt_tolerance_percent": number,
"wht_rate_bps": number,

"lock_date": string | null,"vat_registered": boolean,"vat_rate_bps": number,"prices_include_vat": boolean,"branch_label": string | null,"tax_invoice_template": Json,
                    "allow_negative_stock": boolean,"business_address": string | null,"cash_balance_satang": number,"created_at": string,"id": string,"legal_name": string | null,"monthly_burn_satang": number | null,"org_id": string,"tax_id": string | null,"tax_status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: { require_different_payment_reviewer?: boolean;
bill_variance_tolerance_bps?: number, "scheduled_replenishment_enabled"?: boolean,"purchase_approval_threshold_satang"?: number | null,"over_receipt_tolerance_percent"?: number,
"wht_rate_bps"?: number,

"lock_date"?: string | null,"vat_registered"?: never,"vat_rate_bps"?: number,"prices_include_vat"?: boolean,"branch_label"?: string | null,"tax_invoice_template"?: Json,
                    "allow_negative_stock"?: boolean,"business_address"?: string | null,"cash_balance_satang"?: number,"created_at"?: string,"id"?: string,"legal_name"?: string | null,"monthly_burn_satang"?: number | null,"org_id": string,"tax_id"?: string | null,"tax_status"?: string,"updated_at"?: string
                  }
                  Update: { require_different_payment_reviewer?: boolean;
bill_variance_tolerance_bps?: number, "scheduled_replenishment_enabled"?: boolean,"purchase_approval_threshold_satang"?: number | null,"over_receipt_tolerance_percent"?: number,
"wht_rate_bps"?: number,

"lock_date"?: string | null,"vat_registered"?: never,"vat_rate_bps"?: number,"prices_include_vat"?: boolean,"branch_label"?: string | null,"tax_invoice_template"?: Json,
                    "allow_negative_stock"?: boolean,"business_address"?: string | null,"cash_balance_satang"?: number,"created_at"?: string,"id"?: string,"legal_name"?: string | null,"monthly_burn_satang"?: number | null,"org_id"?: string,"tax_id"?: string | null,"tax_status"?: string,"updated_at"?: string

                  }
                  Relationships: [
                    {
      foreignKeyName: "org_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"outbound_events": {
                  Row: {
                    "attempts": number,"created_at": string,"delivered_at": string | null,"event_type": string,"id": string,"last_error": string | null,"lease_expires_at": string | null,"lease_token": string | null,"next_attempt_at": string,"org_id": string,"payload": NonNullable<Json>,"reminder_id": string | null,"status": Database["public"]['Enums']["outbound_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"delivered_at"?: string | null,"event_type": string,"id"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"org_id": string,"payload"?: NonNullable<Json>,"reminder_id"?: string | null,"status"?: Database["public"]['Enums']["outbound_status"]
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"delivered_at"?: string | null,"event_type"?: string,"id"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_token"?: string | null,"next_attempt_at"?: string,"org_id"?: string,"payload"?: NonNullable<Json>,"reminder_id"?: string | null,"status"?: Database["public"]['Enums']["outbound_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbound_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbound_reminder_tenant"
      columns: ["org_id","reminder_id"]
isOneToOne: false
      referencedRelation: "reminders"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_allocations": {
                  Row: {
                    "amount_satang": number,"created_at": string,"id": string,"invoice_id": string,"org_id": string,"payment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"created_at"?: string,"id"?: string,"invoice_id": string,"org_id": string,"payment_id": string
                  }
                  Update: {
                    "amount_satang"?: number,"created_at"?: string,"id"?: string,"invoice_id"?: string,"org_id"?: string,"payment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_allocations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_allocations_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_allocations_org_id_payment_id_fkey"
      columns: ["org_id","payment_id"]
isOneToOne: true
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_claims": {
                  Row: { requested_allocations: Json;
                    "amount_satang": number,"client_id": string,"created_at": string,"id": string,"idempotency_key": string,"invoice_id": string | null,"org_id": string,"payment_id": string | null,"reference": string,"review_reference": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"source": string,"status": string,"submitted_by": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_satang": number,"client_id": string,"created_at"?: string,"id"?: string,"idempotency_key": string,"invoice_id": string | null,"org_id": string,"payment_id"?: string | null,"reference": string,"review_reference"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount_satang"?: number,"client_id"?: string,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"invoice_id"?: string,"org_id"?: string,"payment_id"?: string | null,"reference"?: string,"review_reference"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"source"?: string,"status"?: string,"submitted_by"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_claims_org_id_client_id_fkey"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_claims_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_claims_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payment_claims_org_id_payment_id_fkey"
      columns: ["org_id","payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"payment_command_results": {
                  Row: {
                    "created_at": string,"key": string,"org_id": string,"request": NonNullable<Json>,"result": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"org_id": string,"request": NonNullable<Json>,"result"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"org_id"?: string,"request"?: NonNullable<Json>,"result"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_command_results_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: { client_id: string; reversal_of: string | null; refund_of: string | null;
                    "amount_satang": number,"command_key": string | null,"created_at": string,"id": string,"invoice_id": string | null,"method": Database["public"]['Enums']["payment_method"],"notes": string | null,"org_id": string,"paid_at": string,"reconciled_payment_id": string | null,"updated_at": string,"verification_reference": string | null,"verification_state": string,"verified_by": string | null
                  }
                  ComputedFields: never
                  Insert: { client_id?: string; reversal_of?: string | null; refund_of?: string | null;
                    "amount_satang": number,"command_key"?: string | null,"created_at"?: string,"id"?: string,"invoice_id": string | null,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"org_id": string,"paid_at"?: string,"reconciled_payment_id"?: string | null,"updated_at"?: string,"verification_reference"?: string | null,"verification_state"?: string,"verified_by"?: string | null
                  }
                  Update: { client_id?: string; reversal_of?: string | null; refund_of?: string | null;
                    "amount_satang"?: number,"command_key"?: string | null,"created_at"?: string,"id"?: string,"invoice_id"?: string,"method"?: Database["public"]['Enums']["payment_method"],"notes"?: string | null,"org_id"?: string,"paid_at"?: string,"reconciled_payment_id"?: string | null,"updated_at"?: string,"verification_reference"?: string | null,"verification_state"?: string,"verified_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_invoice_tenant_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "payments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_reconciled_tenant"
      columns: ["org_id","reconciled_payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"portal_claim_requests": {
                  Row: {
                    "created_at": string,"key": string,"org_id": string,"request": NonNullable<Json>,"result": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"org_id": string,"request": NonNullable<Json>,"result"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"org_id"?: string,"request"?: NonNullable<Json>,"result"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_claim_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "portal_claim_requests_org_id_result_fkey"
      columns: ["org_id","result"]
isOneToOne: false
      referencedRelation: "payment_claims"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"full_name": string | null,"id": string,"locale": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id": string,"locale"?: string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id"?: string,"locale"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"project_tasks": {
                  Row: {
                    "assignee": string | null,"created_at": string,"done": boolean,"due_date": string | null,"id": string,"org_id": string,"project_id": string,"status": Database["public"]['Enums']["task_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee"?: string | null,"created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id": string,"project_id": string,"status"?: Database["public"]['Enums']["task_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "assignee"?: string | null,"created_at"?: string,"done"?: boolean,"due_date"?: string | null,"id"?: string,"org_id"?: string,"project_id"?: string,"status"?: Database["public"]['Enums']["task_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_tasks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "project_tasks_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "budget_satang": number | null,"client_id": string | null,"created_at": string,"deadline": string | null,"deal_id": string | null,"id": string,"name": string,"org_id": string,"owner": string | null,"source_quote_id": string | null,"status": Database["public"]['Enums']["project_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "budget_satang"?: number | null,"client_id"?: string | null,"created_at"?: string,"deadline"?: string | null,"deal_id"?: string | null,"id"?: string,"name": string,"org_id": string,"owner"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Update: {
                    "budget_satang"?: number | null,"client_id"?: string | null,"created_at"?: string,"deadline"?: string | null,"deal_id"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"owner"?: string | null,"source_quote_id"?: string | null,"status"?: Database["public"]['Enums']["project_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "projects_deal_id_fkey_tenant"
      columns: ["org_id","deal_id"]
isOneToOne: false
      referencedRelation: "deals"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "projects_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "projects_source_quote_tenant"
      columns: ["org_id","source_quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quote_conversion_requests": {
                  Row: {
                    "created_at": string,"invoice_id": string | null,"key": string,"org_id": string,"quote_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invoice_id"?: string | null,"key": string,"org_id": string,"quote_id": string
                  }
                  Update: {
                    "created_at"?: string,"invoice_id"?: string | null,"key"?: string,"org_id"?: string,"quote_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_conversion_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_conversion_requests_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quote_conversion_requests_org_id_quote_id_fkey"
      columns: ["org_id","quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quote_items": {
                  Row: {
"invoiced_quantity": number,

"tax_rate_bps": number,
                    "amount_satang": number,"created_at": string,"description": string,"id": string,"org_id": string,"position": number,"quantity": number,"quote_id": string,"unit_price_satang": number,"updated_at": string,"product_id": string | null,"unit": string | null
                  }
                  ComputedFields: never
                  Insert: {
"invoiced_quantity"?: number,

"tax_rate_bps"?: number,
                    "amount_satang"?: number,"created_at"?: string,"description": string,"id"?: string,"org_id": string,"position"?: number,"quantity"?: number,"quote_id": string,"unit_price_satang"?: number,"updated_at"?: string,"product_id"?: string | null,"unit"?: string | null
                  }
                  Update: {
"invoiced_quantity"?: number,

"tax_rate_bps"?: number,
                    "amount_satang"?: number,"created_at"?: string,"description"?: string,"id"?: string,"org_id"?: string,"position"?: number,"quantity"?: number,"quote_id"?: string,"unit_price_satang"?: number,"updated_at"?: string,"product_id"?: string | null,"unit"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "quote_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quote_items_quote_id_fkey_tenant"
      columns: ["org_id","quote_id"]
isOneToOne: false
      referencedRelation: "quotes"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quote_items_product_tenant_fkey"
      columns: ["org_id","product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"quotes": {
                  Row: {
"deal_id": string | null,
"accepted_at": string | null,"accepted_by_name": string | null,"accepted_by_email": string | null,

"prices_include_vat": boolean,"vat_satang": number,"tax_breakdown": Json,
                    "client_id": string,"converted_invoice_id": string | null,"created_at": string,"discount_satang": number,"id": string,"issue_date": string,"notes": string | null,"number": string,"org_id": string,"owner": string | null,"project_id": string | null,"status": Database["public"]['Enums']["quote_status"],"subtotal_satang": number,"total_satang": number,"updated_at": string,"valid_until": string | null
                  }
                  ComputedFields: never
                  Insert: {
"deal_id"?: string | null,
"accepted_at"?: string | null,"accepted_by_name"?: string | null,"accepted_by_email"?: string | null,

"prices_include_vat"?: boolean,"vat_satang"?: number,"tax_breakdown"?: Json,
                    "client_id": string,"converted_invoice_id"?: string | null,"created_at"?: string,"discount_satang"?: number,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number": string,"org_id": string,"owner"?: string | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"subtotal_satang"?: number,"total_satang"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Update: {
"deal_id"?: string | null,
"accepted_at"?: string | null,"accepted_by_name"?: string | null,"accepted_by_email"?: string | null,

"prices_include_vat"?: boolean,"vat_satang"?: number,"tax_breakdown"?: Json,
                    "client_id"?: string,"converted_invoice_id"?: string | null,"created_at"?: string,"discount_satang"?: number,"id"?: string,"issue_date"?: string,"notes"?: string | null,"number"?: string,"org_id"?: string,"owner"?: string | null,"project_id"?: string | null,"status"?: Database["public"]['Enums']["quote_status"],"subtotal_satang"?: number,"total_satang"?: number,"updated_at"?: string,"valid_until"?: string | null
                  }
                  Relationships: [
                    { foreignKeyName: "quotes_deal_client_fkey"; columns: ["org_id", "deal_id", "client_id"]; isOneToOne: false; referencedRelation: "deals"; referencedColumns: ["org_id", "id", "client_id"] },
                    {
      foreignKeyName: "quotes_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quotes_converted_invoice_tenant"
      columns: ["org_id","converted_invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "quotes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "quotes_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"reminders": {
                  Row: {
                    "channel": Database["public"]['Enums']["reminder_channel"],"created_at": string,"due_date": string,"entity": string,"entity_id": string | null,"id": string,"meta": NonNullable<Json>,"org_id": string,"sent_at": string | null,"status": Database["public"]['Enums']["reminder_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"created_at"?: string,"due_date": string,"entity": string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id": string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"created_at"?: string,"due_date"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"meta"?: NonNullable<Json>,"org_id"?: string,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["reminder_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminders_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_views": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"module": string,"name": string,"org_id": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"module": string,"name": string,"org_id": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"module"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_views_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"subscription_occurrences": {
                  Row: {
                    "created_at": string,"invoice_id": string,"occurrence_date": string,"org_id": string,"subscription_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"invoice_id": string,"occurrence_date": string,"org_id": string,"subscription_id": string
                  }
                  Update: {
                    "created_at"?: string,"invoice_id"?: string,"occurrence_date"?: string,"org_id"?: string,"subscription_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscription_occurrences_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscription_occurrences_org_id_invoice_id_fkey"
      columns: ["org_id","invoice_id"]
isOneToOne: true
      referencedRelation: "invoices"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "subscription_occurrences_org_id_subscription_id_fkey"
      columns: ["org_id","subscription_id"]
isOneToOne: false
      referencedRelation: "subscriptions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"subscriptions": {
                  Row: {
"tax_rate_bps": number, "wht_rate_bps": number,"prices_include_vat": boolean,"product_id": string | null,"unit": string | null,

                    "amount_satang": number,"auto_generate": boolean,"client_id": string,"created_at": string,"id": string,"interval": Database["public"]['Enums']["recurring_interval"],"last_generated_on": string | null,"name": string,"next_run_date": string,"notes": string | null,"org_id": string,"project_id": string | null,"start_date": string,"status": Database["public"]['Enums']["subscription_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
"tax_rate_bps"?: number, "wht_rate_bps"?: number,"prices_include_vat"?: boolean,"product_id"?: string | null,"unit"?: string | null,

                    "amount_satang"?: number,"auto_generate"?: boolean,"client_id": string,"created_at"?: string,"id"?: string,"interval"?: Database["public"]['Enums']["recurring_interval"],"last_generated_on"?: string | null,"name": string,"next_run_date"?: string,"notes"?: string | null,"org_id": string,"project_id"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Update: {
"tax_rate_bps"?: number, "wht_rate_bps"?: number,"prices_include_vat"?: boolean,"product_id"?: string | null,"unit"?: string | null,

                    "amount_satang"?: number,"auto_generate"?: boolean,"client_id"?: string,"created_at"?: string,"id"?: string,"interval"?: Database["public"]['Enums']["recurring_interval"],"last_generated_on"?: string | null,"name"?: string,"next_run_date"?: string,"notes"?: string | null,"org_id"?: string,"project_id"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["subscription_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "subscriptions_client_id_fkey_tenant"
      columns: ["org_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "subscriptions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "subscriptions_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"template_categories": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "template_categories_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"time_billing_requests": {
                  Row: { org_id: string; key: string; project_id: string; invoice_id: string | null }
                  Insert: { org_id: string; key: string; project_id: string; invoice_id?: string | null }
                  Update: { org_id?: string; key?: string; project_id?: string; invoice_id?: string | null }
                  Relationships: []
                },"time_entries": {
                  Row: {
                    "invoice_id": string | null,"invoice_item_id": string | null,
                    "billable": boolean,"created_at": string,"id": string,"minutes": number,"notes": string | null,"org_id": string,"project_id": string,"rate_satang": number | null,"task_id": string | null,"updated_at": string,"user_id": string | null,"work_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "invoice_id"?: string | null,"invoice_item_id"?: string | null,
                    "billable"?: boolean,"created_at"?: string,"id"?: string,"minutes": number,"notes"?: string | null,"org_id": string,"project_id": string,"rate_satang"?: number | null,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"work_date"?: string
                  }
                  Update: {
                    "invoice_id"?: string | null,"invoice_item_id"?: string | null,
                    "billable"?: boolean,"created_at"?: string,"id"?: string,"minutes"?: number,"notes"?: string | null,"org_id"?: string,"project_id"?: string,"rate_satang"?: number | null,"task_id"?: string | null,"updated_at"?: string,"user_id"?: string | null,"work_date"?: string
                  }
                  Relationships: [
                    { foreignKeyName: "time_entries_invoice_item_tenant_fkey"; columns: ["org_id", "invoice_item_id"]; isOneToOne: false; referencedRelation: "invoice_items"; referencedColumns: ["org_id", "id"] },

                    { foreignKeyName: "time_entries_invoice_tenant_fkey"; columns: ["org_id", "invoice_id"]; isOneToOne: false; referencedRelation: "invoices"; referencedColumns: ["org_id", "id"] },

                    {
      foreignKeyName: "time_entries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "time_entries_project_id_fkey_tenant"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "time_entries_task_id_fkey_tenant"
      columns: ["org_id","task_id"]
isOneToOne: false
      referencedRelation: "project_tasks"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"workspace_requests": {
                  Row: {
                    "created_at": string,"key": string,"name": string,"org_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string,"name": string,"org_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"key"?: string,"name"?: string,"org_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },
            "products": {
              Row: {
"wht_rate_bps": number | null,

                id: string; org_id: string; sku: string | null; name: string; description: string | null;
                type: "service" | "goods"; unit: string; list_price_satang: number; cost_satang: number;
                reorder_min: number; reorder_qty: number; default_vendor_id: string | null; tax_rate_bps: number; is_stockable: boolean; active: boolean; created_at: string; updated_at: string;
              }
              Insert: {
"wht_rate_bps"?: number | null,

                id?: string; org_id: string; sku?: string | null; name: string; description?: string | null;
                type?: "service" | "goods"; unit?: string; list_price_satang?: number; cost_satang?: number;
                reorder_min?: number; reorder_qty?: number; default_vendor_id?: string | null; tax_rate_bps?: number; is_stockable?: boolean; active?: boolean; created_at?: string; updated_at?: string;
              }
              Update: {
"wht_rate_bps"?: number | null,

                id?: string; org_id?: string; sku?: string | null; name?: string; description?: string | null;
                type?: "service" | "goods"; unit?: string; list_price_satang?: number; cost_satang?: number;
                reorder_min?: number; reorder_qty?: number; default_vendor_id?: string | null; tax_rate_bps?: number; is_stockable?: boolean; active?: boolean; created_at?: string; updated_at?: string;
              }
              ComputedFields: never
              Relationships: [{
                foreignKeyName: "products_org_id_fkey"
                columns: ["org_id"]
                isOneToOne: false
                referencedRelation: "organizations"
                referencedColumns: ["id"]
              }]
            }

      record_notes: {
        Row: { id: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; author: string; body: string; created_at: string }
        Insert: { id?: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; author: string; body: string; created_at?: string }
        Update: { id?: string; org_id?: string; record_type?: Database["public"]["Enums"]["record_type"]; record_id?: string; author?: string; body?: string; created_at?: string }
        Relationships: []
      }

      record_attachments: {
        Row: { id: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; path: string; filename: string; size: number; content_type: string; uploaded_by: string; created_at: string }
        Insert: { id?: string; org_id: string; record_type: Database["public"]["Enums"]["record_type"]; record_id: string; path: string; filename: string; size: number; content_type: string; uploaded_by: string; created_at?: string }
        Update: { id?: string; org_id?: string; record_type?: Database["public"]["Enums"]["record_type"]; record_id?: string; path?: string; filename?: string; size?: number; content_type?: string; uploaded_by?: string; created_at?: string }
        Relationships: []
      }
}
          Views: {
            invoice_stock_lines: {
              Row: Database["public"]["Tables"]["invoice_items"]["Row"] & { delivered_quantity: number; returned_quantity: number; is_stockable: boolean }
              Relationships: []
            }
            inventory_forecast: {
              Row: { org_id: string; product_id: string; on_order: number; reserved_quantity: number }
              Relationships: []
            }
            monthly_purchase_vat: {
              Row: { org_id: string; month: string; base_satang: number; input_vat_satang: number; total_satang: number }
              Relationships: []
            }
            monthly_inventory_cogs: {
              Row: { org_id: string; month: string; amount_satang: number }
              Relationships: []
            }
            stock_on_hand: {
              Row: { org_id: string; product_id: string; warehouse_id: string; quantity: number; average_cost_satang: number; value_satang: number }
              Relationships: []
            }
            inventory_totals: {
              Row: { org_id: string; product_id: string; quantity: number; value_satang: number }
              Relationships: []
            }
            deal_next_activity: {
              Row: { org_id: string | null; deal_id: string | null; next_due_date: string | null; open_count: number | null }
              Relationships: []
            }
            credit_note_revenue: {
              Row: { org_id: string; id: string; invoice_id: string; issue_date: string; project_id: string | null; client_id: string; client_name: string; base_satang: number; total_satang: number }
              Relationships: []
            }
            customer_receipt_balances: {
              Row: { org_id: string; payment_id: string; client_id: string; amount_satang: number; paid_at: string; available_satang: number }
              Relationships: []
            }
            invoice_receipts: {
              Row: { org_id: string; invoice_id: string; id: string; client_id: string; amount_satang: number; receipt_amount_satang: number; paid_at: string; method: Database["public"]["Enums"]["payment_method"]; notes: string | null; verification_state: string; verification_reference: string | null; reconciled_payment_id: string | null; reversal_of: string | null }
              Relationships: []
            }
            "client_balances": {
              Row: { credit_satang: number | null;
                "client_id": string | null,"invoiced_satang": number | null,"org_id": string | null,"outstanding_satang": number | null,"paid_satang": number | null
              }
              Relationships: []
            }
            "invoice_balances": {
              Row: { credited_satang: number | null; collectible_satang: number | null;
                "amount_satang": number | null,"client_id": string | null,"invoice_id": string | null,"org_id": string | null,"outstanding_satang": number | null,"paid_satang": number | null,"status": Database["public"]["Enums"]["invoice_status"] | null
              }
              Relationships: []
            }
            "project_labour_totals": {
              Row: { org_id: string | null; project_id: string | null; labour_cost_satang: number | null }
              Relationships: []
            }
            "project_time_totals": {
              Row: {
                "minutes": number | null,"org_id": string | null,"project_id": string | null
              }
              Relationships: []
            }
          }
          Functions: {
"cancel_quote_invoice": { Args: { p_org_id: string; p_invoice_id: string }; Returns: undefined },
"save_document_lines": { Args: { p_document: "quote" | "invoice" | "purchase_order"; p_document_id: string; p_rows: Json; p_deleted: string[] }; Returns: undefined },
"reserve_document_number": { Args: { p_org_id: string; p_kind: string; p_year: number }; Returns: string },
"accept_portal_quote": { Args: { p_token: string; p_quote_id: string; p_name: string; p_email: string }; Returns: string },
"update_subscription_schedule": { Args: { p_org_id: string; p_subscription_id: string; p_start_date?: string | null; p_status?: Database["public"]["Enums"]["subscription_status"] | null; p_bill_missed_periods?: boolean; p_changes?: Json }; Returns: undefined },
            reopen_purchase_rfq: { Args: { p_org_id: string; p_order_id: string; p_delivery_key: string; p_verified_not_delivered: boolean }; Returns: undefined }
      update_purchase_order: { Args: { p_org_id: string; p_order_id: string; p_vendor_id: string; p_order_date: string; p_expected_date: string | null; p_notes: string | null }; Returns: undefined }
      save_reorder_rule: { Args: { p_org_id: string; p_product_id: string; p_vendor_id: string | null; p_min: number; p_quantity: number; p_lead_days: number }; Returns: undefined }
      replenishment_plan: { Args: { p_org_id: string; p_date?: string }; Returns: { product_id: string; vendor_id: string; product_name: string; unit: string; order_quantity: number; unit_cost_satang: number; lead_days: number; expected_date: string }[] }
      approve_purchase_order: { Args: { p_org_id: string; p_order_id: string }; Returns: undefined }
      transfer_stock: { Args: { p_org_id: string; p_product_id: string; p_from_warehouse_id: string; p_to_warehouse_id: string; p_quantity: number; p_reason: string; p_key: string }; Returns: string }
      stock_moves_page: {
        Args: { p_org_id: string; p_before?: number; p_kinds?: string[]; p_warehouse_id?: string; p_product_id?: string; p_source_id?: string; p_actor_id?: string; p_start?: string; p_end?: string; p_query?: string }
        Returns: Database["public"]["Tables"]["stock_moves"]["Row"][]
      }
      inventory_snapshot: { Args: { p_org_id: string; p_warehouse_id?: string; p_product_id?: string }; Returns: Json }
            save_warehouse: { Args: { p_org_id: string; p_id: string | null; p_code: string; p_name: string; p_address: string | null; p_default: boolean; p_active: boolean }; Returns: string }
            delete_warehouse: { Args: { p_org_id: string; p_id: string }; Returns: undefined }
            deliver_invoice: { Args: { p_org_id: string; p_invoice_id: string; p_warehouse_id?: string; p_lines?: Json; p_date?: string }; Returns: undefined }
            adjust_stock: { Args: { p_org_id: string; p_product_id: string; p_warehouse_id: string; p_count: number; p_reason: string; p_key: string; p_unit_cost_satang?: number | null }; Returns: string | null }
            return_purchase_order: { Args: { p_org_id: string; p_order_id: string; p_lines: Json; p_warehouse_id?: string; p_date?: string }; Returns: undefined }
            return_invoice_delivery: { Args: { p_org_id: string; p_invoice_id: string; p_move_id: string; p_returned_quantity: number }; Returns: undefined }
            create_replenishment_rfq: { Args: { p_org_id: string; p_vendor_id: string }; Returns: string }
            "bill_project_time": { Args: { p_org_id: string; p_project_id: string; p_key: string }; Returns: string }
            "set_member_cost_rate": { Args: { p_org_id: string; p_user_id: string; p_rate_satang: number }; Returns: undefined }


            "accept_integration_event":
{ Args: { "p_event_type": string,"p_key": string,"p_org_id": string,"p_payload": Json }; Returns: Json
                           },
"accept_workspace_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"claim_outbound_events":
{ Args: { "p_lease_seconds": number,"p_limit": number }; Returns: Json
                           },
"convert_accepted_quote":
{ Args: { "p_key": string,"p_org_id": string,"p_quote_id": string,"p_lines"?: Json,"p_deposit_satang"?: number,"p_deposit_bps"?: number }; Returns: string
                           },
"enqueue_reminders":
{ Args: { "p_org_id": string,"p_specs": Json }; Returns: Json
                           },
"finish_outbound_event":
{ Args: { "p_error"?: string,"p_event_id": string,"p_lease_token": string }; Returns: boolean
                           },
"move_deal":
{ Args: { "p_org_id": string,"p_deal_id": string,"p_stage": Database["public"]['Enums']["deal_stage"],"p_after_id"?: string | null,"p_lost_reason_id"?: string | null,"p_note"?: string | null }; Returns: Database["public"]['Enums']["deal_stage"]
                           },
"delete_deal":
{ Args: { "p_org_id": string,"p_deal_id": string }; Returns: string
                           },
"generate_subscription_occurrence":
{ Args: { "p_occurrence": string,"p_org_id": string,"p_subscription_id": string }; Returns: string
                           },
"issue_invoice":
{ Args: { "p_expected_version": number,"p_invoice_id": string,"p_key": string,"p_org_id": string }; Returns: string
                           },
"adopt_legacy_invoice":
{ Args: { "p_expected_version": number,"p_invoice_id": string,"p_key": string,"p_org_id": string,"p_reason": string }; Returns: string
                           },
"provision_hosted_workspace":
{ Args: { "p_key": string,"p_name": string }; Returns: string
                           },
"provision_workspace":
{ Args: { "p_key": string,"p_name": string }; Returns: string
                           },
"reconcile_legacy_payment_with_evidence":
{ Args: { "p_amount_satang": number,"p_key": string,"p_legacy_payment_id": string,"p_method": Database["public"]['Enums']["payment_method"],"p_org_id": string,"p_paid_on": string,"p_reference": string }; Returns: string
                           },
"review_payment_claim_with_evidence":
{ Args: { "p_amount_satang": number,"p_claim_id": string,"p_decision": string,"p_key": string,"p_method": Database["public"]['Enums']["payment_method"] | null,"p_org_id": string,"p_paid_on": string | null,"p_reference": string }; Returns: string
                           },
"submit_internal_payment_claim":
{ Args: { "p_amount_satang": number,"p_invoice_id": string,"p_key": string,"p_org_id": string,"p_reference": string }; Returns: string
                           },
"submit_payment_claim":
{ Args: { "p_amount_satang": number,"p_invoice_id": string,"p_key": string,"p_reference": string,"p_token": string }; Returns: string
                           },
"update_business_profile":
{ Args: { "p_business_address": string,"p_legal_name": string,"p_org_id": string,"p_tax_id": string,"p_tax_status": string }; Returns: undefined
                           }
            cancel_draft_invoice: { Args: { p_org_id: string; p_invoice_id: string }; Returns: undefined }
            update_finance_lock_date: { Args: { p_org_id: string; p_lock_date: string | null }; Returns: undefined }
            install_thai_sme_chart: { Args: { p_org_id: string }; Returns: undefined }
            add_bank_line: { Args: { p_org_id: string; p_booked_on: string; p_amount_satang: number; p_reference: string }; Returns: string }
            match_bank_line: { Args: { p_org_id: string; p_line_id: string; p_payment_id: string }; Returns: undefined }
            submit_customer_payment_claim: { Args: { p_org_id: string; p_client_id: string; p_amount_satang: number; p_allocations: Json; p_reference: string; p_key: string }; Returns: string }
            apply_customer_credit: { Args: { p_org_id: string; p_client_id: string; p_allocations: Json; p_key: string }; Returns: string }
            refund_customer_credit: { Args: { p_org_id: string; p_payment_id: string; p_amount_satang: number; p_reference: string; p_paid_on: string; p_method: Database["public"]["Enums"]["payment_method"]; p_key: string }; Returns: string }
            update_payment_review_policy: { Args: { p_org_id: string; p_required: boolean }; Returns: undefined }
            reverse_payment: { Args: { p_org_id: string; p_payment_id: string; p_reason: string; p_reversed_on: string; p_key: string }; Returns: string }
            issue_credit_note: { Args: { p_org_id: string; p_invoice_id: string; p_lines: Json; p_reason: string; p_key: string }; Returns: string }
            update_tax_business_profile: { Args: { p_org_id: string; p_legal_name: string; p_business_address: string; p_tax_id: string; p_tax_status: string; p_vat_rate_bps: number; p_prices_include_vat: boolean; p_branch_label: string }; Returns: undefined }
            save_tax_invoice_template: { Args: { p_org_id: string; p_template: Json }; Returns: undefined }
            claim_purchase_rfq: { Args: { p_org_id: string; p_order_id: string }; Returns: Json }
            finish_purchase_rfq: { Args: { p_org_id: string; p_order_id: string; p_delivery_key: string; p_error?: string | null }; Returns: undefined }
            create_purchase_order: { Args: { p_org_id: string; p_vendor_id: string; p_order_date: string; p_expected_date?: string | null; p_notes?: string | null }; Returns: string }
            transition_purchase_order: { Args: { p_org_id: string; p_order_id: string; p_status: Database["public"]["Enums"]["purchase_status"] }; Returns: undefined }
            receive_purchase_order: { Args: { p_org_id: string; p_order_id: string; p_lines: Json; p_warehouse_id?: string; p_date?: string }; Returns: undefined }
            bill_purchase_order: { Args: { p_org_id: string; p_order_id: string; p_bill: Json }; Returns: string }
            link_vendor_credit: { Args: { p_org_id: string; p_cost_id: string; p_bill: Json }; Returns: string }
            create_expense_claim: { Args: { p_org_id: string; p_title: string }; Returns: string }
            transition_expense_claim: { Args: { p_org_id: string; p_claim_id: string; p_status: Database["public"]["Enums"]["expense_status"]; p_note?: string | null }; Returns: undefined }
            record_activity_assignees: { Args: { p_org_id: string }; Returns: { user_id: string; full_name: string | null }[] }
            take_search_slot: { Args: Record<PropertyKey, never>; Returns: boolean }
          }
          Enums: {
            "accounting_conn_status": "disconnected"|"connected"|"error","accounting_provider": "flowaccount"|"peak"|"xero","accounting_sync_status": "pending"|"synced"|"error","activity_type": "note"|"call"|"email"|"meeting"|"follow_up","ai_output_kind": "deal_summary"|"followup_draft"|"meeting_intake","cost_category": "software"|"contractor"|"infra"|"marketing"|"salary"|"other"|"inventory","deal_stage": "lead"|"contacted"|"discovery"|"proposal"|"negotiation"|"won"|"lost","invitation_status": "pending"|"accepted"|"revoked"|"expired","invoice_status": "draft"|"sent"|"partially_paid"|"paid"|"overdue"|"cancelled","outbound_status": "queued"|"delivered"|"failed","payment_method": "transfer"|"cash"|"card"|"promptpay"|"cheque"|"other","project_status": "not_started"|"in_progress"|"review"|"delivered"|"support"|"paused"|"cancelled","quote_status": "draft"|"sent"|"accepted"|"declined"|"expired"|"converted","recurring_interval": "weekly"|"monthly"|"quarterly"|"yearly","reminder_channel": "line"|"email"|"inapp","reminder_status": "pending"|"sent"|"cancelled","role_enum": "owner"|"admin"|"accountant"|"member","subscription_status": "active"|"paused"|"cancelled","task_status": "todo"|"in_progress"|"done"
      stock_move_kind: "receipt" | "delivery" | "adjustment_in" | "adjustment_out" | "transfer_in" | "transfer_out" | "vendor_return" | "customer_return"
      purchase_status: "draft" | "sent" | "confirmed" | "received" | "billed" | "cancelled" | "closed"
      expense_status: "draft" | "submitted" | "approved" | "rejected" | "paid"
      record_type: "client" | "deal" | "quote" | "invoice" | "project" | "subscription" | "vendor" | "purchase_order" | "expense_claim"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {

          }
        },"public": {
          Enums: {
            "accounting_conn_status": ["disconnected", "connected", "error"],"accounting_provider": ["flowaccount", "peak", "xero"],"accounting_sync_status": ["pending", "synced", "error"],"activity_type": ["note", "call", "email", "meeting", "follow_up"],"ai_output_kind": ["deal_summary", "followup_draft", "meeting_intake"],"cost_category": ["software", "contractor", "infra", "marketing", "salary", "other", "inventory"],"deal_stage": ["lead", "contacted", "discovery", "proposal", "negotiation", "won", "lost"],"invitation_status": ["pending", "accepted", "revoked", "expired"],"invoice_status": ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],"outbound_status": ["queued", "delivered", "failed"],"payment_method": ["transfer", "cash", "card", "promptpay", "cheque", "other"],"project_status": ["not_started", "in_progress", "review", "delivered", "support", "paused", "cancelled"],"quote_status": ["draft", "sent", "accepted", "declined", "expired", "converted"],"recurring_interval": ["weekly", "monthly", "quarterly", "yearly"],"reminder_channel": ["line", "email", "inapp"],"reminder_status": ["pending", "sent", "cancelled"],"role_enum": ["owner", "admin", "accountant", "member"],"subscription_status": ["active", "paused", "cancelled"],"task_status": ["todo", "in_progress", "done"],
            stock_move_kind: ["receipt", "delivery", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out", "vendor_return", "customer_return"],
            purchase_status: ["draft", "sent", "confirmed", "received", "billed", "cancelled", "closed"],
            expense_status: ["draft", "submitted", "approved", "rejected", "paid"],
            record_type: ["client", "deal", "quote", "invoice", "project", "subscription", "vendor", "purchase_order", "expense_claim"]
          }
        }
} as const

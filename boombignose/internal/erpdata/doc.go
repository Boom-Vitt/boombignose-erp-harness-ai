// Package erpdata ports the application read tools without an MCP process,
// Supabase development CLI, service credential, provider, or additional backend.
//
// Construct one Reader with New(Options{Store: authenticatedStore, Documents:
// nativeDocumentReader}). Now is optional. Store is mandatory. The Reader
// implements erpwire.ToolRunner; pass the verified current-workspace Actor to
// both Specs and every Call. No request argument selects organization, role,
// SQL, arbitrary relations, secret fields, filesystem paths, or remote URLs.
// list_workspaces deliberately describes only that Actor's current workspace.
//
// The embedded catalog is the fixed source projection from
// lib/mcp/reader-catalog.mjs (80 classifications, 71 business-readable and nine
// explicit internal exclusions). Capabilities are the shared erpwire policy,
// not inferred write permissions. Saved views add an actor-owned predicate and
// sanitize ViewConfig identically for row previews and complete text reads.
// Expense parent privacy depends on the existing expense_claims_read and
// expense_lines_read RLS policies in migration 20261024130000_expenses.sql.
// Every actual selection uses the authenticated ReadStore transaction.
//
// Required existing SECURITY INVOKER SQL RPCs are:
//
//   - assistant_invoice_snapshot(p_org_id, p_status, p_client_id, p_limit,
//     p_offset, p_as_of), including migration 20261107090000's independent
//     workspace receivables_coverage. Filtered summary and workspace coverage
//     must never be substituted for each other or derived from returned rows.
//   - assistant_finance_snapshot(p_org_id, p_as_of), migration
//     20261106100000_assistant_financial_snapshot.sql.
//   - assistant_workspace_profiles(p_org_id), migration104 /
//     20261107100000_assistant_workspace_profiles.sql. Reading profiles directly
//     is not equivalent: shares_org can include a different workspace.
//   - list_finance_lock_reopen_requests(p_org_id), the authorized pending-only
//     request projection; do not substitute a direct internal-table read.
//
// These names/arguments must be allowlisted by the Store. SQL is never supplied
// by this package. Missing RPCs and count/source failures are returned as errors,
// not empty success. Profiles and pending requests intentionally materialize the
// complete authorized RPC array before exact local filtering/count/pagination,
// matching the source semantics without a hidden cap. Very large organizations
// may require a parent-owned server-side projection/count RPC enhancement; do
// not add a page cap that silently changes totals or profile membership scope.
//
// Business row responses bound complete rows to 16 and approximately 14 KB,
// preserving exact counts, has_more and next_offset. An individually oversized
// row is an explicit error advising fewer fields/full-text access; no business
// string is silently clipped. Generic long fields have full-source SHA256 and
// code-point continuation pointers. Text ranges are at most 2048 Unicode code
// points and carry full-source and exact-slice hashes. Continuations reject a
// changed expected_sha256. Null sources remain null, not invented empty text.
//
// Retained attachment content requires Documents. The package advertises its
// absence honestly and never infers byte authorization or extractor support
// from declared MIME or extension. DocumentReader must reauthorize attachment
// and parent on EVERY call, validate native immutable bytes and original hash,
// and retain OCR model/warnings/partial state. There is no filesystem or network
// attachment fallback here, including no guessed PDF support.
//
// Catalog metadata produces MetadataOnly and no evidence. All other evidence
// owns local fact keys and leaves Source.ID empty for the assistant's shared
// source allocator. Invoice coverage and required references use those same
// local keys. ReadText contains only actually retrieved contiguous text, never
// a preview, unread tail or regenerated narrative. Runtime-secret redaction,
// when performed by the parent assistant, must rehash visible bytes and preserve
// original-slice provenance and partial/redacted warnings; this package neither
// inspects environment secrets nor claims redaction it did not perform.
package erpdata

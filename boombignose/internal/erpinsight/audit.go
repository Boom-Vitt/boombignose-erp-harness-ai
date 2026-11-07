package erpinsight

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

func (s *Service) auditOperations() map[string]erpwire.Operation {
	return map[string]erpwire.Operation{
		"app/(app)/audit/page.tsx::load":                      s.auditPage,
		"app/(app)/audit/close/page.tsx::load":                s.closeAuditPage,
		"app/(app)/audit/close/actions.ts::findSupportExport": s.findSupportExport,
		"app/(app)/audit/close/actions.ts::reviewSupportPack": s.reviewSupportPack,
		"app/(app)/audit/close/export/route.ts::GET":          s.exportCloseAudit,
	}
}

var closeAuditActions = []string{"finance_lock_updated", "finance_lock_reopened", "finance_lock_reopen_requested", "finance_lock_reopen_cancelled", "period_closed", "support_exported", "support_pack_reviewed", "journal_draft_posted", "draft_close_acceptance_requested", "draft_close_accepted", "draft_close_acceptance_cancelled"}
var closeAuditLabels = map[string]string{
	"finance_lock_updated":             "เลื่อนล็อกไปข้างหน้า / Lock moved forward",
	"finance_lock_reopened":            "เปิดงวดใหม่ / Finance lock reopened",
	"finance_lock_reopen_requested":    "ขอเปิดงวด / Reopen requested",
	"finance_lock_reopen_cancelled":    "ยกเลิกคำขอเปิดงวด / Reopen request cancelled",
	"period_closed":                    "ปิดเดือนที่จบแล้ว / Completed month closed",
	"support_exported":                 "ส่งไฟล์ประกอบ / Support file exported",
	"support_pack_reviewed":            "ตรวจไฟล์ประกอบแล้ว / Support file reviewed",
	"journal_draft_posted":             "บันทึกรายวันฉบับร่าง / Draft journal posted",
	"draft_close_acceptance_requested": "ขอรับงบทดลองฉบับร่าง / Draft trial balance acceptance requested",
	"draft_close_accepted":             "รับงบทดลองฉบับร่างแล้ว / Draft trial balance accepted",
	"draft_close_acceptance_cancelled": "ยกเลิกคำขอรับงบทดลอง / Draft acceptance cancelled",
}

type AuditPageData struct {
	Allowed          bool          `json:"allowed"`
	Entries          []erpwire.Row `json:"entries"`
	Title            string        `json:"title,omitempty"`
	Description      string        `json:"description,omitempty"`
	Chain            any           `json:"chain,omitempty"`
	ChainUnavailable bool          `json:"chainUnavailable,omitempty"`
	Reviewed         []string      `json:"reviewed,omitempty"`
}

func auditDenied() AuditPageData {
	return AuditPageData{Entries: []erpwire.Row{}, Title: "ไม่มีสิทธิ์เข้าถึง", Description: "หน้านี้สำหรับเจ้าขององค์กร ผู้ดูแลระบบ และนักบัญชี"}
}

func (s *Service) auditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.loadAudit(ctx, a, raw, false)
}
func (s *Service) closeAuditPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	return s.loadAudit(ctx, a, raw, true)
}
func (s *Service) loadAudit(ctx context.Context, a erpwire.Actor, raw json.RawMessage, closeOnly bool) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "audit:view") {
		return auditDenied(), nil
	}
	out := AuditPageData{Allowed: true, Entries: []erpwire.Row{}, Reviewed: []string{}}
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		q := selection(a, "audit_log", []string{"id", "actor_email", "entity", "entity_id", "action", "summary", "created_at"})
		if closeOnly {
			q.Columns = []string{"id", "actor_id", "actor_email", "action", "summary", "meta", "created_at", "close_chain_seq", "close_chain_prev", "close_chain_sha256"}
			q.Where = append(q.Where, erpwire.Predicate{Column: "action", Op: erpwire.In, Value: closeAuditActions})
		}
		q.Order = []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id", Descending: true}}
		q.Limit = 100
		rows, err := tx.Select(ctx, q)
		if authError(err) {
			return err
		}
		if err == nil && rows.Rows != nil {
			out.Entries = rows.Rows
		}
		return nil
	})
	if e != nil {
		return nil, e
	}
	if closeOnly {
		e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
			data, err := tx.ReadRPC(ctx, "verify_close_activity_chain", erpwire.Row{"p_org_id": a.OrgID()})
			if err == nil {
				out.Chain = readAuditChainStatus(data)
			}
			return err
		})
		if authError(e) {
			return nil, e
		}
		out.ChainUnavailable = e != nil
	}
	reviewed := map[string]bool{}
	for _, row := range out.Entries {
		row["relativeTime"] = auditRelativeTime(text(row["created_at"]), s.now())
		if closeOnly {
			view := closeActivityView(text(row["action"]), row["meta"])
			row["view"] = view
			if text(row["action"]) == "support_pack_reviewed" && text(row["actor_id"]) == a.UserID() {
				if hash := text(view["sha256"]); hash != "" && !reviewed[hash] {
					out.Reviewed = append(out.Reviewed, hash)
					reviewed[hash] = true
				}
			}
		} else {
			row["sentence"] = auditSentence(row)
		}
	}
	return out, nil
}

func auditSentence(row erpwire.Row) string {
	who := trimText(text(row["actor_email"]))
	if who == "" {
		who = "System"
	}
	if summary := trimText(text(row["summary"])); summary != "" {
		return who + " " + summary
	}
	label := trimText(text(row["action"]))
	labels := map[string]string{"created": "Created", "updated": "Updated", "deleted": "Deleted", "stage_changed": "Stage changed", "payment_recorded": "Payment recorded"}
	if v, ok := labels[label]; ok {
		label = v
	} else if label == "" {
		label = "Activity"
	} else {
		label = trimText(strings.ReplaceAll(label, "_", " "))
		runes := []rune(label)
		if len(runes) > 0 {
			runes[0] = unicode.ToUpper(runes[0])
			label = string(runes)
		}
	}
	return trimText(who + " " + label + " " + text(row["entity"]))
}

func auditRelativeTime(iso string, now time.Time) string {
	then, e := time.Parse(time.RFC3339Nano, iso)
	if e != nil {
		return ""
	}
	diff := now.Sub(then)
	if diff < time.Minute {
		return "just now"
	}
	for _, unit := range []struct {
		length time.Duration
		name   string
	}{{time.Minute, "minute"}, {time.Hour, "hour"}, {24 * time.Hour, "day"}} {
		limit := time.Hour
		if unit.length == time.Hour {
			limit = 24 * time.Hour
		}
		if unit.length == 24*time.Hour {
			limit = 7 * 24 * time.Hour
		}
		if diff < limit {
			n := int64(diff / unit.length)
			suffix := "s"
			if n == 1 {
				suffix = ""
			}
			return fmt.Sprintf("%d %s%s ago", n, unit.name, suffix)
		}
	}
	return then.In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2 Jan 2006")
}

func auditRecord(value any) erpwire.Row {
	switch row := value.(type) {
	case erpwire.Row:
		return row
	case map[string]any:
		return erpwire.Row(row)
	default:
		return erpwire.Row{}
	}
}
func auditNonblank(row erpwire.Row, key string) any {
	value := text(row[key])
	if trimText(value) == "" {
		return nil
	}
	return value
}
func auditWhole(value any) any {
	switch value.(type) {
	case string:
		return nil
	}
	n, ok := auditExactInteger(value)
	if !ok || n < 0 || n > erpwire.MaxSafeInteger {
		return nil
	}
	return n
}
func auditExactInteger(value any) (int64, bool) {
	if number, ok := value.(json.Number); ok {
		r, ok := new(big.Rat).SetString(number.String())
		if !ok || !r.IsInt() || !r.Num().IsInt64() {
			return 0, false
		}
		return r.Num().Int64(), true
	}
	n, e := integer(value)
	return n, e == nil
}
func closeActivityView(action string, meta any) erpwire.Row {
	row := auditRecord(meta)
	label := closeAuditLabels[action]
	if label == "" {
		label = action
	}
	out := erpwire.Row{"actionLabel": label, "previousLockDate": auditNonblank(row, "previousLockDate"), "lockDate": auditNonblank(row, "lockDate"), "month": auditNonblank(row, "month"), "reason": auditNonblank(row, "reason"), "control": nil, "sha256": auditNonblank(row, "sha256"), "period": auditNonblank(row, "period"), "bytes": auditWhole(row["bytes"]), "kind": auditNonblank(row, "kind")}
	for _, key := range []string{"previousLockDate", "lockDate"} {
		if value := text(out[key]); value != "" {
			if day, e := time.Parse("2006-01-02", value); e == nil && day.Year() >= 100 {
				out[key] = fmt.Sprintf("%s (%02d/%02d/%d)", value, day.Day(), day.Month(), day.Year()+543)
			}
		}
	}
	if action == "finance_lock_reopen_requested" {
		out["control"] = "รอคนที่สอง / waiting for a second owner or admin"
	}
	if action == "finance_lock_reopened" {
		out["control"] = "คนเดียว / one owner or admin"
		if auditNonblank(row, "reason") == nil {
			out["control"] = "คำสั่งเก่า ไม่มีเหตุผล / older command, no reason recorded"
		} else if auditNonblank(row, "requestedBy") != nil && auditNonblank(row, "confirmedBy") != nil && text(row["requestedBy"]) != text(row["confirmedBy"]) {
			out["control"] = "คนที่สองยืนยัน / a second owner or admin confirmed"
		}
	}
	switch text(out["kind"]) {
	case "operational_lock", "operational_close", "operational_journal", "draft_gl_acceptance":
		out["kind"] = nil
	}
	return out
}

func readAuditChainStatus(raw []byte) any {
	var row erpwire.Row
	if erpwire.DecodeJSON(raw, &row) != nil || row == nil || auditWhole(row["checked"]) == nil {
		return nil
	}
	if row["ok"] == true {
		return erpwire.Row{"ok": true, "checked": row["checked"], "reason": nil, "brokenAt": nil}
	}
	if row["ok"] != false || auditNonblank(row, "reason") == nil {
		return nil
	}
	broken := any(nil)
	if v, ok := row["brokenAt"].(string); ok {
		broken = v
	}
	return erpwire.Row{"ok": false, "checked": row["checked"], "reason": row["reason"], "brokenAt": broken}
}

var auditChecksum = regexp.MustCompile(`^[a-f0-9]{64}$`)

func auditHashArgument(raw json.RawMessage) (string, error) {
	args, e := arguments(raw, 1, 1)
	if e != nil {
		return "", e
	}
	var hash string
	if args.Decode(0, &hash) != nil {
		return "", erpwire.ErrBadArguments
	}
	hash = strings.ToLower(trimText(hash))
	if !auditChecksum.MatchString(hash) {
		return "", nil
	}
	return hash, nil
}
func auditErrorMessage(err error, fallback string) string {
	var safe interface{ BusinessMessage() string }
	if errors.As(err, &safe) && safe.BusinessMessage() != "" {
		return safe.BusinessMessage()
	}
	return fallback
}
func (s *Service) findSupportExport(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	out := erpwire.Row{"record": nil}
	if !erpwire.Can(a.Role(), "audit:view") {
		out["error"] = "Only owners, admins, and accountants can check an export."
		return erpwire.ActionResponse{Value: out}, nil
	}
	hash, e := auditHashArgument(raw)
	if e != nil {
		return nil, e
	}
	if hash == "" {
		out["error"] = "Enter a SHA-256 checksum."
		return erpwire.ActionResponse{Value: out}, nil
	}
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		data, e := tx.ReadRPC(ctx, "find_support_export", erpwire.Row{"p_org_id": a.OrgID(), "p_sha256": hash})
		if e != nil {
			return e
		}
		var row erpwire.Row
		if erpwire.DecodeJSON(data, &row) == nil && auditNonblank(row, "sha256") != nil && auditNonblank(row, "kind") != nil && auditNonblank(row, "period") != nil && auditWhole(row["bytes"]) != nil {
			summary := text(row["summary"])
			if trimText(summary) == "" {
				summary = ""
			}
			out["record"] = erpwire.Row{"sha256": row["sha256"], "kind": row["kind"], "period": row["period"], "bytes": row["bytes"], "summary": summary}
		}
		return nil
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		out["error"] = auditErrorMessage(e, "Could not check the support export. Please try again.")
	}
	return erpwire.ActionResponse{Value: out}, nil
}
func (s *Service) reviewSupportPack(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "audit:view") {
		return invalid("Only owners, admins, and accountants can review a support file.")
	}
	hash, e := auditHashArgument(raw)
	if e != nil {
		return nil, e
	}
	if hash == "" {
		return invalid("Enter a SHA-256 checksum.")
	}
	out := erpwire.Row{}
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		data, e := tx.Command(ctx, "review_support_pack", erpwire.Row{"p_org_id": a.OrgID(), "p_sha256": hash})
		if e != nil {
			return e
		}
		var row erpwire.Row
		if erpwire.DecodeJSON(data, &row) == nil && row["already"] == true {
			out["already"] = true
		}
		return nil
	})
	if e != nil {
		return actionFailure(e, "Could not review the support file. Please try again.")
	}
	return erpwire.ActionResponse{Value: out}, nil
}

const closeActivityDisclaimerTH = "บันทึกกิจกรรมปิดงวด ไฟล์นี้คือรายการที่มีอยู่ตอนส่งออก และไม่รวมแถวเช็คซัมของไฟล์นี้เอง ไม่ใช่การยื่นแบบ ภ.พ.30 และไม่ใช่งบการเงินตามกฎหมาย"
const closeActivityDisclaimerEN = "Close activity log. This file is the rows that existed when it was exported. It does not include its own checksum row. It does not file ภ.พ.30 and it is not a statutory ledger."
const closeActivityLegacyTH = "การเปิดงวดที่ไม่มีเหตุผลมาจากคำสั่งล็อกแบบเก่า หน้าจอตอนนี้ต้องมีเหตุผล และถ้ามีเจ้าของหรือผู้ดูแลมากกว่าหนึ่งคนต้องมีคนที่สองยืนยัน"
const closeActivityLegacyEN = "A reopen with no reason came from the older lock command. The screen now requires a reason, and a second owner or admin when the workspace has more than one."
const closeActivityChainTH = "แต่ละแถวเก็บ SHA-256 ของแถวก่อนหน้า แถวที่หายหรือถูกแก้จะทำให้โซ่ขาด เจ้าของฐานข้อมูลยังแก้โซ่ได้ นี่ไม่ใช่ตราเวลาจากภายนอก และไม่ใช่การยื่นแบบ"
const closeActivityChainEN = "Each close-activity row stores the SHA-256 of the previous row. A missing or edited row breaks the chain. The database owner can still rewrite it. This is not an external timestamp and not a filing."

var auditNumericCell = regexp.MustCompile(`^-?(?:0|[1-9]\d*)(?:\.\d+)?$`)

func auditCSVCell(value any) string {
	if value == nil {
		return ""
	}
	s := ""
	switch v := value.(type) {
	case string:
		s = v
		if len(s) > 0 && strings.ContainsRune("=+-@\t\r", rune(s[0])) && !auditNumericCell.MatchString(s) {
			s = "'" + s
		}
	case json.Number:
		s = v.String()
	case int64:
		s = strconv.FormatInt(v, 10)
	case int:
		s = strconv.Itoa(v)
	default:
		s = fmt.Sprint(v)
	}
	if strings.ContainsAny(s, ",\"\r\n") {
		s = "\"" + strings.ReplaceAll(s, "\"", "\"\"") + "\""
	}
	return s
}
func closeActivityCSV(rows []erpwire.Row, exportedOn string) string {
	header := []any{"Section", "Id", "Recorded at", "Actor", "Action", "Summary", "Previous lock", "Lock date", "Month", "Reason", "Control", "File kind", "Period", "SHA-256", "Bytes", "Chain seq", "Chain previous", "Chain SHA-256"}
	matrix := [][]any{header}
	for _, note := range []string{closeActivityDisclaimerTH, closeActivityDisclaimerEN, closeActivityLegacyTH, closeActivityLegacyEN, closeActivityChainTH, closeActivityChainEN} {
		row := make([]any, 18)
		row[0] = "note"
		row[2] = exportedOn
		row[5] = note
		matrix = append(matrix, row)
	}
	sorted := append([]erpwire.Row(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if text(sorted[i]["created_at"]) != text(sorted[j]["created_at"]) {
			return text(sorted[i]["created_at"]) > text(sorted[j]["created_at"])
		}
		return text(sorted[i]["id"]) > text(sorted[j]["id"])
	})
	for _, row := range sorted {
		v := closeActivityView(text(row["action"]), row["meta"])
		matrix = append(matrix, []any{"event", row["id"], row["created_at"], row["actor_email"], row["action"], row["summary"], v["previousLockDate"], v["lockDate"], v["month"], v["reason"], v["control"], v["kind"], v["period"], v["sha256"], v["bytes"], row["close_chain_seq"], row["close_chain_prev"], row["close_chain_sha256"]})
	}
	lines := make([]string, len(matrix))
	for i, row := range matrix {
		cells := make([]string, len(row))
		for j, value := range row {
			cells[j] = auditCSVCell(value)
		}
		lines[i] = strings.Join(cells, ",")
	}
	return "\ufeff" + strings.Join(lines, "\r\n")
}
func (s *Service) exportCloseAudit(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authorize(a, ""); e != nil {
		return nil, e
	}
	if _, e := arguments(raw, 0, 0); e != nil {
		return nil, e
	}
	if !erpwire.Can(a.Role(), "audit:view") {
		return HTTPResponse{Status: 403, Body: "Only owners, admins, and accountants can export close activity."}, nil
	}
	var rows []erpwire.Row
	e := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		q := selection(a, "audit_log", []string{"id", "actor_email", "action", "summary", "meta", "created_at", "close_chain_seq", "close_chain_prev", "close_chain_sha256"}, erpwire.Predicate{Column: "action", Op: erpwire.In, Value: closeAuditActions})
		q.Order = []erpwire.Order{{Column: "created_at", Descending: true}, {Column: "id", Descending: true}}
		var e error
		rows, e = all(ctx, tx, q)
		return e
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		return HTTPResponse{Status: 503, Body: "Close activity export unavailable. Reload before relying on this file."}, nil
	}
	date := s.now().In(time.FixedZone("Asia/Bangkok", 7*60*60)).Format("2006-01-02")
	body := closeActivityCSV(rows, date)
	hash := sha256.Sum256([]byte(body))
	sum := hex.EncodeToString(hash[:])
	e = s.store.Write(ctx, a, func(tx erpwire.WriteTx) error {
		_, e := tx.Command(ctx, "record_support_export", erpwire.Row{"p_org_id": a.OrgID(), "p_kind": "close_activity_csv", "p_period": date, "p_sha256": sum, "p_bytes": len([]byte(body))})
		return e
	})
	if e != nil {
		if authError(e) {
			return nil, e
		}
		return HTTPResponse{Status: 503, Body: "Support export was not recorded. Reload and try the download again."}, nil
	}
	return HTTPResponse{Status: 200, Body: body, Headers: map[string]string{"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="close-activity-` + date + `.csv"`, "X-Content-SHA256": sum, "X-Robots-Tag": "noindex"}}, nil
}

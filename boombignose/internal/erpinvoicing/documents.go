package erpinvoicing

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

// PDFRenderer owns byte rendering, including the current printable-HTML format.
type PDFRenderer interface {
	Render(context.Context, DocumentModel) (RenderedDocument, error)
}
type RenderedDocument struct {
	Body        []byte
	ContentType string
}
type DocumentModel struct {
	Document *PrintableDocument   `json:"document,omitempty"`
	WHT      *WHTCertificateDraft `json:"wht,omitempty"`
}
type DocLineItem struct {
	Description     string       `json:"description"`
	Quantity        json.Number  `json:"quantity"`
	Unit            *string      `json:"unit,omitempty"`
	UnitPriceSatang money.Satang `json:"unit_price_satang"`
	AmountSatang    money.Satang `json:"amount_satang"`
}
type TaxInvoiceLabel struct {
	DocType    string `json:"docType"`
	BranchCode string `json:"branchCode"`
	CopyLabel  string `json:"copyLabel"`
}
type PrintableDocument struct {
	Kind               string           `json:"kind"`
	Number             string           `json:"number"`
	PublicReference    *string          `json:"publicReference,omitempty"`
	OriginalNumber     string           `json:"originalNumber,omitempty"`
	Status             string           `json:"status"`
	OrgName            string           `json:"orgName"`
	SellerAddress      *string          `json:"sellerAddress,omitempty"`
	SellerTaxID        *string          `json:"sellerTaxId,omitempty"`
	SellerBranch       *string          `json:"sellerBranch,omitempty"`
	BuyerBranch        *string          `json:"buyerBranch,omitempty"`
	ClientName         string           `json:"clientName"`
	BuyerAddress       *string          `json:"buyerAddress,omitempty"`
	BuyerTaxID         *string          `json:"buyerTaxId,omitempty"`
	IssueDate          *string          `json:"issueDate"`
	DueDate            *string          `json:"dueDate,omitempty"`
	Items              []DocLineItem    `json:"items"`
	Sections           []erpwire.Row    `json:"sections,omitempty"`
	SubtotalSatang     money.Satang     `json:"subtotalSatang"`
	DiscountSatang     money.Satang     `json:"discountSatang"`
	TotalSatang        money.Satang     `json:"totalSatang"`
	VATSatang          money.Satang     `json:"vatSatang"`
	VATByRate          []erpwire.Row    `json:"vatByRate"`
	WHTSatang          money.Satang     `json:"whtSatang"`
	WHTRateBps         json.Number      `json:"whtRateBps"`
	AmountDueSatang    money.Satang     `json:"amountDueSatang"`
	PricesIncludeVAT   bool             `json:"pricesIncludeVat"`
	VerifiedPaidSatang *money.Satang    `json:"verifiedPaidSatang,omitempty"`
	CreditedSatang     money.Satang     `json:"creditedSatang"`
	OutstandingSatang  *money.Satang    `json:"outstandingSatang,omitempty"`
	Notes              *string          `json:"notes,omitempty"`
	TaxInvoice         *TaxInvoiceLabel `json:"taxInvoice,omitempty"`
}
type WHTCertificateDraft struct {
	Reference                string       `json:"reference"`
	IssueDate                *string      `json:"issueDate"`
	PayerName                string       `json:"payerName"`
	PayerAddress             *string      `json:"payerAddress"`
	PayerTaxID               *string      `json:"payerTaxId"`
	PayeeName                string       `json:"payeeName"`
	PayeeAddress             *string      `json:"payeeAddress"`
	PayeeTaxID               *string      `json:"payeeTaxId"`
	Income                   string       `json:"income"`
	BaseSatang               money.Satang `json:"baseSatang"`
	WHTSatang                money.Satang `json:"whtSatang"`
	WHTRateBps               int64        `json:"whtRateBps"`
	Banner                   string       `json:"banner"`
	Title                    string       `json:"title"`
	IncomeClassificationNote string       `json:"incomeClassificationNote"`
}

var errInvoiceSnapshot = errors.New("Invalid issued snapshot")
var errCreditSnapshot = errors.New("Invalid credit note snapshot")

func ptrDocumentText(v any) *string {
	if s, ok := v.(string); ok {
		return &s
	}
	return nil
}
func snapshotObject(value any) erpwire.Row {
	encoded, e := json.Marshal(value)
	if e != nil {
		return nil
	}
	var result erpwire.Row
	if erpwire.DecodeJSON(encoded, &result) != nil {
		return nil
	}
	return result
}
func requiredText(row erpwire.Row, key string, nullable bool) bool {
	v, ok := row[key]
	if !ok {
		return false
	}
	if v == nil {
		return nullable
	}
	_, ok = v.(string)
	return ok
}
func optionalText(row erpwire.Row, key string) bool {
	_, present := row[key]
	return !present || requiredText(row, key, true)
}
func requiredBool(row erpwire.Row, key string) bool { _, ok := row[key].(bool); return ok }
func documentInteger(v any) (int64, error) {
	n, ok := documentNumber(v)
	if !ok {
		return 0, errInvoiceSnapshot
	}
	r, ok := new(big.Rat).SetString(n.String())
	if !ok || !r.IsInt() || !r.Num().IsInt64() {
		return 0, errInvoiceSnapshot
	}
	return r.Num().Int64(), nil
}
func snapshotMoney(row erpwire.Row, key string, optional bool) (money.Satang, error) {
	v, present := row[key]
	if !present && optional {
		return 0, nil
	}
	n, e := documentInteger(v)
	if e != nil || n < 0 || n > int64(money.MaxSafeSatang) {
		return 0, errInvoiceSnapshot
	}
	return money.Satang(n), nil
}
func snapshotRate(row erpwire.Row, key string, optional bool) (int64, error) {
	v, present := row[key]
	if !present && optional {
		return 0, nil
	}
	n, e := documentInteger(v)
	if e != nil || n < 0 || n > 10000 {
		return 0, errInvoiceSnapshot
	}
	return n, nil
}
func documentNumber(v any) (json.Number, bool) {
	switch n := v.(type) {
	case json.Number:
		if _, ok := new(big.Rat).SetString(n.String()); ok {
			return n, true
		}
	case int:
		return json.Number(strconv.Itoa(n)), true
	case int64:
		return json.Number(strconv.FormatInt(n, 10)), true
	}
	return "", false
}
func documentQuantity(value any, maximum bool) (json.Number, bool) {
	n, ok := documentNumber(value)
	if !ok {
		return "", false
	}
	r, ok := new(big.Rat).SetString(n.String())
	if !ok || r.Sign() <= 0 {
		return "", false
	}
	if maximum {
		max, _ := new(big.Rat).SetString("999999999.999")
		if r.Cmp(max) > 0 {
			return "", false
		}
	}
	return n, true
}
func snapshotRows(row erpwire.Row, key string, optional bool) ([]erpwire.Row, error) {
	v, present := row[key]
	if !present && optional {
		return []erpwire.Row{}, nil
	}
	raw, e := json.Marshal(v)
	if e != nil {
		return nil, errInvoiceSnapshot
	}
	var rows []erpwire.Row
	if erpwire.DecodeJSON(raw, &rows) != nil || rows == nil {
		return nil, errInvoiceSnapshot
	}
	return rows, nil
}
func bucketRows(buckets []TaxBucket) []erpwire.Row {
	rows := make([]erpwire.Row, 0, len(buckets))
	for _, bucket := range buckets {
		rows = append(rows, erpwire.Row{"rateBps": bucket.RateBps, "baseSatang": bucket.BaseSatang, "vatSatang": bucket.VATSatang})
	}
	return rows
}

type issuedSnapshot struct {
	legacy       bool
	doc          PrintableDocument
	taxLines     []TaxLine
	descriptions []string
	totals       TaxTotals
}

func parseIssuedSnapshot(value any, effective string, paid, credited money.Satang, copy bool) (issuedSnapshot, error) {
	row := snapshotObject(value)
	version, e := documentInteger(row["version"])
	if e != nil || version != 1 {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	kind := "operational_invoice"
	if v, ok := row["kind"]; ok {
		kind = text(v)
	}
	if kind != "operational_invoice" && kind != "legacy_operational_invoice" {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	seller, buyer, d := object(row["seller"]), object(row["buyer"]), object(row["document"])
	if !requiredText(seller, "legalName", false) || text(seller["legalName"]) == "" || !requiredText(seller, "address", false) || !requiredText(seller, "taxId", true) || !optionalText(seller, "branchLabel") || !requiredText(buyer, "id", false) || !requiredText(buyer, "name", false) || !requiredText(buyer, "address", true) || !requiredText(buyer, "taxId", true) || !optionalText(buyer, "branchLabel") {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	if tax := text(seller["taxStatus"]); tax != "unknown" && tax != "not_registered" && tax != "registered" {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	if _, ok := seller["vatRegistered"]; ok && !requiredBool(seller, "vatRegistered") {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	for _, key := range []string{"number", "issueDate", "dueDate", "notes"} {
		if !requiredText(d, key, key != "number") {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
	}
	for _, key := range []string{"pricesIncludeVat"} {
		if _, ok := d[key]; ok && !requiredBool(d, key) {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
	}
	doc := PrintableDocument{Kind: "Invoice", Number: text(d["number"]), Status: effective, OrgName: text(seller["legalName"]), SellerAddress: ptrDocumentText(seller["address"]), SellerTaxID: ptrDocumentText(seller["taxId"]), SellerBranch: ptrDocumentText(seller["branchLabel"]), ClientName: text(buyer["name"]), BuyerAddress: ptrDocumentText(buyer["address"]), BuyerTaxID: ptrDocumentText(buyer["taxId"]), BuyerBranch: ptrDocumentText(buyer["branchLabel"]), IssueDate: ptrDocumentText(d["issueDate"]), DueDate: ptrDocumentText(d["dueDate"]), Notes: ptrDocumentText(d["notes"]), Items: []DocLineItem{}, VATByRate: []erpwire.Row{}, VerifiedPaidSatang: &paid, CreditedSatang: credited}
	for _, field := range []struct {
		key      string
		target   *money.Satang
		optional bool
	}{{"subtotalSatang", &doc.SubtotalSatang, false}, {"discountSatang", &doc.DiscountSatang, false}, {"totalSatang", &doc.TotalSatang, false}, {"vatSatang", &doc.VATSatang, true}, {"whtSatang", &doc.WHTSatang, true}} {
		n, e := snapshotMoney(d, field.key, field.optional)
		if e != nil {
			return issuedSnapshot{}, e
		}
		*field.target = n
	}
	doc.AmountDueSatang = doc.TotalSatang
	if _, ok := d["amountDueSatang"]; ok {
		n, e := snapshotMoney(d, "amountDueSatang", false)
		if e != nil {
			return issuedSnapshot{}, e
		}
		doc.AmountDueSatang = n
	}
	wht, e := snapshotRate(d, "whtRateBps", true)
	if e != nil || !validWHT(wht) {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	doc.WHTRateBps = json.Number(strconv.FormatInt(wht, 10))
	doc.PricesIncludeVAT, _ = d["pricesIncludeVat"].(bool)
	buckets, e := snapshotRows(d, "vatByRate", true)
	if e != nil {
		return issuedSnapshot{}, e
	}
	for _, bucket := range buckets {
		rate, e := snapshotRate(bucket, "rateBps", false)
		if e != nil {
			return issuedSnapshot{}, e
		}
		vat, e := snapshotMoney(bucket, "vatSatang", false)
		if e != nil {
			return issuedSnapshot{}, e
		}
		normalized := erpwire.Row{"rateBps": rate, "vatSatang": vat}
		if _, ok := bucket["baseSatang"]; ok {
			base, e := snapshotMoney(bucket, "baseSatang", false)
			if e != nil {
				return issuedSnapshot{}, e
			}
			normalized["baseSatang"] = base
		}
		doc.VATByRate = append(doc.VATByRate, normalized)
	}
	legacy := kind == "legacy_operational_invoice"
	if v, present := row["taxInvoice"]; present {
		tax := object(v)
		t := text(tax["docType"])
		branch := text(tax["branchCode"])
		label := text(tax["copyLabel"])
		if t != "TX" && t != "ABB" || !documentDigits(branch, 5) || len(utf16.Encode([]rune(label))) < 1 || len(utf16.Encode([]rune(label))) > 40 {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
		if copy {
			label = "สำเนา"
		}
		doc.TaxInvoice = &TaxInvoiceLabel{t, branch, label}
		if !legacy {
			doc.Kind = "Tax Invoice / ใบกำกับภาษี"
			if t == "ABB" {
				doc.Kind = "Abbreviated Tax Invoice / ใบกำกับภาษีอย่างย่อ"
			}
		}
		if t == "ABB" {
			doc.BuyerAddress = nil
			doc.BuyerTaxID = nil
		}
	}
	lines, e := snapshotRows(row, "lines", false)
	if e != nil || !legacy && len(lines) == 0 {
		return issuedSnapshot{}, errInvoiceSnapshot
	}
	out := issuedSnapshot{legacy: legacy, doc: doc, taxLines: []TaxLine{}, descriptions: []string{}}
	for _, line := range lines {
		if !requiredText(line, "description", false) || !optionalText(line, "unit") {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
		quantity, ok := documentQuantity(line["quantity"], true)
		if !ok {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
		price, e := snapshotMoney(line, "unitPriceSatang", false)
		if e != nil {
			return issuedSnapshot{}, e
		}
		amount, e := snapshotMoney(line, "amountSatang", false)
		if e != nil {
			return issuedSnapshot{}, e
		}
		position, e := documentInteger(line["position"])
		if e != nil || position < 0 {
			return issuedSnapshot{}, errInvoiceSnapshot
		}
		rate, e := snapshotRate(line, "taxRateBps", true)
		if e != nil {
			return issuedSnapshot{}, e
		}
		out.doc.Items = append(out.doc.Items, DocLineItem{text(line["description"]), quantity, ptrDocumentText(line["unit"]), price, amount})
		out.taxLines = append(out.taxLines, TaxLine{amount, rate})
		out.descriptions = append(out.descriptions, text(line["description"]))
	}
	if !legacy {
		totals, e := CalculateTax(out.taxLines, doc.DiscountSatang, doc.PricesIncludeVAT, wht)
		if e != nil {
			return issuedSnapshot{}, e
		}
		if totals.SubtotalSatang != doc.SubtotalSatang || totals.TotalSatang != doc.TotalSatang || totals.VATSatang != doc.VATSatang || totals.WHTSatang != doc.WHTSatang || totals.AmountDueSatang != doc.AmountDueSatang {
			return issuedSnapshot{}, errors.New("Invalid issued snapshot totals")
		}
		out.totals = totals
		out.doc.VATByRate = bucketRows(totals.VATByRate)
	}
	owed := outstanding(out.doc.AmountDueSatang, paid, credited)
	out.doc.OutstandingSatang = &owed
	return out, nil
}

func documentDigits(value string, count int) bool {
	if len(value) != count {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func parseCreditDocument(value any) (PrintableDocument, error) {
	row := snapshotObject(value)
	version, e := documentInteger(row["version"])
	if e != nil || version != 1 || text(row["kind"]) != "credit_note" || !requiredText(row, "originalNumber", false) {
		return PrintableDocument{}, errCreditSnapshot
	}
	seller, buyer, d := object(row["seller"]), object(row["buyer"]), object(row["document"])
	if !requiredText(seller, "legalName", false) || !requiredText(seller, "address", false) || !requiredText(seller, "taxId", true) || !requiredBool(seller, "vatRegistered") || !optionalText(seller, "branchLabel") || !requiredText(buyer, "name", false) || !requiredText(buyer, "address", true) || !requiredText(buyer, "taxId", true) || !optionalText(buyer, "branchLabel") {
		return PrintableDocument{}, errCreditSnapshot
	}
	for _, key := range []string{"number", "issueDate", "reason"} {
		if !requiredText(d, key, false) {
			return PrintableDocument{}, errCreditSnapshot
		}
	}
	if !requiredBool(d, "pricesIncludeVat") {
		return PrintableDocument{}, errCreditSnapshot
	}
	doc := PrintableDocument{Kind: "Credit note / ใบลดหนี้", Number: text(d["number"]), OriginalNumber: text(row["originalNumber"]), Status: "issued", OrgName: text(seller["legalName"]), SellerAddress: ptrDocumentText(seller["address"]), SellerTaxID: ptrDocumentText(seller["taxId"]), SellerBranch: ptrDocumentText(seller["branchLabel"]), ClientName: text(buyer["name"]), BuyerAddress: ptrDocumentText(buyer["address"]), BuyerTaxID: ptrDocumentText(buyer["taxId"]), BuyerBranch: ptrDocumentText(buyer["branchLabel"]), IssueDate: ptrDocumentText(d["issueDate"]), Notes: ptrDocumentText(d["reason"]), Items: []DocLineItem{}, VATByRate: []erpwire.Row{}}
	if seller["vatRegistered"] == true {
		doc.Kind = "Tax credit note / ใบลดหนี้"
	}
	doc.PricesIncludeVAT, _ = d["pricesIncludeVat"].(bool)
	base, e := snapshotMoney(d, "baseSatang", false)
	if e != nil {
		return PrintableDocument{}, errCreditSnapshot
	}
	for _, field := range []struct {
		key    string
		target *money.Satang
	}{{"vatSatang", &doc.VATSatang}, {"totalSatang", &doc.TotalSatang}, {"whtSatang", &doc.WHTSatang}, {"amountDueSatang", &doc.AmountDueSatang}} {
		n, e := snapshotMoney(d, field.key, false)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		*field.target = n
	}
	wht, ok := documentNumber(d["whtRateBps"])
	if !ok {
		return PrintableDocument{}, errCreditSnapshot
	}
	doc.WHTRateBps = wht
	buckets, e := snapshotRows(d, "vatByRate", false)
	if e != nil {
		return PrintableDocument{}, errCreditSnapshot
	}
	vatTotal := money.Satang(0)
	for _, bucket := range buckets {
		rate, ok := documentNumber(bucket["rateBps"])
		if !ok {
			return PrintableDocument{}, errCreditSnapshot
		}
		base, e := snapshotMoney(bucket, "baseSatang", false)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		vat, e := snapshotMoney(bucket, "vatSatang", false)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		vatTotal, e = sum(vatTotal, vat)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		doc.VATByRate = append(doc.VATByRate, erpwire.Row{"rateBps": rate, "baseSatang": base, "vatSatang": vat})
	}
	total, e := sum(base, doc.VATSatang)
	if e != nil || total != doc.TotalSatang || doc.AmountDueSatang != doc.TotalSatang-doc.WHTSatang || vatTotal != doc.VATSatang {
		return PrintableDocument{}, errors.New("Invalid credit totals")
	}
	lines, e := snapshotRows(row, "lines", false)
	if e != nil {
		return PrintableDocument{}, errCreditSnapshot
	}
	for _, line := range lines {
		if !requiredText(line, "description", false) || !requiredText(line, "unit", true) {
			return PrintableDocument{}, errCreditSnapshot
		}
		quantity, ok := documentQuantity(line["quantity"], false)
		if !ok {
			return PrintableDocument{}, errCreditSnapshot
		}
		price, e := snapshotMoney(line, "unitPriceSatang", false)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		amount, e := snapshotMoney(line, "amountSatang", false)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		doc.SubtotalSatang, e = sum(doc.SubtotalSatang, amount)
		if e != nil {
			return PrintableDocument{}, errCreditSnapshot
		}
		doc.Items = append(doc.Items, DocLineItem{text(line["description"]), quantity, ptrDocumentText(line["unit"]), price, amount})
	}
	doc.DiscountSatang = doc.SubtotalSatang - base
	if doc.PricesIncludeVAT {
		doc.DiscountSatang -= doc.VATSatang
	}
	return doc, nil
}

func documentRoute(status int, message string) RouteResponse {
	return RouteResponse{Status: status, Headers: map[string]string{"Content-Type": "text/plain; charset=utf-8"}, Body: []byte(message)}
}
func documentReadError(err error, message string) error {
	if canonical(err) {
		return err
	}
	return errors.New(message)
}
func (s *Service) renderDocument(ctx context.Context, model DocumentModel, noindex bool) (any, error) {
	if s.renderer == nil {
		return documentRoute(503, "Document renderer unavailable"), nil
	}
	rendered, e := s.renderer.Render(ctx, model)
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return documentRoute(503, "Document rendering unavailable"), nil
	}
	if rendered.ContentType == "" {
		return documentRoute(503, "Document rendering unavailable"), nil
	}
	headers := map[string]string{"Content-Type": rendered.ContentType}
	if noindex {
		headers["X-Robots-Tag"] = "noindex"
	}
	return RouteResponse{Status: 200, Headers: headers, Body: rendered.Body}, nil
}

func invoiceSections(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string) ([]erpwire.Row, error) {
	return all(ctx, tx, erpwire.Select{Table: "document_sections", Columns: []string{"id", "kind", "description", "lines_before", "position"}, Where: append(scope(a), eq("invoice_id", id)), Order: ordered("position", "id")})
}
func invoicePublicReference(ctx context.Context, tx erpwire.ReadTx, a erpwire.Actor, id string) (*string, error) {
	settings, e := one(ctx, tx, erpwire.Select{Table: "org_settings", Columns: []string{"public_document_refs_enabled"}, Where: scope(a)})
	if e != nil {
		return nil, e
	}
	if settings["public_document_refs_enabled"] != true {
		return nil, nil
	}
	row, e := one(ctx, tx, erpwire.Select{Table: "document_public_refs", Columns: []string{"reference"}, Where: append(scope(a), eq("kind", "invoice"), eq("record_id", id))})
	if e != nil {
		return nil, e
	}
	value := text(row["reference"])
	if len(value) != 24 || !strings.HasPrefix(value, "inv1") {
		return nil, nil
	}
	const alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
	generators := [...]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	values := []int{3, 3, 3, 0, 9, 14, 22}
	for _, r := range value[4:] {
		index := strings.IndexRune(alphabet, r)
		if index < 0 {
			return nil, nil
		}
		values = append(values, index)
	}
	checksum := uint32(1)
	for _, v := range values {
		top := checksum >> 25
		checksum = ((checksum & 0x1ffffff) << 5) ^ uint32(v)
		for i, g := range generators {
			if (top>>i)&1 != 0 {
				checksum ^= g
			}
		}
	}
	if checksum != 0x2bc830a3 {
		return nil, nil
	}
	parts := []string{}
	for i := 4; i < len(value); i += 4 {
		parts = append(parts, value[i:i+4])
	}
	display := "inv1" + strings.Join(parts, "-")
	return &display, nil
}

func (s *Service) invoicePDF(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	id, params, e := routeArgs(raw)
	if e != nil {
		return nil, e
	}
	if !validID(id) {
		return documentRoute(404, "Invoice not found"), nil
	}
	var doc PrintableDocument
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		invoice, e := one(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "number", "status", "amount_satang", "discount_satang", "subtotal_satang", "total_satang", "vat_satang", "wht_satang", "wht_rate_bps", "prices_include_vat", "tax_breakdown", "issued_snapshot_id", "issue_date", "due_date", "notes", "client_id"}, Relations: []erpwire.Relation{{Name: "clients", Table: "clients", LocalColumn: "client_id", ForeignColumn: "id", Columns: []string{"name"}}}, Where: scoped(a, id)})
		if e != nil {
			return documentReadError(e, "Invoice evidence unavailable")
		}
		items, e := all(ctx, tx, erpwire.Select{Table: "invoice_items", Columns: []string{"description", "quantity", "unit_price_satang", "amount_satang", "unit"}, Where: append(scope(a), eq("invoice_id", id)), Order: ordered("position", "id")})
		if e != nil {
			return documentReadError(e, "Invoice evidence unavailable")
		}
		receipts, e := all(ctx, tx, erpwire.Select{Table: "invoice_receipts", Columns: []string{"amount_satang"}, Where: append(scope(a), eq("invoice_id", id), eq("verification_state", "verified")), Order: ordered("id")})
		if e != nil {
			return documentReadError(e, "Invoice evidence unavailable")
		}
		sections, e := invoiceSections(ctx, tx, a, id)
		if e != nil {
			return documentReadError(e, "Invoice evidence unavailable")
		}
		balance, e := one(ctx, tx, erpwire.Select{Table: "invoice_balances", Columns: []string{"paid_satang", "credited_satang"}, Where: append(scope(a), eq("invoice_id", id))})
		if e != nil {
			return documentReadError(e, "Invoice balance unavailable")
		}
		if invoice == nil {
			return erpwire.ErrNotFound
		}
		paid, credited := money.Satang(0), money.Satang(0)
		if balance != nil {
			paid, e = amount(balance["paid_satang"])
			if e != nil {
				return errors.New("Invoice balance unavailable")
			}
			credited, e = amount(balance["credited_satang"])
			if e != nil {
				return errors.New("Invoice balance unavailable")
			}
		} else {
			for _, receipt := range receipts {
				value, e := amount(receipt["amount_satang"])
				if e != nil {
					return errors.New("Invoice evidence unavailable")
				}
				paid, e = sum(paid, value)
				if e != nil {
					return errors.New("Invoice evidence unavailable")
				}
			}
		}
		if invoice["issued_snapshot_id"] != nil && text(invoice["issued_snapshot_id"]) != "" {
			stored, e := one(ctx, tx, erpwire.Select{Table: "invoice_snapshots", Columns: []string{"snapshot"}, Where: append(scope(a), eq("invoice_id", id), eq("id", invoice["issued_snapshot_id"]))})
			if e != nil || stored == nil {
				return documentReadError(e, "Issued document unavailable")
			}
			parsed, e := parseIssuedSnapshot(stored["snapshot"], status(invoice, paid, credited, s.today()), paid, credited, text(params["copy"]) == "1")
			if e != nil {
				return errors.New("Issued document snapshot could not be validated")
			}
			doc = parsed.doc
		} else {
			var err error
			doc, err = draftInvoiceDocument(invoice, items, a, paid, credited, s.today())
			if err != nil {
				return errors.New("Invoice evidence unavailable")
			}
		}
		doc.Sections = sections
		doc.PublicReference, e = invoicePublicReference(ctx, tx, a, id)
		if e != nil {
			return documentReadError(e, "Invoice evidence unavailable")
		}
		return nil
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		if errors.Is(e, erpwire.ErrNotFound) {
			return documentRoute(404, "Invoice not found"), nil
		}
		message := e.Error()
		switch message {
		case "Invoice evidence unavailable", "Invoice balance unavailable", "Issued document unavailable", "Issued document snapshot could not be validated":
		default:
			message = "Invoice evidence unavailable"
		}
		return documentRoute(503, message), nil
	}
	return s.renderDocument(ctx, DocumentModel{Document: &doc}, false)
}

func draftInvoiceDocument(invoice erpwire.Row, items []erpwire.Row, a erpwire.Actor, paid, credited money.Satang, today string) (PrintableDocument, error) {
	amountDue, e := amount(invoice["amount_satang"])
	if e != nil {
		return PrintableDocument{}, e
	}
	owed := outstanding(amountDue, paid, credited)
	doc := PrintableDocument{Kind: "Invoice", Number: displayNumber(invoice), Status: status(invoice, paid, credited, today), OrgName: a.OrgName(), ClientName: text(object(invoice["clients"])["name"]), IssueDate: ptrDocumentText(invoice["issue_date"]), DueDate: ptrDocumentText(invoice["due_date"]), Notes: ptrDocumentText(invoice["notes"]), Items: []DocLineItem{}, VATByRate: []erpwire.Row{}, AmountDueSatang: amountDue, VerifiedPaidSatang: &paid, CreditedSatang: credited, OutstandingSatang: &owed}
	if invoice["clients"] == nil || object(invoice["clients"])["name"] == nil {
		doc.ClientName = "—"
	}
	doc.DiscountSatang, e = amount(invoice["discount_satang"])
	if e != nil {
		return PrintableDocument{}, e
	}
	for _, field := range []struct {
		key    string
		target *money.Satang
	}{{"vat_satang", &doc.VATSatang}, {"wht_satang", &doc.WHTSatang}} {
		if invoice[field.key] != nil {
			value, e := amount(invoice[field.key])
			if e != nil {
				return PrintableDocument{}, e
			}
			*field.target = value
		}
	}
	wht := int64(0)
	if invoice["wht_rate_bps"] != nil {
		wht, e = integer(invoice["wht_rate_bps"])
		if e != nil {
			return PrintableDocument{}, e
		}
	}
	doc.WHTRateBps = json.Number(strconv.FormatInt(wht, 10))
	doc.PricesIncludeVAT, _ = invoice["prices_include_vat"].(bool)
	for _, row := range items {
		quantity, ok := documentNumber(row["quantity"])
		if !ok {
			if value, ok := row["quantity"].(string); ok {
				quantity = json.Number(value)
			} else {
				return PrintableDocument{}, errInvoiceSnapshot
			}
		}
		if _, ok := new(big.Rat).SetString(quantity.String()); !ok {
			return PrintableDocument{}, errInvoiceSnapshot
		}
		price, e := amount(row["unit_price_satang"])
		if e != nil {
			return PrintableDocument{}, e
		}
		value, e := amount(row["amount_satang"])
		if e != nil {
			return PrintableDocument{}, e
		}
		doc.Items = append(doc.Items, DocLineItem{text(row["description"]), quantity, ptrDocumentText(row["unit"]), price, value})
	}
	if len(doc.Items) == 0 {
		var subtotal money.Satang
		if invoice["subtotal_satang"] != nil {
			subtotal, e = amount(invoice["subtotal_satang"])
		} else {
			subtotal, e = sum(amountDue, doc.DiscountSatang)
		}
		if e != nil {
			return PrintableDocument{}, e
		}
		description := text(invoice["notes"])
		if description == "" {
			description = "Services"
		}
		doc.Items = append(doc.Items, DocLineItem{Description: description, Quantity: "1", UnitPriceSatang: subtotal, AmountSatang: subtotal})
	}
	if invoice["subtotal_satang"] != nil {
		doc.SubtotalSatang, e = amount(invoice["subtotal_satang"])
		if e != nil {
			return PrintableDocument{}, e
		}
	} else {
		for _, item := range doc.Items {
			doc.SubtotalSatang, e = sum(doc.SubtotalSatang, item.AmountSatang)
			if e != nil {
				return PrintableDocument{}, e
			}
		}
	}
	doc.TotalSatang = amountDue
	if invoice["total_satang"] != nil {
		doc.TotalSatang, e = amount(invoice["total_satang"])
		if e != nil {
			return PrintableDocument{}, e
		}
	}
	if invoice["tax_breakdown"] != nil {
		buckets, e := snapshotRows(invoice, "tax_breakdown", false)
		if e != nil {
			return PrintableDocument{}, e
		}
		for _, bucket := range buckets {
			rate, ok := documentNumber(bucket["rateBps"])
			if !ok {
				return PrintableDocument{}, errInvoiceSnapshot
			}
			vat, e := amount(bucket["vatSatang"])
			if e != nil {
				return PrintableDocument{}, e
			}
			doc.VATByRate = append(doc.VATByRate, erpwire.Row{"rateBps": rate, "vatSatang": vat})
		}
	}
	return doc, nil
}

func (s *Service) invoiceWHT(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	id, _, e := routeArgs(raw)
	if e != nil {
		return nil, e
	}
	if !validID(id) {
		return documentRoute(404, "Invoice not found"), nil
	}
	var snapshot any
	unavailable := ""
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		invoice, e := one(ctx, tx, erpwire.Select{Table: "invoices", Columns: []string{"id", "issued_snapshot_id"}, Where: scoped(a, id)})
		if e != nil {
			unavailable = "Withholding certificate unavailable"
			return e
		}
		if text(invoice["issued_snapshot_id"]) == "" {
			unavailable = "Issue the operational invoice before drafting a withholding certificate"
			return erpwire.ErrNotFound
		}
		stored, e := one(ctx, tx, erpwire.Select{Table: "invoice_snapshots", Columns: []string{"snapshot"}, Where: append(scope(a), eq("invoice_id", id), eq("id", invoice["issued_snapshot_id"]))})
		if e != nil || stored == nil {
			unavailable = "Issued document unavailable"
			if e != nil {
				return e
			}
			return errors.New(unavailable)
		}
		snapshot = stored["snapshot"]
		return nil
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		code := 503
		if errors.Is(e, erpwire.ErrNotFound) {
			code = 404
		}
		return documentRoute(code, unavailable), nil
	}
	parsed, e := parseIssuedSnapshot(snapshot, "issued", 0, 0, false)
	if e != nil {
		return documentRoute(503, e.Error()), nil
	}
	if parsed.legacy {
		return documentRoute(404, "A legacy record has no priced lines to draft a withholding certificate"), nil
	}
	if parsed.totals.WHTSatang != parsed.doc.WHTSatang {
		return documentRoute(503, "Issued withholding does not match the snapshot"), nil
	}
	if parsed.totals.WHTSatang <= 0 {
		return documentRoute(404, "No withholding to certify"), nil
	}
	wht, _ := strconv.ParseInt(parsed.doc.WHTRateBps.String(), 10, 64)
	draft := WHTCertificateDraft{Reference: parsed.doc.Number, IssueDate: parsed.doc.IssueDate, PayerName: parsed.doc.ClientName, PayerAddress: parsed.doc.BuyerAddress, PayerTaxID: parsed.doc.BuyerTaxID, PayeeName: parsed.doc.OrgName, PayeeAddress: parsed.doc.SellerAddress, PayeeTaxID: parsed.doc.SellerTaxID, Income: strings.Join(parsed.descriptions, "; "), BaseSatang: parsed.totals.BaseSatang, WHTSatang: parsed.totals.WHTSatang, WHTRateBps: wht, Banner: "DRAFT / ร่าง — ไม่ใช่แบบของกรมสรรพากร และไม่ใช่หนังสือรับรองตามกฎหมาย ผู้จ่ายเงินเป็นผู้ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย เอกสารนี้คัดจากใบแจ้งหนี้เพื่อการดำเนินงาน", Title: "ร่างหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)", IncomeClassificationNote: "ประเภทเงินได้และแบบ ภ.ง.ด. ไม่ได้ถูกเลือกที่นี่"}
	return s.renderDocument(ctx, DocumentModel{WHT: &draft}, true)
}

func (s *Service) creditNotePDF(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if e := authenticate(a); e != nil {
		return nil, e
	}
	id, _, e := routeArgs(raw)
	if e != nil {
		return nil, e
	}
	if !validID(id) {
		return documentRoute(400, "Invalid credit note"), nil
	}
	var row erpwire.Row
	e = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		row, err = one(ctx, tx, erpwire.Select{Table: "credit_notes", Columns: []string{"snapshot"}, Where: scoped(a, id)})
		return err
	})
	if e != nil {
		if canonical(e) {
			return nil, e
		}
		return documentRoute(503, "Credit note unavailable"), nil
	}
	if row == nil {
		return documentRoute(404, "Credit note not found"), nil
	}
	doc, e := parseCreditDocument(row["snapshot"])
	if e != nil {
		return documentRoute(503, "Invalid credit note snapshot"), nil
	}
	return s.renderDocument(ctx, DocumentModel{Document: &doc}, false)
}

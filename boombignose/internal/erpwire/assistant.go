package erpwire

import (
	"context"
	"encoding/json"
	"time"
)

type Label struct {
	English string `json:"en"`
	Thai    string `json:"th"`
}

type SourceFact struct {
	ID             string `json:"id"`
	Label          Label  `json:"label"`
	Value          string `json:"value"`
	Scope          string `json:"scope"`
	Href           string `json:"href,omitempty"`
	RecordPresence string `json:"recordPresence,omitempty"`
}

type SourceRecord struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

type Coverage struct {
	FactIDs []string `json:"factIds"`
	Partial bool     `json:"partial"`
}

type AssistantSource struct {
	ID              string         `json:"id"`
	Kind            string         `json:"kind"`
	Label           string         `json:"label"`
	Href            string         `json:"href,omitempty"`
	Entity          string         `json:"entity,omitempty"`
	RecordIDs       []string       `json:"recordIds,omitempty"`
	ObservedAt      time.Time      `json:"observedAt"`
	Total           *int64         `json:"total,omitempty"`
	Returned        *int64         `json:"returned,omitempty"`
	Coverage        *Coverage      `json:"coverage,omitempty"`
	RequiredFactIDs []string       `json:"requiredFactIds,omitempty"`
	Partial         bool           `json:"partial"`
	TextSHA256      string         `json:"textSha256,omitempty"`
	Records         []SourceRecord `json:"records"`
	Facts           []SourceFact   `json:"facts"`
}

type Quote struct {
	SourceID string `json:"sourceId"`
	Text     string `json:"text"`
}

type Finding struct {
	Text      string   `json:"text"`
	SourceIDs []string `json:"sourceIds"`
	FactIDs   []string `json:"factIds"`
	Quotes    []Quote  `json:"quotes"`
}

// AssistantAnswer is produced only AFTER independent source/fact membership,
// exact-quote, allowed-action, numeric-prose and scope validation. ERP figures
// and task wording come from application-owned sources/templates, not a model's
// unaudited arithmetic or instructions. Every task awaits human review.
type AssistantAnswer struct {
	Kind        string    `json:"kind"`
	Summary     string    `json:"summary"`
	Findings    []Finding `json:"findings"`
	FactIDs     []string  `json:"factIds"`
	NextActions []string  `json:"nextActions"`
	Limitations []string  `json:"limitations"`
}

type ReviewTask struct {
	Action    string   `json:"action"`
	SourceIDs []string `json:"sourceIds"`
	FactIDs   []string `json:"factIds"`
	Quotes    []Quote  `json:"quotes"`
}

type ReviewPlan struct {
	Language string       `json:"language"`
	FactIDs  []string     `json:"factIds"`
	Tasks    []ReviewTask `json:"tasks"`
}

type ToolSpec struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type ToolCatalog struct {
	Tools       []ToolSpec
	Unavailable []string
}

// ReadText contains ONLY text actually retrieved, not the unread original or
// a list/search preview. The assistant hashes these exact visible UTF-8 bytes.
// Partial/range attribution must survive redaction, OCR and continuation reads.
type ReadText struct {
	Label      string
	Text       string
	Partial    bool
	ObservedAt time.Time
}

// Evidence is an application-owned source projection. Key is a stable
// request-local identity for deduplicating the SAME observed data. The assistant
// assigns source IDs and prefixes local fact keys (Source.Facts[*].ID and the
// coverage/required lists) together; a tool must not supply final source IDs.
// ReadText is present only for an actually read document range. Catalog/list
// metadata is not evidence that business records or document text were read.
type Evidence struct {
	Key      string
	Source   AssistantSource
	ReadText *ReadText
}

type ToolResult struct {
	Content      json.RawMessage
	Evidence     []Evidence
	Limitations  []string
	Total        *int64
	MetadataOnly bool
}

// ToolRunner exposes authorized READ tools only. Implementations must bind the
// supplied Actor, reject org/role/SQL overrides, gate canonical capabilities,
// enforce table/field allowlists and use ReadStore (never Store.Write).
// Every Call is reauthorized; failure is an error, not a fabricated empty set.
type ToolRunner interface {
	Specs(context.Context, Actor) (ToolCatalog, error)
	Call(context.Context, Actor, string, json.RawMessage) (ToolResult, error)
}

// DocumentReader reauthorizes the attachment's parent record on EVERY call,
// checks the immutable original's hash, and reads native local bytes without
// arbitrary paths/URLs. Text is full UTF-8 (including an original BOM). OCR must
// retain model/warnings/partial state and never auto-approve financial data.
type DocumentReader interface {
	ReadDocument(context.Context, Actor, string) (DocumentText, error)
}

type DocumentText struct {
	Filename       string
	MediaType      string
	Text           string
	OriginalSHA256 string
	Model          string
	Warnings       []string
	Partial        bool
	ObservedAt     time.Time
}

type ChatScope string

const (
	ERPDataScope  ChatScope = "erp"
	GuidanceScope ChatScope = "guidance"
)

type ChatAttachment struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	MediaType string `json:"mediaType,omitempty"`
	Base64    string `json:"base64,omitempty"`
	Text      string `json:"text,omitempty"`
}

type ChatMessage struct {
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Attachments []ChatAttachment `json:"attachments,omitempty"`
}

type ChatRequest struct {
	Messages  []ChatMessage `json:"messages"`
	DataScope ChatScope     `json:"dataScope"`
}

type ToolCall struct {
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Total *int64 `json:"total,omitempty"`
}

type ChatReply struct {
	Reply     string            `json:"reply"`
	Answer    AssistantAnswer   `json:"answer"`
	Model     string            `json:"model"`
	ToolCalls []ToolCall        `json:"toolCalls"`
	Sources   []AssistantSource `json:"sources"`
}

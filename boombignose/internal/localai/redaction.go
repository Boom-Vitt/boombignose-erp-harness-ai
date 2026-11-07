package localai

import (
	"context"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// Redactor is trusted native/request policy, never a DTO or model tool. It must
// be concurrency-safe, deterministic and idempotent; return true when a secret
// was removed. The package additionally detects changed bytes independently.
// Redactors must not log their inputs or expose the protected values in errors.
type Redactor func(string) (string, bool)
type redactorContextKey struct{}

// WithRedactor adds per-request protection (for example the actual bearer)
// without constructing another provider or retaining credentials in Actor/JSON.
// Provider Config.Redact and this request-local callback are composed in order.
func WithRedactor(ctx context.Context, redact func(string) (string, bool)) context.Context {
	return context.WithValue(ctx, redactorContextKey{}, Redactor(redact))
}
func (p *Provider) hasRedactor(ctx context.Context) bool {
	if p.redactor != nil {
		return true
	}
	fn, _ := ctx.Value(redactorContextKey{}).(Redactor)
	return fn != nil
}
func (p *Provider) redact(ctx context.Context, text string) (string, bool) {
	changed := false
	if p.redactor != nil {
		next, flag := p.redactor(text)
		changed = flag || next != text
		text = next
	}
	if fn, ok := ctx.Value(redactorContextKey{}).(Redactor); ok && fn != nil {
		next, flag := fn(text)
		changed = changed || flag || next != text
		text = next
	}
	return text, changed
}

const redactionWarning = "Configured runtime secrets were removed from this source view. Text hashes identify the visible redacted range; original positions do not imply unredacted access."

// redactJSON walks parsed values rather than replacing serialized JSON. Text
// range identities are projected at the same time as their visible bytes; the
// original slice hash remains separate from the new visible quote-source hash.
func (p *Provider) redactJSON(ctx context.Context, value any) (any, bool) {
	switch v := value.(type) {
	case string:
		return p.redact(ctx, v)
	case []any:
		changed := false
		for i, x := range v {
			next, c := p.redactJSON(ctx, x)
			v[i] = next
			changed = changed || c
		}
		return v, changed
	case map[string]any:
		originalText, hasText := v["text"].(string)
		changed := false
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		for _, key := range keys {
			x, exists := v[key]
			if !exists {
				continue
			}
			next, c := p.redactJSON(ctx, x)
			visibleKey, keyChanged := p.redact(ctx, key)
			if keyChanged {
				delete(v, key)
				visibleKey = "[redacted-key-" + hashText(key) + "]"
			}
			v[visibleKey] = next
			changed = changed || c || keyChanged
		}
		if changed {
			v["redacted"] = true
			v["partial"] = true
			if hasText {
				if text, ok := v["text"].(string); ok && text != originalText {
					if _, exists := v["original_slice_sha256"]; !exists {
						v["original_slice_sha256"] = hashText(originalText)
					}
					v["text_sha256"] = hashText(text)
				}
			}
			if coverage, ok := v["coverage"].(map[string]any); ok {
				coverage["partial"] = true
				if _, exists := coverage["complete"]; exists {
					coverage["complete"] = false
				}
			}
			if coverage, ok := v["receivables_coverage"].(map[string]any); ok {
				coverage["partial"] = true
				coverage["redacted"] = true
			}
		}
		return v, changed
	default:
		return value, false
	}
}

type redactedRange struct {
	OriginalSliceSHA256 string `json:"original_slice_sha256"`
	TextSHA256          string `json:"text_sha256"`
	Partial             bool   `json:"partial"`
	Redacted            bool   `json:"redacted"`
}

func (p *Provider) redactTool(ctx context.Context, result erpwire.ToolResult, data any) (erpwire.ToolResult, any, map[string]redactedRange) {
	if !p.hasRedactor(ctx) {
		return result, data, nil
	}
	visible, dataChanged := p.redactJSON(ctx, data)
	ranges := map[string]redactedRange{}
	result.Evidence = append([]erpwire.Evidence{}, result.Evidence...)
	anyChanged := dataChanged
	for i := range result.Evidence {
		e := &result.Evidence[i]
		source := e.Source
		changed := false
		field := func(value *string) { next, c := p.redact(ctx, *value); *value = next; changed = changed || c }
		field(&source.Label)
		field(&source.Href)
		field(&source.Entity)
		source.RecordIDs = append([]string{}, source.RecordIDs...)
		for j := range source.RecordIDs {
			field(&source.RecordIDs[j])
		}
		source.RequiredFactIDs = append([]string{}, source.RequiredFactIDs...)
		for j := range source.RequiredFactIDs {
			field(&source.RequiredFactIDs[j])
		}
		if source.Coverage != nil {
			coverage := *source.Coverage
			coverage.FactIDs = append([]string{}, coverage.FactIDs...)
			for j := range coverage.FactIDs {
				field(&coverage.FactIDs[j])
			}
			source.Coverage = &coverage
		}
		source.Records = append([]erpwire.SourceRecord{}, source.Records...)
		for j := range source.Records {
			field(&source.Records[j].Label)
			field(&source.Records[j].Href)
		}
		source.Facts = append([]erpwire.SourceFact{}, source.Facts...)
		for j := range source.Facts {
			f := &source.Facts[j]
			field(&f.ID)
			field(&f.Label.English)
			field(&f.Label.Thai)
			field(&f.Value)
			field(&f.Href)
		}
		if e.ReadText != nil {
			read := *e.ReadText
			originalHash := hashText(read.Text)
			text, textChanged := p.redact(ctx, read.Text)
			label, labelChanged := p.redact(ctx, read.Label)
			read.Text = text
			read.Label = label
			if textChanged || labelChanged {
				changed = true
				read.Partial = true
				ranges[hashText(e.Key)] = redactedRange{OriginalSliceSHA256: originalHash, TextSHA256: hashText(text), Partial: true, Redacted: true}
				source.TextSHA256 = hashText(text)
			}
			e.ReadText = &read
		}
		if changed || dataChanged {
			source.Partial = true
			if source.Coverage != nil {
				coverage := *source.Coverage
				coverage.Partial = true
				source.Coverage = &coverage
			}
		}
		e.Source = source
		anyChanged = anyChanged || changed
	}
	result.Limitations = append([]string{}, result.Limitations...)
	for i := range result.Limitations {
		result.Limitations[i], _ = p.redact(ctx, result.Limitations[i])
	}
	if anyChanged {
		result.Limitations = append(result.Limitations, redactionWarning)
	}
	result.Content = jsonBytes(visible)
	return result, visible, ranges
}

func (p *Provider) redactMessages(ctx context.Context, messages []modelMessage) ([]modelMessage, bool) {
	if !p.hasRedactor(ctx) {
		return messages, false
	}
	var out []modelMessage
	for i, message := range messages {
		// Tool JSON was structurally sanitized together with its source hashes.
		// Never raw-replace its serialized envelope and leave stale identities.
		if message.Role == "tool" {
			continue
		}
		text, changed := p.redact(ctx, message.Content)
		if !changed {
			continue
		}
		if out == nil {
			out = append([]modelMessage{}, messages...)
		}
		out[i].Content = text
	}
	if out == nil {
		return messages, false
	}
	return out, true
}
func noSensitiveOutput(p *Provider, ctx context.Context, text string) bool {
	_, changed := p.redact(ctx, text)
	return !changed
}

// Redactors operate on text, never on raster pixels or opaque image base64.
// Existing OCR treats pixels as untrusted local input; these functions do not
// claim to visually detect or remove secrets from an authorized original image.

func (p *Provider) hasProtectedValue(ctx context.Context, value any) bool {
	if !p.hasRedactor(ctx) {
		return false
	}
	switch v := value.(type) {
	case string:
		_, changed := p.redact(ctx, v)
		return changed
	case []string:
		for _, x := range v {
			if p.hasProtectedValue(ctx, x) {
				return true
			}
		}
	case []any:
		for _, x := range v {
			if p.hasProtectedValue(ctx, x) {
				return true
			}
		}
	case map[string]any:
		for key, x := range v {
			if p.hasProtectedValue(ctx, key) || p.hasProtectedValue(ctx, x) {
				return true
			}
		}
	}
	return false
}

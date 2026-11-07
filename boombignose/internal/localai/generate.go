package localai

import (
	"context"
	"unicode/utf8"
)

// GenerateText ports the existing internal one-shot client for server-authored
// draft prompts. It is NOT a public chat endpoint or an evidence-certified ERP
// answer. The caller owns authentication, business-domain parsing and explicit
// human review; raw generation cannot authorize or perform a record write. Use
// Service.Chat for the independently source-grounded browser answer contract.
// Zero maxTokens uses the existing default of 1024. There is no second model,
// service, retry, download or fallback: this uses the same provider/gate/redactor
// and requires the same GGUF chat/context preflight as full conversation chat.
func (p *Provider) GenerateText(ctx context.Context, system, prompt string, maxTokens int) (string, error) {
	if maxTokens == 0 {
		maxTokens = 1024
	}
	if maxTokens < 1 || maxTokens > 8192 {
		return "", problem(400, "invalid_request", "Choose a bounded draft output limit between 1 and 8192 tokens.")
	}
	if !utf8.ValidString(system) || !utf8.ValidString(prompt) || len(system)+len(prompt) > ChatBodyBytes {
		return "", problem(413, "invalid_request", "The draft prompt is invalid UTF-8 or exceeds the local transport bound.")
	}
	return p.inferWithLimit(ctx, p.chatModel, []modelMessage{{Role: "system", Content: system}, {Role: "user", Content: prompt}}, nil, false, false, maxTokens)
}

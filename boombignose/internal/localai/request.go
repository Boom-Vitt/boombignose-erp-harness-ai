package localai

import (
	"context"
	"encoding/base64"
	"io"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

const ChatBodyBytes = 14_000_000

// DecodeChatRequest bounds and strictly parses the browser's JSON body. The
// router is still responsible for authenticated origin/CSRF enforcement.
func DecodeChatRequest(reader io.Reader) (erpwire.ChatRequest, error) {
	b, err := boundedRead(reader, ChatBodyBytes)
	if err != nil {
		return erpwire.ChatRequest{}, problem(413, "invalid_request", "Chat body is invalid or exceeds the transport byte limit.")
	}
	var request erpwire.ChatRequest
	if strictJSON(b, &request) != nil {
		return erpwire.ChatRequest{}, problem(400, "invalid_request", "Invalid chat request JSON.")
	}
	return normalizeRequest(request)
}

var attachmentBase64 = regexp.MustCompile(`^[A-Za-z0-9+/]+={0,2}$`)

func normalizeRequest(request erpwire.ChatRequest) (erpwire.ChatRequest, error) {
	invalid := func(message string) (erpwire.ChatRequest, error) {
		return erpwire.ChatRequest{}, problem(400, "invalid_request", message)
	}
	if request.DataScope == "" {
		request.DataScope = erpwire.ERPDataScope
	}
	if request.DataScope != erpwire.ERPDataScope && request.DataScope != erpwire.GuidanceScope {
		return invalid("Choose ERP records or guidance/document review.")
	}
	if len(request.Messages) < 1 || len(request.Messages) > 40 {
		return invalid("Send between 1 and 40 messages.")
	}
	if len(jsonBytes(request)) > ChatBodyBytes {
		return erpwire.ChatRequest{}, problem(413, "invalid_request", "Chat body exceeds the transport byte limit.")
	}
	messages := make([]erpwire.ChatMessage, 0, len(request.Messages))
	for _, m := range request.Messages {
		maxChars := 8000
		if m.Role == "assistant" {
			maxChars = 64000
		}
		if (m.Role != "user" && m.Role != "assistant") || !utf8.ValidString(m.Content) || utf16Length(m.Content) > maxChars {
			return invalid("Bad message.")
		}
		if len(m.Attachments) > 4 || (m.Role != "user" && len(m.Attachments) > 0) {
			return invalid("Too many attachments, or attachments on a reply.")
		}
		attachments := make([]erpwire.ChatAttachment, 0, len(m.Attachments))
		for _, a := range m.Attachments {
			if !utf8.ValidString(a.Name) {
				return invalid("Invalid attachment name.")
			}
			a.Name = safeName(a.Name)
			switch a.Kind {
			case "text":
				if !utf8.ValidString(a.Text) || len(a.Text) > 200000 || strings.ContainsRune(a.Text, 0) {
					return invalid("Text attachments must be UTF-8 plain text up to 200 KB.")
				}
				a = erpwire.ChatAttachment{Kind: "text", Name: a.Name, Text: a.Text}
			case "image":
				b64 := strings.Map(func(r rune) rune {
					if unicode.IsSpace(r) {
						return -1
					}
					return r
				}, a.Base64)
				if len(b64) < 16 || len(b64) > 2800000 || !attachmentBase64.MatchString(b64) {
					return invalid("An image exceeds the accepted encoded size or is not base64.")
				}
				b, err := base64.RawStdEncoding.DecodeString(strings.TrimRight(b64, "="))
				if err != nil {
					return invalid("The image is not valid base64.")
				}
				mime := imageMIME(b)
				if mime == "" {
					return invalid("Only PNG, JPEG and WebP image attachments are accepted.")
				}
				a = erpwire.ChatAttachment{Kind: "image", Name: a.Name, MediaType: mime, Base64: base64.StdEncoding.EncodeToString(b)}
			default:
				return invalid("Attach an accepted image or text. PDFs must use the browser's local PDF.js OCR workflow.")
			}
			attachments = append(attachments, a)
		}
		if strings.TrimSpace(m.Content) == "" && len(attachments) == 0 {
			return invalid("A message needs text or an attachment.")
		}
		messages = append(messages, erpwire.ChatMessage{Role: m.Role, Content: m.Content, Attachments: attachments})
	}
	if messages[len(messages)-1].Role != "user" {
		return invalid("The last message must be from you.")
	}
	request.Messages = messages
	return request, nil
}
func (p *Provider) validateLatestImages(ctx context.Context, request erpwire.ChatRequest) error {
	for _, a := range request.Messages[len(request.Messages)-1].Attachments {
		if a.Kind == "image" {
			b, err := base64.StdEncoding.DecodeString(a.Base64)
			if err != nil {
				return problem(400, "invalid_request", "Invalid image base64.")
			}
			if err = p.ValidateRaster(ctx, b, a.MediaType); err != nil {
				return err
			}
		}
	}
	return nil
}

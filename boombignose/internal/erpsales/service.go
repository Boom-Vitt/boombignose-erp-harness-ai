// Package erpsales ports sales, purchasing, catalogue and stock operations.
// Store implementations enforce live identity, tenant scope and database grants.
package erpsales

import (
	"context"
	"errors"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

// PDFRenderer renders the source printable document model. Existing /pdf routes
// serve printable HTML, so adapters must return HTML bytes rather than change MIME.
type PDFRenderer interface {
	RenderPDF(context.Context, string, erpwire.Row) ([]byte, error)
}

type EmailMessage struct{ To, Subject, HTML, IdempotencyKey string }
type EmailResult struct {
	OK                               bool
	Reason, Error, ProviderMessageID string
}
type EmailSender interface {
	Configured() bool
	SendEmail(context.Context, EmailMessage) (EmailResult, error)
}
type Options struct {
	Store       erpwire.Store
	PDFRenderer PDFRenderer
	EmailSender EmailSender
	AppURL      string
}
type Service struct {
	store  erpwire.Store
	pdf    PDFRenderer
	mail   EmailSender
	appURL string
}
type RouteResponse struct {
	Status  int
	Headers map[string]string
	Body    []byte
}

func New(o Options) (*Service, error) {
	if o.Store == nil {
		return nil, errors.New("sales store is required")
	}
	return &Service{store: o.Store, pdf: o.PDFRenderer, mail: o.EmailSender, appURL: o.AppURL}, nil
}
func (s *Service) Operations() map[string]erpwire.Operation {
	ops := map[string]erpwire.Operation{
		"lib/line-grid/actions.ts::saveDocumentLines":        s.saveDocumentLines,
		"app/(app)/quotes/actions.ts::createQuote":           s.createQuote,
		"app/(app)/quotes/actions.ts::updateQuote":           s.updateQuote,
		"app/(app)/quotes/actions.ts::deleteQuote":           s.deleteQuote,
		"app/(app)/quotes/actions.ts::setQuoteStatus":        s.setQuoteStatus,
		"app/(app)/quotes/actions.ts::convertQuoteToInvoice": s.convertQuoteToInvoice,
		"app/(app)/quotes/actions.ts::cancelQuoteInvoice":    s.cancelQuoteInvoice,
		"app/(app)/quotes/email-actions.ts::sendQuoteEmail":  s.sendQuoteEmail,
		"app/(app)/quotes/page.tsx::load":                    s.quotesPage,
		"app/(app)/quotes/new/page.tsx::load":                s.quoteNewPage,
		"app/(app)/quotes/[id]/page.tsx::load":               s.quotePage,
		"app/(app)/quotes/[id]/pdf/route.ts::GET":            s.quotePDF,
		"app/(app)/templates/actions.ts::createTemplate":     s.createTemplate,
		"app/(app)/templates/actions.ts::updateTemplate":     s.updateTemplate,
		"app/(app)/templates/actions.ts::deleteTemplate":     s.deleteTemplate,
		"app/(app)/templates/actions.ts::createCategory":     s.createCategory,
		"app/(app)/templates/page.tsx::load":                 s.templatesPage,
		"app/(app)/templates/new/page.tsx::load":             s.templateNewPage,
		"app/(app)/templates/[id]/page.tsx::load":            s.templatePage,
		"app/(app)/templates/[id]/edit/page.tsx::load":       s.templateEditPage,
	}
	for _, group := range []map[string]erpwire.Operation{s.purchaseVendorOperations(), s.inventoryProductOperations()} {
		for key, op := range group {
			if _, exists := ops[key]; exists {
				panic("duplicate sales operation " + key)
			}
			ops[key] = op
		}
	}
	return ops
}

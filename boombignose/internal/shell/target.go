// Package shell records where a desktop window may load the ERP.
// Milestone 1 loads this URL in a webview. This package does not open a window.
package shell

import "github.com/Boom-Vitt/nose-erp/boombignose/internal/policy"

// DefaultERPURL is the loopback address the BoomBigNose window opens.
const DefaultERPURL = "http://127.0.0.1:3100"

// ERPURL returns raw when it is an allowed local URL. An empty raw value
// selects DefaultERPURL. A non-local raw value is refused.
func ERPURL(raw string) (string, error) {
	if raw == "" {
		return DefaultERPURL, nil
	}
	if err := policy.AllowEndpoint(raw); err != nil {
		return "", err
	}
	return raw, nil
}

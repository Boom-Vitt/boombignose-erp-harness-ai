// Package nav builds the one script the desktop window runs before the ERP
// page replaces it. The script navigates the top-level webview, so the ERP
// origin owns the cookie jar. It is not a reverse proxy.
package nav

import (
	"encoding/json"
	"fmt"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

// Script returns a window.location.replace call for a loopback ERP URL.
// Any other target is refused, and the raw value is not copied into the error.
func Script(target string) (string, error) {
	if err := policy.AllowEndpoint(target); err != nil {
		return "", fmt.Errorf("erp url: %w", err)
	}
	quoted, err := json.Marshal(target)
	if err != nil {
		return "", err
	}
	return "window.location.replace(" + string(quoted) + ")", nil
}

// BootFailure returns a script that writes message onto the splash and does
// not navigate. It adds a retry hint. The splash page may define
// window.bbnBootFailed to style the message; otherwise #boot-status is used.
// The message is JSON-encoded so it cannot close the script.
func BootFailure(message string) (string, error) {
	quoted, err := json.Marshal(message)
	if err != nil {
		return "", err
	}
	return `var m="เปิด ERP ไม่สำเร็จ "+` + string(quoted) + `+" ลองใหม่โดยปิดแล้วเปิดแอปอีกครั้ง"; if(window.bbnBootFailed){window.bbnBootFailed(m);}else{var el=document.getElementById("boot-status"); if(el){el.textContent=m;}}`, nil
}

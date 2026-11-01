package shell

import (
	"fmt"
	"net/url"
	"path"
	"strings"
)

// FinanceScreen is a Next.js route the desktop window reaches after it
// opens the local ERP. These screens are the month-end close product.
// The brochure in site/ does not serve them.
type FinanceScreen struct {
	Path string
	Name string
}

// FinanceScreens are paths on the loopback Next server. The Wails window
// loads DefaultERPURL, then the operator uses these routes in that origin.
var FinanceScreens = []FinanceScreen{
	{Path: "/finance", Name: "Finance"},
	{Path: "/finance/bank", Name: "Bank lines"},
	{Path: "/finance/cash", Name: "Cash at close"},
	{Path: "/reports#month-end-close", Name: "Month-end close checklist"},
	{Path: "/reports/statements", Name: "Statements, VAT, and aging"},
	{Path: "/reports/accountant-pack", Name: "Accountant pack"},
	{Path: "/import", Name: "Sheet import"},
	{Path: "/settings", Name: "Settings and local backup"},
}

// ScreenURL joins a local ERP origin with one in-app path. A brochure host,
// a remote origin, or a path that leaves the ERP is refused.
func ScreenURL(base, screenPath string) (string, error) {
	root, err := ERPURL(base)
	if err != nil {
		return "", err
	}
	if screenPath == "" || strings.Contains(screenPath, "://") || strings.HasPrefix(screenPath, "//") {
		return "", fmt.Errorf("screen path must stay on the local ERP")
	}
	ref, err := url.Parse(screenPath)
	if err != nil || ref.IsAbs() || ref.Host != "" || !strings.HasPrefix(ref.Path, "/") {
		return "", fmt.Errorf("screen path must stay on the local ERP")
	}
	cleaned := path.Clean(ref.Path)
	if !strings.HasPrefix(cleaned, "/") || strings.HasPrefix(cleaned, "/site") || cleaned == "/." {
		return "", fmt.Errorf("screen path must stay on the local ERP")
	}
	u, err := url.Parse(root)
	if err != nil {
		return "", err
	}
	u.Path = cleaned
	u.RawQuery = ref.RawQuery
	u.Fragment = ref.Fragment
	return u.String(), nil
}

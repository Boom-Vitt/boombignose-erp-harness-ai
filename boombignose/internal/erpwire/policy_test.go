package erpwire

import (
	"errors"
	"math"
	"testing"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

func TestFinanceRoleDoesNotAcquireWorkspaceOrReversalAuthority(t *testing.T) {
	for _, capability := range []Capability{"record:write", "payment:verify", "audit:view", "profit:view"} {
		if !Can(Accountant, capability) {
			t.Fatalf("accountant cannot perform finance operation %q", capability)
		}
	}
	for _, capability := range []Capability{"settings:manage", "team:manage", "invoice:delete", "purchase:approve", "expense:approve"} {
		if Can(Accountant, capability) {
			t.Fatalf("accountant acquired privileged operation %q", capability)
		}
		if !Can(Owner, capability) || !Can(Admin, capability) {
			t.Fatalf("workspace administrators cannot perform %q", capability)
		}
	}
	for _, role := range []Role{"", "service_role", "OWNER"} {
		if Can(role, "record:write") || role.Valid() {
			t.Fatalf("unknown role acquired authority: %q", role)
		}
	}
}

func TestSatangRejectsLossyBrowserBoundaryWithoutOverflow(t *testing.T) {
	for _, value := range []int64{0, 1, -1, MaxSafeInteger, -MaxSafeInteger} {
		if err := ValidateSatang(money.Satang(value)); err != nil {
			t.Fatalf("exact amount %d rejected: %v", value, err)
		}
	}
	for _, value := range []int64{MaxSafeInteger + 1, -MaxSafeInteger - 1, math.MaxInt64, math.MinInt64} {
		if err := ValidateSatang(money.Satang(value)); !errors.Is(err, ErrUnsafeAmount) {
			t.Fatalf("lossy/overflowing amount %d accepted: %v", value, err)
		}
	}
}

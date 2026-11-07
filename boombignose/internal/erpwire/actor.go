package erpwire

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrUnauthenticated = errors.New("authentication required")
	ErrForbidden       = errors.New("operation not permitted")
	ErrStepUpRequired  = errors.New("verified multi-factor session required")
	ErrAuthUnavailable = errors.New("authentication assurance unavailable")
	ErrIdentityChanged = errors.New("workspace membership or identity changed")
	ErrNotFound        = errors.New("record not found")
)

type Assurance string

const (
	AAL1 Assurance = "aal1"
	AAL2 Assurance = "aal2"
)

// VerifiedIdentity is produced only by live authentication of the SAME bearer
// token whose claims supply subject, assurance and expiry. Decoded JWT payloads,
// request JSON, browser role flags and model output are not verified identities.
// FactorStateKnown is true only after a successful live factor-state read.
// No bearer token or provider/admin credential belongs in this public contract.
type VerifiedIdentity struct {
	UserID            string
	Email             string
	Assurance         Assurance
	ExpiresAt         time.Time
	FactorStateKnown  bool
	HasVerifiedFactor bool
}

// Membership comes from a live, RLS-bound database lookup, never a client-supplied
// role or org name. Its user must match the authenticated subject.
type Membership struct {
	UserID  string
	OrgID   string
	OrgName string
	Role    Role
}

// Actor is request authority, not a DTO: its private fields cannot be populated
// by JSON decoding. A zero Actor cannot authorize ERP reads or writes.
// Stores must recheck identity expiry, live membership/role and MFA before each
// transaction, including a later tool call in the same long-running AI request.
type Actor struct {
	userID            string
	email             string
	orgID             string
	orgName           string
	role              Role
	assurance         Assurance
	expiresAt         time.Time
	hasVerifiedFactor bool
	operator          bool
}

// BindActor is called after live provider authentication and active-workspace
// membership verification. machineOperator is resolved separately from trusted
// native operator configuration; being a workspace owner does not grant it.
func BindActor(identity VerifiedIdentity, membership Membership, machineOperator bool, now time.Time) (Actor, error) {
	if uuid.Validate(identity.UserID) != nil || identity.ExpiresAt.IsZero() || !now.Before(identity.ExpiresAt) {
		return Actor{}, ErrUnauthenticated
	}
	if !identity.FactorStateKnown || (identity.Assurance != AAL1 && identity.Assurance != AAL2) {
		return Actor{}, ErrAuthUnavailable
	}
	if identity.HasVerifiedFactor && identity.Assurance != AAL2 {
		return Actor{}, ErrStepUpRequired
	}
	if membership.UserID != identity.UserID || uuid.Validate(membership.OrgID) != nil || !membership.Role.Valid() {
		return Actor{}, ErrForbidden
	}
	return Actor{
		userID: identity.UserID, email: identity.Email,
		orgID: membership.OrgID, orgName: membership.OrgName, role: membership.Role,
		assurance: identity.Assurance, expiresAt: identity.ExpiresAt,
		hasVerifiedFactor: identity.HasVerifiedFactor, operator: machineOperator,
	}, nil
}

func (a Actor) UserID() string          { return a.userID }
func (a Actor) Email() string           { return a.email }
func (a Actor) OrgID() string           { return a.orgID }
func (a Actor) OrgName() string         { return a.orgName }
func (a Actor) Role() Role              { return a.role }
func (a Actor) HasVerifiedFactor() bool { return a.hasVerifiedFactor }
func (a Actor) Assurance() Assurance    { return a.assurance }
func (a Actor) Operator() bool          { return a.operator }
func (a Actor) ExpiresAt() time.Time    { return a.expiresAt }

// Validate checks the immutable binding, not live membership revocation. The
// authenticated store must check the latter again inside each transaction.
func (a Actor) Validate(now time.Time) error {
	if a.userID == "" || a.orgID == "" || !a.role.Valid() || !now.Before(a.expiresAt) {
		return ErrUnauthenticated
	}
	if a.hasVerifiedFactor && a.assurance != AAL2 {
		return ErrStepUpRequired
	}
	return nil
}

// Authorize treats an empty capability as an ordinary authenticated workspace
// operation. A nonempty unknown capability fails closed.
func (a Actor) Authorize(capability Capability, now time.Time) error {
	if err := a.Validate(now); err != nil {
		return err
	}
	if capability != "" && !Can(a.role, capability) {
		return ErrForbidden
	}
	return nil
}

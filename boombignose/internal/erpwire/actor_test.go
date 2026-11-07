package erpwire

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

var actorTestNow = time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

func actorTestIdentity() VerifiedIdentity {
	return VerifiedIdentity{
		UserID:    "11111111-1111-4111-8111-111111111111",
		Assurance: AAL1, ExpiresAt: actorTestNow.Add(time.Hour), FactorStateKnown: true,
	}
}

func actorTestMembership() Membership {
	return Membership{
		UserID: "11111111-1111-4111-8111-111111111111",
		OrgID:  "22222222-2222-4222-8222-222222222222", Role: Member,
	}
}

func TestActorCannotAcquireAuthorityFromRequestJSON(t *testing.T) {
	var actor Actor
	if err := json.Unmarshal([]byte(`{"userID":"11111111-1111-4111-8111-111111111111","orgID":"22222222-2222-4222-8222-222222222222","role":"owner","operator":true}`), &actor); err != nil {
		t.Fatal(err)
	}
	if err := actor.Authorize("settings:manage", actorTestNow); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("forged actor acquired authority: %v", err)
	}
	if actor.Operator() {
		t.Fatal("request JSON granted machine operator authority")
	}
}

func TestBindActorRejectsWrongWorkspaceIdentityAndUnknownRole(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*Membership)
	}{
		{"different user", func(m *Membership) { m.UserID = "33333333-3333-4333-8333-333333333333" }},
		{"invalid workspace", func(m *Membership) { m.OrgID = "not-an-org" }},
		{"unknown role", func(m *Membership) { m.Role = "service_role" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			membership := actorTestMembership()
			test.edit(&membership)
			_, err := BindActor(actorTestIdentity(), membership, false, actorTestNow)
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("untrusted membership accepted: %v", err)
			}
		})
	}
}

func TestBindActorFailsClosedWhenAssuranceCannotBeEstablished(t *testing.T) {
	for _, test := range []struct {
		name string
		edit func(*VerifiedIdentity)
		want error
	}{
		{"unknown factors", func(i *VerifiedIdentity) { i.FactorStateKnown = false }, ErrAuthUnavailable},
		{"unknown assurance", func(i *VerifiedIdentity) { i.Assurance = "aal3" }, ErrAuthUnavailable},
		{"verified factor needs step-up", func(i *VerifiedIdentity) { i.HasVerifiedFactor = true }, ErrStepUpRequired},
		{"expired exactly now", func(i *VerifiedIdentity) { i.ExpiresAt = actorTestNow }, ErrUnauthenticated},
		{"no expiry", func(i *VerifiedIdentity) { i.ExpiresAt = time.Time{} }, ErrUnauthenticated},
	} {
		t.Run(test.name, func(t *testing.T) {
			identity := actorTestIdentity()
			test.edit(&identity)
			_, err := BindActor(identity, actorTestMembership(), false, actorTestNow)
			if !errors.Is(err, test.want) {
				t.Fatalf("assurance bypass: got %v, want %v", err, test.want)
			}
		})
	}
}

func TestActorPreservesMemberScopeAndExpiresDuringLongRequests(t *testing.T) {
	actor, err := BindActor(actorTestIdentity(), actorTestMembership(), false, actorTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if err := actor.Authorize("record:write", actorTestNow); err != nil {
		t.Fatalf("member collaboration denied: %v", err)
	}
	for _, capability := range []Capability{"settings:manage", "payment:verify", "profit:view", "not-a-capability"} {
		if err := actor.Authorize(capability, actorTestNow); !errors.Is(err, ErrForbidden) {
			t.Fatalf("member acquired %q: %v", capability, err)
		}
	}
	if err := actor.Authorize("record:write", actorTestNow.Add(time.Hour)); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("expired long-running request retained authority: %v", err)
	}
}

func TestSteppedUpOwnerDoesNotInheritMachineOperator(t *testing.T) {
	identity := actorTestIdentity()
	identity.Assurance, identity.HasVerifiedFactor = AAL2, true
	membership := actorTestMembership()
	membership.Role = Owner
	actor, err := BindActor(identity, membership, false, actorTestNow)
	if err != nil {
		t.Fatal(err)
	}
	if err := actor.Authorize("settings:manage", actorTestNow); err != nil {
		t.Fatalf("stepped-up workspace owner denied: %v", err)
	}
	if actor.Operator() {
		t.Fatal("workspace ownership granted machine-operator authority")
	}
}

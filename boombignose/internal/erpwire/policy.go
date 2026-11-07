// Package erpwire defines the shared application contracts for the Go runtime.
package erpwire

import (
	_ "embed"
	"encoding/json"
)

type Role string

type Capability string

const (
	Owner      Role = "owner"
	Admin      Role = "admin"
	Accountant Role = "accountant"
	Member     Role = "member"
)

//go:embed capabilities.json
var capabilityPolicy []byte

var capabilityMasks = loadCapabilityMasks()

func (role Role) mask() uint8 {
	switch role {
	case Owner:
		return 1
	case Admin:
		return 2
	case Accountant:
		return 4
	case Member:
		return 8
	default:
		return 0
	}
}

func (role Role) Valid() bool { return role.mask() != 0 }

// Can shares its policy source with lib/permissions.ts. It does not replace live
// authentication, workspace membership, MFA or database RLS authorization.
func Can(role Role, capability Capability) bool {
	return capabilityMasks[capability]&role.mask() != 0
}

func loadCapabilityMasks() map[Capability]uint8 {
	var policy map[Capability][]Role
	if err := json.Unmarshal(capabilityPolicy, &policy); err != nil {
		panic("invalid embedded capability policy: " + err.Error())
	}
	if len(policy) == 0 {
		panic("empty embedded capability policy")
	}
	masks := make(map[Capability]uint8, len(policy))
	for capability, roles := range policy {
		if capability == "" || len(roles) == 0 {
			panic("empty capability or role list in embedded policy")
		}
		var mask uint8
		for _, role := range roles {
			bit := role.mask()
			if bit == 0 || mask&bit != 0 {
				panic("invalid or repeated role in embedded capability policy")
			}
			mask |= bit
		}
		masks[capability] = mask
	}
	return masks
}

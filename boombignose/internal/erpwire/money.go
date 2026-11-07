package erpwire

import (
	"errors"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/money"
)

// MaxSafeInteger is the exact integer boundary of the browser JSON consumer.
// Database amounts remain integer satang; fractional quantities/rates use exact
// decimal values and are not converted to floating-point money in this layer.
const MaxSafeInteger int64 = 9007199254740991

var ErrUnsafeAmount = errors.New("integer-satang amount exceeds the exact supported range")

func ValidateSatang(value money.Satang) error {
	if value < -money.Satang(MaxSafeInteger) || value > money.Satang(MaxSafeInteger) {
		return ErrUnsafeAmount
	}
	return nil
}

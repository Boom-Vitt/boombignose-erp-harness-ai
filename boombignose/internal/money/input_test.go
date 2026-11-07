package money

import "testing"

func TestParseBahtPreservesExactSafeAmounts(t *testing.T) {
	for _, test := range []struct {
		input string
		want  Satang
	}{
		{"0", 0}, {" 001.2 ", 120}, {"0.01", 1},
		{"90071992547409.91", MaxSafeSatang},
	} {
		got, err := ParseBaht(test.input)
		if err != nil || got != test.want {
			t.Errorf("ParseBaht(%q) = %d, %v; want %d", test.input, got, err, test.want)
		}
	}
}

func TestParseBahtRejectsRoundingAndUnsafeInputs(t *testing.T) {
	for _, input := range []string{"", ".5", "1.", "-1", "+1", "1e2", "0x10", "1,000", "1.005", "90071992547409.92", "90071992547410", "999999999999999999999999999999999", "NaN", "Infinity", "๑๐"} {
		if _, err := ParseBaht(input); err == nil {
			t.Errorf("accepted inexact or invalid money %q", input)
		}
	}
}

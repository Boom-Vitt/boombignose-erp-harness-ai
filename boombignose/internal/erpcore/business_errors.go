package erpcore

// Only reviewed, static SQL-authored rejection text may cross the database
// boundary. No formatted RAISE arguments, server details, hints or query text.
// Sources: 20261025100000_quotes_subscriptions.sql and 20261024130000_expenses.sql.
func businessMessage(state, message string) string {
	if state != "P0001" && state != "P0002" {
		return ""
	}
	switch message {
	case "Billed subscription must be retained",
		"Billed subscription scope and cadence require a new agreement",
		"Schedule changes require the subscription command",
		"Only staff may manage subscriptions",
		"Invalid subscription changes",
		"Invalid start date",
		"Invalid subscription name",
		"Subscription unavailable",
		"Product unavailable",
		"Only staff may bill subscriptions",
		"Scheduled occurrence required",
		"Invalid scheduled billing occurrence",
		"Occurrence does not match cadence",
		"Occurrence does not match anchor date",
		"Subscription project customer mismatch",
		"Expense claim unavailable",
		"Only draft expense lines are editable",
		"Expense total exceeds safe satang bounds",
		"Expense costs follow their claim",
		"Workspace membership required",
		"Invalid expense transition",
		"Only owners and admins may decide expense claims",
		"Nobody may decide their own expense claim",
		"Only the claimant may submit, withdraw or reopen an expense claim",
		"Add expense lines first",
		"Rejection reason required":
		return message
	}
	return ""
}

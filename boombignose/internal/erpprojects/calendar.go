package erpprojects

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"time"

	"github.com/Boom-Vitt/nose-erp/boombignose/internal/erpwire"
)

type CalendarDay struct {
	ISO     string `json:"iso"`
	Day     int    `json:"day"`
	InMonth bool   `json:"inMonth"`
}
type CalendarItem struct {
	ID    string `json:"id"`
	Date  string `json:"date"`
	Label string `json:"label"`
	Tone  string `json:"tone"`
	Href  string `json:"href,omitempty"`
}
type YearMonth struct {
	Year  int `json:"year"`
	Month int `json:"month"`
}

func monthFormat(ym YearMonth) string { return fmt.Sprintf("%d-%02d", ym.Year, ym.Month) }
func monthLabel(ym YearMonth) string  { return fmt.Sprintf("%s %d", time.Month(ym.Month), ym.Year) }
func previousMonth(ym YearMonth) YearMonth {
	if ym.Month == 1 {
		return YearMonth{ym.Year - 1, 12}
	}
	return YearMonth{ym.Year, ym.Month - 1}
}
func nextMonth(ym YearMonth) YearMonth {
	if ym.Month == 12 {
		return YearMonth{ym.Year + 1, 1}
	}
	return YearMonth{ym.Year, ym.Month + 1}
}

var monthPattern = regexp.MustCompile(`^\d{4}-\d{2}$`)

func parseMonth(value string, now time.Time) YearMonth {
	if monthPattern.MatchString(value) {
		year, _ := strconv.Atoi(value[:4])
		month, _ := strconv.Atoi(value[5:])
		if month >= 1 && month <= 12 {
			return YearMonth{year, month}
		}
	}
	now = now.In(bangkok)
	return YearMonth{now.Year(), int(now.Month())}
}
func monthMatrix(ym YearMonth) [][]CalendarDay {
	year := ym.Year
	if year >= 0 && year < 100 {
		year += 1900
	}
	first := time.Date(year, time.Month(ym.Month), 1, 0, 0, 0, 0, time.UTC)
	leading := (int(first.Weekday()) + 6) % 7
	start := first.AddDate(0, 0, -leading)
	grid := make([][]CalendarDay, 6)
	for week := range grid {
		grid[week] = make([]CalendarDay, 7)
		for day := range grid[week] {
			date := start.AddDate(0, 0, week*7+day)
			iso := fmt.Sprintf("%d-%02d-%02d", date.Year(), date.Month(), date.Day())
			inMonth := len(iso) >= 7 && iso[:7] == monthFormat(ym)
			grid[week][day] = CalendarDay{ISO: iso, Day: date.Day(), InMonth: inMonth}
		}
	}
	return grid
}

var dueStates = []string{"overdue", "today", "future", "none"}
var dueLabels = map[string]string{"overdue": "Overdue", "today": "Today", "future": "Future", "none": "No due date"}
var dueStyles = map[string]string{"overdue": "text-red-600 dark:text-red-400", "today": "text-orange-600 dark:text-orange-400", "future": "text-green-700 dark:text-green-400", "none": "text-muted-foreground"}
var activityLabels = map[string]string{"note": "Note", "call": "Call", "email": "Email", "meeting": "Meeting", "follow_up": "Follow-up"}
var recordRoutes = map[string]string{"client": "/clients", "deal": "/deals", "quote": "/quotes", "invoice": "/finance/invoices", "project": "/projects", "subscription": "/finance/subscriptions", "vendor": "/vendors", "purchase_order": "/purchases", "expense_claim": "/expenses"}

func recordHref(kind, id string) string {
	route, ok := recordRoutes[kind]
	if !ok || id == "" {
		return ""
	}
	return route + "/" + id
}
func dueState(date, day string, done bool) string {
	if done || date == "" {
		return "none"
	}
	if date < day {
		return "overdue"
	}
	if date == day {
		return "today"
	}
	return "future"
}

type CalendarPageData struct {
	Today      string                    `json:"today"`
	YM         YearMonth                 `json:"ym"`
	Grid       [][]CalendarDay           `json:"grid"`
	RangeStart string                    `json:"rangeStart"`
	RangeEnd   string                    `json:"rangeEnd"`
	Items      []CalendarItem            `json:"items"`
	ByDate     map[string][]CalendarItem `json:"byDate"`
	Prev       YearMonth                 `json:"prev"`
	Next       YearMonth                 `json:"next"`
	MonthLabel string                    `json:"monthLabel"`
	PrevHref   string                    `json:"prevHref"`
	NextHref   string                    `json:"nextHref"`
	TodayHref  string                    `json:"todayHref"`
	Weekdays   []string                  `json:"weekdays"`
}

func (s *Service) calendarPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	params, err := searchParams(raw)
	if err != nil {
		return nil, err
	}
	now := s.now()
	ym := parseMonth(text(params["month"]), now)
	grid := monthMatrix(ym)
	out := CalendarPageData{Today: today(now), YM: ym, Grid: grid, RangeStart: grid[0][0].ISO, RangeEnd: grid[5][6].ISO, Items: []CalendarItem{}, ByDate: map[string][]CalendarItem{}, Prev: previousMonth(ym), Next: nextMonth(ym), MonthLabel: monthLabel(ym), Weekdays: []string{"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}}
	out.PrevHref = "/calendar?month=" + monthFormat(out.Prev)
	out.NextHref = "/calendar?month=" + monthFormat(out.Next)
	out.TodayHref = "/calendar?month=" + now.In(bangkok).Format("2006-01")
	for _, source := range []struct {
		table, date string
		columns     []string
		relations   []erpwire.Relation
	}{{"activities", "due_date", []string{"id", "type", "due_date", "done", "record_type", "record_id", "client_id"}, []erpwire.Relation{clientRelation("clients")}}, {"invoices", "due_date", []string{"id", "number", "due_date"}, nil}, {"projects", "deadline", []string{"id", "name", "deadline"}, nil}} {
		var rows []erpwire.Row
		err = s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
			var err error
			rows, err = all(ctx, tx, erpwire.Select{Table: source.table, Columns: source.columns, Relations: source.relations, Where: append(scope(a), erpwire.Predicate{Column: source.date, Op: erpwire.GreaterEqual, Value: out.RangeStart}, erpwire.Predicate{Column: source.date, Op: erpwire.LessEqual, Value: out.RangeEnd}), Order: ordered("id")})
			return err
		})
		if canonical(err) {
			return nil, err
		}
		if err != nil {
			continue
		}
		for _, row := range rows {
			date := text(row[source.date])
			if date == "" {
				continue
			}
			id := text(row["id"])
			item := CalendarItem{Date: date}
			switch source.table {
			case "activities":
				item.ID = "activity-" + id
				state := dueState(date, out.Today, boolean(row["done"]))
				status := "Pending · " + dueLabels[state]
				if boolean(row["done"]) {
					status = "Completed"
				}
				item.Label = status + " · " + activityLabels[text(row["type"])]
				if client := text(relation(row, "clients")["name"]); client != "" {
					item.Label += " · " + client
				}
				item.Tone = map[string]string{"overdue": "red", "today": "orange", "future": "emerald", "none": "neutral"}[state]
				item.Href = recordHref(text(row["record_type"]), text(row["record_id"]))
				if item.Href == "" && text(row["client_id"]) != "" {
					item.Href = "/clients/" + text(row["client_id"])
				}
			case "invoices":
				item.ID = "invoice-" + id
				item.Label = "Invoice " + text(row["number"]) + " due"
				item.Tone = "red"
				item.Href = "/finance/invoices/" + id
			case "projects":
				item.ID = "project-" + id
				item.Label = text(row["name"]) + " deadline"
				item.Tone = "emerald"
				item.Href = "/projects/" + id
			}
			out.Items = append(out.Items, item)
			out.ByDate[date] = append(out.ByDate[date], item)
		}
	}
	return out, nil
}

type ActivityGroup struct {
	State      string        `json:"state"`
	Label      string        `json:"label"`
	Style      string        `json:"style"`
	Activities []erpwire.Row `json:"activities"`
}
type ActivitiesPageData struct {
	Activities []erpwire.Row   `json:"activities"`
	Today      string          `json:"today"`
	Groups     []ActivityGroup `json:"groups"`
}

func (s *Service) activitiesPage(ctx context.Context, a erpwire.Actor, raw json.RawMessage) (any, error) {
	if err := authorize(a, ""); err != nil {
		return nil, err
	}
	if _, err := arguments(raw, 0, 0); err != nil {
		return nil, err
	}
	out := ActivitiesPageData{Today: today(s.now()), Groups: []ActivityGroup{}}
	err := s.store.Read(ctx, a, func(tx erpwire.ReadTx) error {
		var err error
		out.Activities, err = all(ctx, tx, erpwire.Select{Table: "activities", Columns: []string{"id", "type", "body", "due_date", "done", "record_type", "record_id", "owner"}, Where: append(scope(a), eq("owner", a.UserID()), eq("done", false)), Order: []erpwire.Order{{Column: "due_date"}, {Column: "id"}}})
		return err
	})
	if err != nil {
		return nil, loadError(err, "Unable to load activities. Please try again.")
	}
	for _, state := range dueStates {
		group := ActivityGroup{State: state, Label: dueLabels[state], Style: dueStyles[state], Activities: []erpwire.Row{}}
		for _, activity := range out.Activities {
			if dueState(text(activity["due_date"]), out.Today, boolean(activity["done"])) == state {
				activity["href"] = recordHref(text(activity["record_type"]), text(activity["record_id"]))
				activity["label"] = activityLabels[text(activity["type"])] + " · " + fallback(text(activity["body"]), "Activity")
				group.Activities = append(group.Activities, activity)
			}
		}
		out.Groups = append(out.Groups, group)
	}
	return out, nil
}

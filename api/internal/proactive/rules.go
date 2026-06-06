package proactive

import (
	"regexp"
	"strings"
	"time"
)

// Decision is the outcome of a rules evaluation.
type Decision string

const (
	DecisionAccept Decision = "accept"
	DecisionReject Decision = "reject"
	DecisionGray   Decision = "gray"
)

// RuleResult holds the decision and human-readable reason.
type RuleResult struct {
	Decision Decision
	Reason   string
}

var rejectSenderRE = regexp.MustCompile(`(?i)^(noreply|no-reply|notifications?|bounce|mailer-daemon|automated)@`)

// EvaluateCalendar applies calendar-specific rules to the decoded payload.
//
// Rules:
//   - payload must have non-empty "title" string → otherwise reject
//   - participants_count >= 1 → accept
//   - all_day == true AND no participants → reject
//   - otherwise → gray
func EvaluateCalendar(payload map[string]any) RuleResult {
	title, _ := payload["title"].(string)
	if strings.TrimSpace(title) == "" {
		return RuleResult{DecisionReject, "missing or empty title"}
	}

	participants := int64(0)
	switch v := payload["participants_count"].(type) {
	case float64:
		participants = int64(v)
	case int:
		participants = int64(v)
	case int64:
		participants = v
	}

	if participants >= 1 {
		return RuleResult{DecisionAccept, "has participants"}
	}

	allDay, _ := payload["all_day"].(bool)
	if allDay {
		return RuleResult{DecisionReject, "all-day event with no participants"}
	}

	return RuleResult{DecisionGray, "no participants, not all-day"}
}

// EvaluateEmail applies email-specific rules to the decoded payload.
//
// Rules:
//   - payload must have non-empty "sender" string → otherwise reject
//   - sender (lowercased) in prioritySenders → accept
//   - sender matches automated/noreply pattern OR local-part contains newsletter keywords → reject
//   - otherwise → gray
//
// TODO(V2): prioritySenders will be loaded from a priority_senders table per user.
func EvaluateEmail(payload map[string]any, prioritySenders []string) RuleResult {
	sender, _ := payload["sender"].(string)
	sender = strings.TrimSpace(sender)
	if sender == "" {
		return RuleResult{DecisionReject, "missing or empty sender"}
	}

	senderLower := strings.ToLower(sender)

	for _, ps := range prioritySenders {
		if senderLower == strings.ToLower(strings.TrimSpace(ps)) {
			return RuleResult{DecisionAccept, "sender in priority list"}
		}
	}

	if rejectSenderRE.MatchString(senderLower) {
		return RuleResult{DecisionReject, "automated/noreply sender pattern"}
	}

	// Check local-part for newsletter-style prefixes (updates@, marketing@).
	local := senderLower
	if idx := strings.Index(senderLower, "@"); idx >= 0 {
		local = senderLower[:idx]
	}
	newsletterKeywords := []string{"updates", "marketing", "newsletter", "promo", "promotion"}
	for _, kw := range newsletterKeywords {
		if local == kw || strings.HasPrefix(local, kw+".") {
			return RuleResult{DecisionReject, "newsletter sender pattern"}
		}
	}

	return RuleResult{DecisionGray, "sender not classified"}
}

// EvaluateReminder applies reminder-specific rules to the decoded payload.
//
// Reminders are user-authored, so relevance is inherently high.
//
// Rules:
//   - payload must have non-empty "title" string → otherwise reject
//   - has a non-empty "due_date" → accept (a concrete deadline is worth surfacing)
//   - otherwise → gray (let the judge decide)
func EvaluateReminder(payload map[string]any) RuleResult {
	title, _ := payload["title"].(string)
	if strings.TrimSpace(title) == "" {
		return RuleResult{DecisionReject, "missing or empty title"}
	}

	dueDate, _ := payload["due_date"].(string)
	if strings.TrimSpace(dueDate) != "" {
		return RuleResult{DecisionAccept, "reminder has a due date"}
	}

	return RuleResult{DecisionGray, "reminder without due date"}
}

// EvaluateHealth applies health-anomaly rules to the decoded payload.
//
// Health anomalies are subjective (a "low" sleep figure depends on the person),
// so we keep deterministic rules minimal and defer judgement to the LLM judge.
//
// Rules:
//   - payload must have a non-empty "metric" string → otherwise reject
//   - otherwise → gray (let the judge decide whether it's worth surfacing)
func EvaluateHealth(payload map[string]any) RuleResult {
	metric, _ := payload["metric"].(string)
	if strings.TrimSpace(metric) == "" {
		return RuleResult{DecisionReject, "missing or empty metric"}
	}
	return RuleResult{DecisionGray, "health anomaly — defer to judge"}
}

// InQuietHours reports whether now falls inside the configured quiet-hours window.
//
// start and end are wall-clock strings in "HH:MM" or "HH:MM:SS" format (as stored
// in users.quiet_hours_start / users.quiet_hours_end).
//
// Wraparound (e.g. 23:00 → 07:00) is handled: if end < start the window spans midnight.
//
// TODO(TZ): For V1 all times are interpreted in UTC. Add per-user timezone support in V2.
func InQuietHours(now time.Time, start, end *string) bool {
	if start == nil || end == nil {
		return false
	}

	parseWallClock := func(s string) (hour, min, sec int) {
		// Accept "HH:MM" or "HH:MM:SS"
		parts := strings.SplitN(s, ":", 3)
		if len(parts) < 2 {
			return 0, 0, 0
		}
		for i, p := range parts {
			v := 0
			for _, ch := range p {
				if ch >= '0' && ch <= '9' {
					v = v*10 + int(ch-'0')
				}
			}
			switch i {
			case 0:
				hour = v
			case 1:
				min = v
			case 2:
				sec = v
			}
		}
		return
	}

	sh, sm, ss := parseWallClock(*start)
	eh, em, es := parseWallClock(*end)

	// Convert to seconds-since-midnight for easy comparison.
	startSec := sh*3600 + sm*60 + ss
	endSec := eh*3600 + em*60 + es

	// Use UTC wall clock (see TODO above).
	nowUTC := now.UTC()
	nowSec := nowUTC.Hour()*3600 + nowUTC.Minute()*60 + nowUTC.Second()

	if startSec <= endSec {
		// Normal window (e.g. 22:00 → 23:00, or 08:00 → 18:00)
		return nowSec >= startSec && nowSec < endSec
	}
	// Wraparound window (e.g. 23:00 → 07:00): in window if after start OR before end.
	return nowSec >= startSec || nowSec < endSec
}

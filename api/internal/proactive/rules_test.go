package proactive

import (
	"testing"
	"time"
)

// ── Reminders ───────────────────────────────────────────────────────────────

func TestEvaluateReminder_Accept(t *testing.T) {
	res := EvaluateReminder(map[string]any{
		"title":    "Submit tax form",
		"due_date": "2026-06-07T09:00:00Z",
	})
	if res.Decision != DecisionAccept {
		t.Fatalf("expected accept, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateReminder_Reject_NoTitle(t *testing.T) {
	res := EvaluateReminder(map[string]any{"title": "  "})
	if res.Decision != DecisionReject {
		t.Fatalf("expected reject, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateReminder_Gray_NoDueDate(t *testing.T) {
	res := EvaluateReminder(map[string]any{"title": "Buy milk"})
	if res.Decision != DecisionGray {
		t.Fatalf("expected gray, got %s (%s)", res.Decision, res.Reason)
	}
}

// ── Calendar ────────────────────────────────────────────────────────────────

func TestEvaluateCalendar_Accept(t *testing.T) {
	payload := map[string]any{
		"title":              "Team sync",
		"participants_count": float64(3),
	}
	res := EvaluateCalendar(payload)
	if res.Decision != DecisionAccept {
		t.Fatalf("expected accept, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateCalendar_Reject_AllDay(t *testing.T) {
	payload := map[string]any{
		"title":   "Public holiday",
		"all_day": true,
	}
	res := EvaluateCalendar(payload)
	if res.Decision != DecisionReject {
		t.Fatalf("expected reject, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateCalendar_Gray(t *testing.T) {
	payload := map[string]any{
		"title":   "Focus time",
		"all_day": false,
	}
	res := EvaluateCalendar(payload)
	if res.Decision != DecisionGray {
		t.Fatalf("expected gray, got %s (%s)", res.Decision, res.Reason)
	}
}

// ── Email ────────────────────────────────────────────────────────────────────

func TestEvaluateEmail_Accept(t *testing.T) {
	payload := map[string]any{"sender": "boss@example.com"}
	res := EvaluateEmail(payload, []string{"boss@example.com"})
	if res.Decision != DecisionAccept {
		t.Fatalf("expected accept, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateEmail_Reject_NoReply(t *testing.T) {
	payload := map[string]any{"sender": "noreply@service.com"}
	res := EvaluateEmail(payload, nil)
	if res.Decision != DecisionReject {
		t.Fatalf("expected reject, got %s (%s)", res.Decision, res.Reason)
	}
}

func TestEvaluateEmail_Gray(t *testing.T) {
	payload := map[string]any{"sender": "alice@example.com"}
	res := EvaluateEmail(payload, nil)
	if res.Decision != DecisionGray {
		t.Fatalf("expected gray, got %s (%s)", res.Decision, res.Reason)
	}
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

func timeUTC(hour, min int) time.Time {
	return time.Date(2026, 5, 26, hour, min, 0, 0, time.UTC)
}

func strPtr(s string) *string { return &s }

func TestInQuietHours_InWindow_Wraparound(t *testing.T) {
	// window 23:00 → 07:00; now = 01:30 → inside
	if !InQuietHours(timeUTC(1, 30), strPtr("23:00"), strPtr("07:00")) {
		t.Fatal("expected in quiet hours (wraparound, 01:30)")
	}
}

func TestInQuietHours_OutOfWindow_Wraparound(t *testing.T) {
	// window 23:00 → 07:00; now = 12:00 → outside
	if InQuietHours(timeUTC(12, 0), strPtr("23:00"), strPtr("07:00")) {
		t.Fatal("expected NOT in quiet hours (wraparound, 12:00)")
	}
}

func TestInQuietHours_ExactlyOnBoundary(t *testing.T) {
	// window 22:00 → 08:00; now = 22:00 exactly → on start boundary → inside
	if !InQuietHours(timeUTC(22, 0), strPtr("22:00"), strPtr("08:00")) {
		t.Fatal("expected in quiet hours at start boundary")
	}
	// now = 08:00 exactly → on end boundary → NOT inside (exclusive end)
	if InQuietHours(timeUTC(8, 0), strPtr("22:00"), strPtr("08:00")) {
		t.Fatal("expected NOT in quiet hours at end boundary (exclusive)")
	}
}

func TestInQuietHours_NilPointers(t *testing.T) {
	if InQuietHours(timeUTC(3, 0), nil, nil) {
		t.Fatal("expected false when quiet hours not configured")
	}
}

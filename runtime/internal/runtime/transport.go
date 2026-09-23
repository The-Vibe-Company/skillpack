package runtime

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	maxSendAttempts = 10
	maxSendBatch    = 5
)

type sendReport struct {
	sent     int
	retried  int
	terminal int
	expired  int
}

func (s *Store) SendPending(ctx context.Context, client *http.Client) (sendReport, error) {
	if client == nil {
		client = &http.Client{Timeout: HTTPTimeout}
	}
	if processDisabled := telemetryDisabledForProcess(); processDisabled {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM events`)
		return sendReport{}, nil
	}
	enabled, err := s.telemetryEnabled(ctx)
	if err != nil {
		return sendReport{}, err
	}
	if !enabled {
		_, _ = s.db.ExecContext(ctx, `DELETE FROM events`)
		return sendReport{}, nil
	}
	if err := s.pruneBoundedState(ctx); err != nil {
		return sendReport{}, err
	}
	now := nowUTC()
	var report sendReport
	expiredResult, err := s.db.ExecContext(ctx, `UPDATE events SET status='dead', last_error='expired', last_status=NULL, payload=?, payload_bytes=0, identity_json=NULL, endpoint='' WHERE status='pending' AND created_at < ?`, []byte{}, formatTime(now.Add(-EventTTL)))
	if err != nil {
		return report, err
	}
	if count, countErr := expiredResult.RowsAffected(); countErr == nil {
		report.expired = int(count)
		if count > 0 {
			s.addDiagnostic("queue_expired", "expired telemetry events were dropped from the local queue")
		}
	}
	events, err := s.pendingEventsBatch(ctx, now, maxSendBatch)
	if err != nil {
		return report, err
	}
	for _, event := range events {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		allowed, globalDisabled, err := s.eventSendingAllowed(ctx, event)
		if err != nil {
			return report, err
		}
		if !allowed {
			if globalDisabled {
				_, _ = s.db.ExecContext(ctx, `DELETE FROM events`)
				return report, nil
			}
			if event.SessionID != "" {
				_, _ = s.db.ExecContext(ctx, `DELETE FROM events WHERE session_id=?`, event.SessionID)
			} else {
				_, _ = s.db.ExecContext(ctx, `DELETE FROM events WHERE event_id=?`, event.EventID)
			}
			continue
		}
		attempt := event.Attempts + 1
		if _, err := s.db.ExecContext(ctx, `UPDATE events SET attempts=? WHERE event_id=? AND status='pending'`, attempt, event.EventID); err != nil {
			return report, err
		}
		status, retryAfter, sendErr := sendOne(ctx, client, event)
		switch {
		case sendErr == nil && status == http.StatusAccepted:
			if _, err := s.db.ExecContext(ctx, `UPDATE events SET status='sent', sent_at=?, last_error=NULL, last_status=?, payload=?, payload_bytes=0, identity_json=NULL, endpoint='' WHERE event_id=?`, formatTime(nowUTC()), status, []byte{}, event.EventID); err != nil {
				return report, err
			}
			report.sent++
		case isRetryableStatus(status) || sendErr != nil:
			if attempt >= maxSendAttempts {
				message := "transport retry budget exhausted"
				if sendErr != nil {
					message = truncateError(sendErr.Error())
				}
				_, _ = s.db.ExecContext(ctx, `UPDATE events SET status='dead', last_error=?, last_status=?, payload=?, payload_bytes=0, identity_json=NULL, endpoint='' WHERE event_id=?`, message, nullableStatus(status), []byte{}, event.EventID)
				s.addDiagnostic("transport_exhausted", message)
				report.terminal++
				continue
			}
			delay := retryDelay(attempt, retryAfter)
			message := "retryable transport failure"
			if sendErr != nil {
				message = truncateError(sendErr.Error())
			}
			if _, err := s.db.ExecContext(ctx, `UPDATE events SET next_attempt=?, last_error=?, last_status=? WHERE event_id=?`, formatTime(nowUTC().Add(delay)), message, nullableStatus(status), event.EventID); err != nil {
				return report, err
			}
			report.retried++
		default:
			message := fmt.Sprintf("terminal HTTP status %d", status)
			if sendErr != nil {
				message = truncateError(sendErr.Error())
			}
			if _, err := s.db.ExecContext(ctx, `UPDATE events SET status='dead', last_error=?, last_status=?, payload=?, payload_bytes=0, identity_json=NULL, endpoint='' WHERE event_id=?`, message, nullableStatus(status), []byte{}, event.EventID); err != nil {
				return report, err
			}
			s.addDiagnostic("transport_terminal", message)
			report.terminal++
		}
	}
	if err := s.pruneBoundedState(ctx); err != nil {
		return report, err
	}
	return report, nil
}

func (s *Store) eventSendingAllowed(ctx context.Context, event localEvent) (allowed, globalDisabled bool, err error) {
	if telemetryDisabledForProcess() {
		return false, true, nil
	}
	enabled, err := s.telemetryEnabled(ctx)
	if err != nil {
		return false, false, err
	}
	if !enabled {
		return false, true, nil
	}
	if event.SessionID != "" {
		allowed, known, err := s.sessionAllowed(ctx, event.SessionID)
		if err != nil {
			return false, false, err
		}
		if !known || !allowed {
			return false, false, nil
		}
	}
	return true, false, nil
}

func sendOne(ctx context.Context, client *http.Client, event localEvent) (int, time.Duration, error) {
	requestCtx, cancel := context.WithTimeout(ctx, HTTPTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, event.Endpoint, strings.NewReader(string(event.Payload)))
	if err != nil {
		return 0, 0, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "skillpack-runtime/"+RuntimeVersion)
	response, err := client.Do(request)
	if err != nil {
		return 0, 0, err
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(response.Body, MaxEventBytes))
	retryAfter := parseRetryAfter(response.Header.Get("Retry-After"))
	if response.StatusCode == http.StatusAccepted {
		var receipt struct {
			EventID string `json:"event_id"`
		}
		if err := json.Unmarshal(body, &receipt); err != nil || receipt.EventID != event.EventID {
			return response.StatusCode, retryAfter, fmt.Errorf("202 response did not acknowledge event_id")
		}
	}
	return response.StatusCode, retryAfter, nil
}

func isRetryableStatus(status int) bool { return status == http.StatusTooManyRequests || status >= 500 }

func nullableStatus(status int) any {
	if status <= 0 {
		return nil
	}
	return status
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if when, err := http.ParseTime(value); err == nil {
		if delay := time.Until(when); delay > 0 {
			return delay
		}
	}
	return 0
}

func retryDelay(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		if retryAfter > 5*time.Minute {
			return 5 * time.Minute
		}
		return retryAfter
	}
	delay := time.Second << min(attempt-1, 7)
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	var random [8]byte
	_, _ = rand.Read(random[:])
	jitter := time.Duration(binary.LittleEndian.Uint64(random[:])%500) * time.Millisecond
	return delay + jitter
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func truncateError(value string) string {
	if len(value) <= maxDiagnosticMessage {
		return value
	}
	return value[:maxDiagnosticMessage]
}

package runtime

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strconv"
	"time"
)

func (s *Store) acquireWorkerLease(ctx context.Context, owner string, ttl time.Duration) (bool, error) {
	now := nowUTC()
	until := now.Add(ttl)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	var currentOwner, leaseUntil string
	err = tx.QueryRowContext(ctx, `SELECT owner, lease_until FROM worker_lease WHERE id=1`).Scan(&currentOwner, &leaseUntil)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO worker_lease(id, owner, lease_until) VALUES (1, ?, ?)`, owner, formatTime(until)); err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	} else if currentOwner != owner && parseStoredTime(leaseUntil).After(now) {
		return false, nil
	} else if _, err := tx.ExecContext(ctx, `UPDATE worker_lease SET owner=?, lease_until=? WHERE id=1`, owner, formatTime(until)); err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) renewWorkerLease(ctx context.Context, owner string, ttl time.Duration) error {
	_, err := s.db.ExecContext(ctx, `UPDATE worker_lease SET lease_until=? WHERE id=1 AND owner=?`, formatTime(nowUTC().Add(ttl)), owner)
	return err
}

func (s *Store) releaseWorkerLease(ctx context.Context, owner string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM worker_lease WHERE id=1 AND owner=?`, owner)
	return err
}

func (s *Store) runWorker(ctx context.Context, continuous bool, explicit []transcriptPath) (SyncResult, error) {
	if telemetryDisabledForProcess() {
		return SyncResult{}, nil
	}
	owner, err := newUUID()
	if err != nil {
		return SyncResult{}, err
	}
	acquired, err := s.acquireWorkerLease(ctx, owner, 30*time.Second)
	if err != nil || !acquired {
		return SyncResult{}, err
	}
	defer func() { _ = s.releaseWorkerLease(context.Background(), owner) }()
	heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
	heartbeatErr := make(chan error, 1)
	go s.workerLeaseHeartbeat(heartbeatCtx, owner, heartbeatErr)
	defer stopHeartbeat()
	idleTimeout := WorkerIdleTimeout
	if raw := os.Getenv("SKILLPACK_RUNTIME_IDLE_SECONDS"); raw != "" {
		if seconds, parseErr := strconv.Atoi(raw); parseErr == nil && seconds >= 0 {
			idleTimeout = time.Duration(seconds) * time.Second
		}
	}
	deadline := time.Now().Add(idleTimeout)
	var aggregate SyncResult
	client := &http.Client{Timeout: HTTPTimeout}
	for {
		if err := ctx.Err(); err != nil {
			return aggregate, err
		}
		select {
		case err := <-heartbeatErr:
			return aggregate, err
		default:
		}
		current, err := s.syncOnce(ctx, client, explicit)
		if err != nil {
			return aggregate, err
		}
		aggregate.Scanned += current.Scanned
		aggregate.Queued += current.Queued
		aggregate.Sent += current.Sent
		aggregate.Retried += current.Retried
		aggregate.Terminal += current.Terminal
		aggregate.Expired += current.Expired
		aggregate.Diagnostics += current.Diagnostics
		if current.Sent > 0 || current.Queued > 0 || current.Scanned > 0 {
			deadline = time.Now().Add(idleTimeout)
		}
		if !continuous && time.Now().After(deadline) {
			return aggregate, nil
		}
		if err := s.renewWorkerLease(ctx, owner, 30*time.Second); err != nil {
			return aggregate, err
		}
		select {
		case <-ctx.Done():
			return aggregate, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (s *Store) workerLeaseHeartbeat(ctx context.Context, owner string, errors chan<- error) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.renewWorkerLease(ctx, owner, 30*time.Second); err != nil {
				select {
				case errors <- err:
				default:
				}
				return
			}
		}
	}
}

func (s *Store) syncOnce(ctx context.Context, client *http.Client, explicit []transcriptPath) (SyncResult, error) {
	var result SyncResult
	var reconcile SyncResult
	var err error
	if explicit == nil {
		reconcile, err = s.ReconcileDefaultTranscripts(ctx)
	} else {
		reconcile, err = s.ReconcileTranscripts(ctx, explicit)
	}
	if err != nil {
		return result, err
	}
	result.Scanned += reconcile.Scanned
	result.Queued += reconcile.Queued
	result.Diagnostics += reconcile.Diagnostics
	sent, err := s.SendPending(ctx, client)
	if err != nil {
		return result, err
	}
	result.Sent += sent.sent
	result.Retried += sent.retried
	result.Terminal += sent.terminal
	result.Expired += sent.expired
	return result, nil
}

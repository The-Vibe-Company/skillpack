package runtime

import (
	"context"
	"testing"
	"time"
)

func TestWorkerLeaseAllowsOnlyOneLiveWorker(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	first, err := store.acquireWorkerLease(ctx, "worker-a", time.Minute)
	if err != nil || !first {
		t.Fatalf("first lease = %v, err=%v", first, err)
	}
	second, err := store.acquireWorkerLease(ctx, "worker-b", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if second {
		t.Fatal("second live worker acquired the lease")
	}
	if err := store.releaseWorkerLease(ctx, "worker-a"); err != nil {
		t.Fatal(err)
	}
	second, err = store.acquireWorkerLease(ctx, "worker-b", time.Minute)
	if err != nil || !second {
		t.Fatalf("released lease = %v, err=%v", second, err)
	}
}

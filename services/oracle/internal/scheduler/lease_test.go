package scheduler

import (
	"testing"
)

func TestHolderID_Format(t *testing.T) {
	// LeaseManager without real DB — just test holder ID format
	lm := &LeaseManager{holderID: "oracle-testhost-12345"}
	if lm.HolderID() != "oracle-testhost-12345" {
		t.Errorf("holderID = %q", lm.HolderID())
	}
}

func TestNewLeaseManager_HolderIDContainsOraclePrefix(t *testing.T) {
	lm := NewLeaseManager(nil)
	id := lm.HolderID()
	if len(id) < 8 {
		t.Errorf("holderID too short: %q", id)
	}
	if id[:7] != "oracle-" {
		t.Errorf("holderID should start with 'oracle-', got %q", id)
	}
}

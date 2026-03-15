package notify

import (
	"testing"

	"github.com/google/uuid"
)

func TestDedupKey_Deterministic(t *testing.T) {
	id := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	key1 := DedupKey(id, "CVE-2024-001", "new_cve")
	key2 := DedupKey(id, "CVE-2024-001", "new_cve")

	if key1 != key2 {
		t.Errorf("same inputs should produce same key: %q != %q", key1, key2)
	}

	if len(key1) != 64 {
		t.Errorf("key length = %d, want 64 (sha256 hex)", len(key1))
	}
}

func TestDedupKey_DifferentInputs(t *testing.T) {
	id := uuid.MustParse("00000000-0000-0000-0000-000000000001")

	key1 := DedupKey(id, "CVE-2024-001", "new_cve")
	key2 := DedupKey(id, "CVE-2024-002", "new_cve")

	if key1 == key2 {
		t.Error("different advisory IDs should produce different keys")
	}

	key3 := DedupKey(id, "CVE-2024-001", "resolved_cve")
	if key1 == key3 {
		t.Error("different diff kinds should produce different keys")
	}
}

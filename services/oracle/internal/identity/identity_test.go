package identity

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestOracleConsumerID_Format(t *testing.T) {
	id := OracleConsumerID()

	if !strings.HasPrefix(id, "oracle-") {
		t.Errorf("should start with 'oracle-': %q", id)
	}

	hostname, _ := os.Hostname()
	if !strings.Contains(id, hostname) {
		t.Errorf("should contain hostname %q: %q", hostname, id)
	}

	pid := os.Getpid()
	if !strings.HasSuffix(id, fmt.Sprintf("-%d", pid)) {
		t.Errorf("should end with PID %d: %q", pid, id)
	}
}

func TestOracleConsumerID_Deterministic(t *testing.T) {
	id1 := OracleConsumerID()
	id2 := OracleConsumerID()
	if id1 != id2 {
		t.Errorf("should be deterministic: %q != %q", id1, id2)
	}
}

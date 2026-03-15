package stream

import (
	"testing"
)

func TestNewConsumer_ConsumerName(t *testing.T) {
	c := NewConsumer(nil, nil)
	if c.group != "oracle-diff" {
		t.Errorf("group = %q, want oracle-diff", c.group)
	}
	if len(c.consumerName) < 8 {
		t.Errorf("consumerName too short: %q", c.consumerName)
	}
	if c.consumerName[:7] != "oracle-" {
		t.Errorf("consumerName should start with 'oracle-': %q", c.consumerName)
	}
}

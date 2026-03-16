package identity

import (
	"fmt"
	"os"
)

// OracleConsumerID returns a unique identifier for this oracle instance
// in the form "oracle-{hostname}-{pid}".
func OracleConsumerID() string {
	hostname, _ := os.Hostname()
	return fmt.Sprintf("oracle-%s-%d", hostname, os.Getpid())
}

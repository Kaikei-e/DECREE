package api

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

func TestAppError_Error(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		err  *AppError
		want string
	}{
		{
			name: "without underlying error",
			err:  &AppError{Status: 400, Code: "bad", Message: "bad request"},
			want: "bad request",
		},
		{
			name: "with underlying error",
			err:  &AppError{Status: 500, Code: "internal", Message: "query failed", Err: fmt.Errorf("connection refused")},
			want: "query failed: connection refused",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := tt.err.Error(); got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestAppError_Unwrap(t *testing.T) {
	t.Parallel()
	inner := fmt.Errorf("inner error")
	appErr := &AppError{Status: 500, Code: "x", Message: "msg", Err: inner}
	if !errors.Is(appErr, inner) {
		t.Error("Unwrap should return the inner error")
	}

	noInner := &AppError{Status: 400, Code: "x", Message: "msg"}
	if noInner.Unwrap() != nil {
		t.Error("Unwrap should return nil when no inner error")
	}
}

func TestErrBadRequest(t *testing.T) {
	t.Parallel()
	err := ErrBadRequest("invalid_id", "bad uuid")
	if err.Status != http.StatusBadRequest {
		t.Errorf("Status = %d, want 400", err.Status)
	}
	if err.Code != "invalid_id" {
		t.Errorf("Code = %q", err.Code)
	}
}

func TestErrNotFound(t *testing.T) {
	t.Parallel()
	err := ErrNotFound("not_found", "missing")
	if err.Status != http.StatusNotFound {
		t.Errorf("Status = %d, want 404", err.Status)
	}
}

func TestErrInternal(t *testing.T) {
	t.Parallel()
	inner := fmt.Errorf("db down")
	err := ErrInternal("failed", inner)
	if err.Status != http.StatusInternalServerError {
		t.Errorf("Status = %d, want 500", err.Status)
	}
	if err.Err != inner {
		t.Error("expected inner error to be preserved")
	}
}

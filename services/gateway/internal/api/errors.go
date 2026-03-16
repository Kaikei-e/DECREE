package api

import (
	"fmt"
	"net/http"
)

// AppError is a structured error that handlers return.
// The error middleware translates it into the JSON error response.
type AppError struct {
	Status  int    // HTTP status code
	Code    string // machine-readable code (e.g., "not_found", "invalid_id")
	Message string // human-readable message
	Err     error  // underlying error for logging (never sent to client)
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Err }

func ErrBadRequest(code, message string) *AppError {
	return &AppError{Status: http.StatusBadRequest, Code: code, Message: message}
}

func ErrNotFound(code, message string) *AppError {
	return &AppError{Status: http.StatusNotFound, Code: code, Message: message}
}

func ErrInternal(message string, err error) *AppError {
	return &AppError{Status: http.StatusInternalServerError, Code: "internal_error", Message: message, Err: err}
}

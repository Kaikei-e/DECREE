package db

// orEmpty returns an empty slice instead of nil.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

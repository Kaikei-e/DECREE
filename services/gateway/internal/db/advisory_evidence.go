package db

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

const (
	rangeSupportsMatch    = "supports_match"
	rangeContradictsMatch = "contradicts_match"
	rangeInconclusive     = "inconclusive"
)

type osvAdvisorySnapshot struct {
	Summary  *string               `json:"summary"`
	Affected []osvAffectedSnapshot `json:"affected"`
}

type osvAffectedSnapshot struct {
	Package *osvAffectedPackageSnapshot `json:"package"`
	Ranges  []osvRangeSnapshot          `json:"ranges"`
}

type osvAffectedPackageSnapshot struct {
	Name      *string `json:"name"`
	Ecosystem *string `json:"ecosystem"`
}

type osvRangeSnapshot struct {
	Type   string             `json:"type"`
	Events []osvEventSnapshot `json:"events"`
}

type osvEventSnapshot struct {
	Introduced        *string `json:"introduced"`
	Fixed             *string `json:"fixed"`
	LastKnownAffected *string `json:"last_known_affected"`
}

type semverVersion struct {
	major int
	minor int
	patch int
}

func newDetectionEvidence(
	packageName string,
	packageVersion string,
	ecosystem string,
	rawJSON []byte,
	fetchedAt *time.Time,
	aliases []string,
) *DetectionEvidence {
	evidence := &DetectionEvidence{
		Source:                "osv",
		FetchedAt:             fetchedAt,
		Aliases:               aliases,
		RangeEvaluationStatus: rangeInconclusive,
	}

	if len(rawJSON) == 0 {
		return evidence
	}

	var advisory osvAdvisorySnapshot
	if err := json.Unmarshal(rawJSON, &advisory); err != nil {
		return evidence
	}

	evidence.Summary = advisory.Summary
	evidence.RangeEvaluationStatus = classifyRangeEvaluation(
		packageName,
		packageVersion,
		ecosystem,
		advisory.Affected,
	)
	return evidence
}

func classifyRangeEvaluation(
	packageName string,
	packageVersion string,
	ecosystem string,
	affected []osvAffectedSnapshot,
) string {
	version, ok := parseSemver(packageVersion)
	if !ok {
		return rangeInconclusive
	}

	matching := make([]osvAffectedSnapshot, 0, len(affected))
	for _, entry := range affected {
		if affectedEntryMatches(entry, packageName, ecosystem) {
			matching = append(matching, entry)
		}
	}

	if len(matching) == 0 {
		if len(affected) == 0 {
			return rangeInconclusive
		}
		return rangeContradictsMatch
	}

	sawContradiction := false
	sawInconclusive := false

	for _, entry := range matching {
		if len(entry.Ranges) == 0 {
			sawInconclusive = true
			continue
		}

		for _, currentRange := range entry.Ranges {
			if currentRange.Type != "SEMVER" && currentRange.Type != "ECOSYSTEM" {
				sawInconclusive = true
				continue
			}

			affected, ok := evaluateRangeEvents(currentRange.Events, version)
			if !ok {
				sawInconclusive = true
				continue
			}
			if affected {
				return rangeSupportsMatch
			}
			sawContradiction = true
		}
	}

	if sawInconclusive {
		return rangeInconclusive
	}
	if sawContradiction {
		return rangeContradictsMatch
	}
	return rangeInconclusive
}

func evaluateRangeEvents(events []osvEventSnapshot, version semverVersion) (bool, bool) {
	if len(events) == 0 {
		return false, false
	}

	isAffected := false
	for _, event := range events {
		if event.Introduced != nil {
			intro, ok := parseEventVersion(*event.Introduced)
			if !ok {
				return false, false
			}
			if intro == nil || compareSemver(version, *intro) >= 0 {
				isAffected = true
			}
		}
		if event.Fixed != nil {
			fixed, ok := parseSemver(*event.Fixed)
			if !ok {
				return false, false
			}
			if compareSemver(version, fixed) >= 0 {
				isAffected = false
			}
		}
		if event.LastKnownAffected != nil {
			lastKnown, ok := parseSemver(*event.LastKnownAffected)
			if !ok {
				return false, false
			}
			if compareSemver(version, lastKnown) > 0 {
				isAffected = false
			}
		}
	}

	return isAffected, true
}

func affectedEntryMatches(entry osvAffectedSnapshot, packageName string, ecosystem string) bool {
	if entry.Package == nil {
		return true
	}
	if entry.Package.Ecosystem != nil && !strings.EqualFold(*entry.Package.Ecosystem, ecosystem) {
		return false
	}
	if entry.Package.Name != nil && !strings.EqualFold(*entry.Package.Name, packageName) {
		return false
	}
	return true
}

func parseEventVersion(raw string) (*semverVersion, bool) {
	if raw == "0" {
		return nil, true
	}
	version, ok := parseSemver(raw)
	if !ok {
		return nil, false
	}
	return &version, true
}

func parseSemver(raw string) (semverVersion, bool) {
	cleaned := strings.TrimPrefix(raw, "v")
	base := strings.SplitN(cleaned, "-", 2)[0]
	parts := strings.Split(base, ".")
	if len(parts) == 0 || len(parts) > 3 {
		return semverVersion{}, false
	}

	values := [3]int{}
	for i := 0; i < len(parts); i++ {
		if parts[i] == "" {
			return semverVersion{}, false
		}
		value, err := strconv.Atoi(parts[i])
		if err != nil {
			return semverVersion{}, false
		}
		values[i] = value
	}

	return semverVersion{major: values[0], minor: values[1], patch: values[2]}, true
}

func compareSemver(a semverVersion, b semverVersion) int {
	switch {
	case a.major != b.major:
		if a.major < b.major {
			return -1
		}
		return 1
	case a.minor != b.minor:
		if a.minor < b.minor {
			return -1
		}
		return 1
	case a.patch != b.patch:
		if a.patch < b.patch {
			return -1
		}
		return 1
	default:
		return 0
	}
}

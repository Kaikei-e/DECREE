package db

import (
	"testing"
	"time"
)

func TestNewDetectionEvidenceIncludesSummaryAliasesAndContradiction(t *testing.T) {
	now := time.Now().UTC()
	raw := []byte(`{
		"summary":"ONNX issue discovered by OSV before UI propagation",
		"affected":[
			{
				"package":{"name":"onnx","ecosystem":"PyPI"},
				"ranges":[
					{
						"type":"ECOSYSTEM",
						"events":[
							{"introduced":"0"},
							{"last_known_affected":"1.20.0"}
						]
					}
				]
			}
		]
	}`)

	evidence := newDetectionEvidence(
		"onnx",
		"1.20.1",
		"PyPI",
		raw,
		&now,
		[]string{"GHSA-test", "OSV-test"},
	)

	if evidence == nil {
		t.Fatal("expected evidence")
	}
	if evidence.Source != "osv" {
		t.Fatalf("source = %q, want osv", evidence.Source)
	}
	if evidence.FetchedAt == nil || !evidence.FetchedAt.Equal(now) {
		t.Fatalf("fetched_at = %v, want %v", evidence.FetchedAt, now)
	}
	if evidence.Summary == nil || *evidence.Summary != "ONNX issue discovered by OSV before UI propagation" {
		t.Fatalf("summary = %v", evidence.Summary)
	}
	if evidence.RangeEvaluationStatus != rangeContradictsMatch {
		t.Fatalf("status = %q, want %q", evidence.RangeEvaluationStatus, rangeContradictsMatch)
	}
	if len(evidence.Aliases) != 2 {
		t.Fatalf("aliases = %v", evidence.Aliases)
	}
}

func TestClassifyRangeEvaluationSupportsKnownAffectedVersion(t *testing.T) {
	status := classifyRangeEvaluation(
		"onnx",
		"1.20.0",
		"PyPI",
		[]osvAffectedSnapshot{
			{
				Package: &osvAffectedPackageSnapshot{
					Name:      stringRef("onnx"),
					Ecosystem: stringRef("PyPI"),
				},
				Ranges: []osvRangeSnapshot{
					{
						Type: "ECOSYSTEM",
						Events: []osvEventSnapshot{
							{Introduced: stringRef("0")},
							{LastKnownAffected: stringRef("1.20.0")},
						},
					},
				},
			},
		},
	)

	if status != rangeSupportsMatch {
		t.Fatalf("status = %q, want %q", status, rangeSupportsMatch)
	}
}

func stringRef(v string) *string {
	return &v
}

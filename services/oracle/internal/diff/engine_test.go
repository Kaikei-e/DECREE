package diff

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/google/uuid"

	"decree/services/oracle/internal/domain"
)

func TestSeverityOrder(t *testing.T) {
	tests := []struct {
		severity string
		want     int
	}{
		{"critical", 4},
		{"high", 3},
		{"medium", 2},
		{"low", 1},
		{"unknown", 0},
		{"", 0},
	}

	for _, tt := range tests {
		got := SeverityOrder(tt.severity)
		if got != tt.want {
			t.Errorf("SeverityOrder(%q) = %d, want %d", tt.severity, got, tt.want)
		}
	}
}

func TestIndexByInstance(t *testing.T) {
	id1, id2 := uuid.New(), uuid.New()
	obs := []domain.Observation{
		{InstanceID: id1, AdvisoryID: "CVE-2024-001"},
		{InstanceID: id2, AdvisoryID: "CVE-2024-002"},
	}

	m := indexByInstance(obs)
	if len(m) != 2 {
		t.Fatalf("len = %d, want 2", len(m))
	}
	if m[id1].AdvisoryID != "CVE-2024-001" {
		t.Errorf("id1 advisory = %q", m[id1].AdvisoryID)
	}
	if m[id2].AdvisoryID != "CVE-2024-002" {
		t.Errorf("id2 advisory = %q", m[id2].AdvisoryID)
	}
}

func TestBuildEvent(t *testing.T) {
	scanID := uuid.New()
	targetID := uuid.New()
	score := float32(8.5)

	obs := domain.Observation{
		InstanceID:     uuid.New(),
		PackageName:    "lodash",
		PackageVersion: "4.17.20",
		Ecosystem:      "npm",
		AdvisoryID:     "CVE-2024-001",
		DecreeScore:    &score,
		Severity:       "high",
	}

	exploits := map[string]bool{"CVE-2024-001": true}

	evt := buildEvent(DiffNewCVE, scanID, targetID, "test-target", obs, exploits)

	if evt.Kind != DiffNewCVE {
		t.Errorf("kind = %q", evt.Kind)
	}
	if evt.PackageName != "lodash" {
		t.Errorf("package = %q", evt.PackageName)
	}
	if !evt.HasExploit {
		t.Error("should have exploit")
	}
	if *evt.DecreeScore != 8.5 {
		t.Errorf("score = %v", *evt.DecreeScore)
	}
}

// Golden test fixtures

type GoldenTestCase struct {
	Name     string           `json:"name"`
	Current  []GoldenObs      `json:"current"`
	Previous []GoldenObs      `json:"previous"`
	Exploits map[string]bool  `json:"exploits"`
	PrevExpl map[string]bool  `json:"prev_exploits"`
	Expected []GoldenExpected `json:"expected"`
}

type GoldenObs struct {
	InstanceID string   `json:"instance_id"`
	Advisory   string   `json:"advisory_id"`
	Package    string   `json:"package_name"`
	Version    string   `json:"package_version"`
	Ecosystem  string   `json:"ecosystem"`
	Score      *float32 `json:"decree_score"`
	Severity   string   `json:"severity"`
}

type GoldenExpected struct {
	Kind     string `json:"kind"`
	Advisory string `json:"advisory_id"`
}

func TestDiffDetection_Golden(t *testing.T) {
	data, err := os.ReadFile("testdata/diff_cases.json")
	if err != nil {
		t.Skipf("no golden test data: %v", err)
	}

	var cases []GoldenTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("unmarshal golden data: %v", err)
	}

	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			current := toObservations(tc.Current)
			previous := toObservations(tc.Previous)

			currentMap := indexByInstance(current)
			previousMap := indexByInstance(previous)

			scanID := uuid.New()
			targetID := uuid.New()

			var events []DiffEvent

			// new_cve
			for id, obs := range currentMap {
				if _, existed := previousMap[id]; !existed {
					evt := buildEvent(DiffNewCVE, scanID, targetID, "test", obs, tc.Exploits)
					events = append(events, evt)
				}
			}

			// resolved_cve
			for id, obs := range previousMap {
				if _, exists := currentMap[id]; !exists {
					evt := buildEvent(DiffResolvedCVE, scanID, targetID, "test", obs, nil)
					events = append(events, evt)
				}
			}

			// score_change + new_exploit
			for id, curr := range currentMap {
				prev, existed := previousMap[id]
				if !existed {
					continue
				}
				if curr.DecreeScore != nil && prev.DecreeScore != nil {
					delta := *curr.DecreeScore - *prev.DecreeScore
					if delta > 0.5 || delta < -0.5 {
						evt := buildEvent(DiffScoreChange, scanID, targetID, "test", curr, tc.Exploits)
						evt.PrevScore = prev.DecreeScore
						events = append(events, evt)
					}
				}
				if tc.Exploits[curr.AdvisoryID] && !tc.PrevExpl[curr.AdvisoryID] {
					evt := buildEvent(DiffNewExploit, scanID, targetID, "test", curr, tc.Exploits)
					events = append(events, evt)
				}
			}

			if len(events) != len(tc.Expected) {
				t.Errorf("got %d events, want %d", len(events), len(tc.Expected))
				for _, e := range events {
					t.Logf("  got: %s %s", e.Kind, e.AdvisoryID)
				}
				return
			}

			expectedMap := make(map[string]string)
			for _, e := range tc.Expected {
				expectedMap[e.Advisory+":"+e.Kind] = e.Kind
			}

			for _, e := range events {
				key := e.AdvisoryID + ":" + string(e.Kind)
				if _, ok := expectedMap[key]; !ok {
					t.Errorf("unexpected event: %s %s", e.Kind, e.AdvisoryID)
				}
			}
		})
	}
}

func toObservations(gobs []GoldenObs) []domain.Observation {
	obs := make([]domain.Observation, len(gobs))
	for i, g := range gobs {
		obs[i] = domain.Observation{
			InstanceID:     uuid.MustParse(g.InstanceID),
			PackageName:    g.Package,
			PackageVersion: g.Version,
			Ecosystem:      g.Ecosystem,
			AdvisoryID:     g.Advisory,
			DecreeScore:    g.Score,
			Severity:       g.Severity,
		}
	}
	return obs
}

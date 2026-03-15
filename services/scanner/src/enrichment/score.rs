/// Compute reachability score based on exposure class, dependency directness, and depth.
///
/// | exposure_class | direct | score                              |
/// |----------------|--------|------------------------------------|
/// | public         | true   | 10.0                               |
/// | public         | false  | max(6.0 - (depth-1)*0.5, 1.0)     |
/// | internal       | true   | 5.0                                |
/// | internal       | false  | max(3.0 - (depth-1)*0.5, 1.0)     |
/// | batch          | true   | 3.0                                |
/// | batch          | false  | max(2.0 - (depth-1)*0.5, 1.0)     |
/// | unknown / None | *      | 5.0                                |
pub fn reachability_score(exposure_class: Option<&str>, is_direct: bool, dep_depth: u32) -> f32 {
    match exposure_class {
        Some("public") if is_direct => 10.0,
        Some("public") => (6.0 - (dep_depth.saturating_sub(1) as f32) * 0.5).max(1.0),
        Some("internal") if is_direct => 5.0,
        Some("internal") => (3.0 - (dep_depth.saturating_sub(1) as f32) * 0.5).max(1.0),
        Some("batch") if is_direct => 3.0,
        Some("batch") => (2.0 - (dep_depth.saturating_sub(1) as f32) * 0.5).max(1.0),
        _ => 5.0,
    }
}

/// Compute the full DECREE Score.
///
/// ```text
/// DECREE Score = (CVSS_base × 0.4) + (EPSS × 100 × 0.35) + (Reachability × 0.25)
/// ```
///
/// Returns `None` if CVSS is not available (minimum required input).
pub fn decree_score(cvss: Option<f32>, epss: Option<f32>, reachability: f32) -> Option<f32> {
    let cvss_val = cvss?;
    let cvss_component = cvss_val * 0.4;
    let epss_component = epss.unwrap_or(0.0) * 100.0 * 0.35;
    let reach_component = reachability * 0.25;
    Some(cvss_component + epss_component + reach_component)
}

/// Map a CVSS score to a severity label.
pub fn severity_label(score: Option<f32>) -> &'static str {
    match score {
        Some(s) if s >= 9.0 => "critical",
        Some(s) if s >= 7.0 => "high",
        Some(s) if s >= 4.0 => "medium",
        Some(s) if s > 0.0 => "low",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── reachability_score ──────────────────────────────────────

    #[test]
    fn public_direct() {
        assert_eq!(reachability_score(Some("public"), true, 0), 10.0);
        assert_eq!(reachability_score(Some("public"), true, 1), 10.0);
    }

    #[test]
    fn public_transitive() {
        // depth=1 → 6.0 - 0*0.5 = 6.0
        assert_eq!(reachability_score(Some("public"), false, 1), 6.0);
        // depth=2 → 6.0 - 1*0.5 = 5.5
        assert_eq!(reachability_score(Some("public"), false, 2), 5.5);
        // depth=11 → 6.0 - 10*0.5 = 1.0
        assert_eq!(reachability_score(Some("public"), false, 11), 1.0);
        // depth=20 → clamped to 1.0
        assert_eq!(reachability_score(Some("public"), false, 20), 1.0);
    }

    #[test]
    fn internal_direct() {
        assert_eq!(reachability_score(Some("internal"), true, 0), 5.0);
    }

    #[test]
    fn internal_transitive() {
        assert_eq!(reachability_score(Some("internal"), false, 1), 3.0);
        assert_eq!(reachability_score(Some("internal"), false, 2), 2.5);
        assert_eq!(reachability_score(Some("internal"), false, 5), 1.0);
        assert_eq!(reachability_score(Some("internal"), false, 10), 1.0);
    }

    #[test]
    fn batch_direct() {
        assert_eq!(reachability_score(Some("batch"), true, 0), 3.0);
    }

    #[test]
    fn batch_transitive() {
        assert_eq!(reachability_score(Some("batch"), false, 1), 2.0);
        assert_eq!(reachability_score(Some("batch"), false, 2), 1.5);
        assert_eq!(reachability_score(Some("batch"), false, 3), 1.0);
        assert_eq!(reachability_score(Some("batch"), false, 10), 1.0);
    }

    #[test]
    fn unknown_or_none() {
        assert_eq!(reachability_score(None, true, 0), 5.0);
        assert_eq!(reachability_score(None, false, 3), 5.0);
        assert_eq!(reachability_score(Some("unknown"), true, 0), 5.0);
        assert_eq!(reachability_score(Some("unknown"), false, 5), 5.0);
    }

    // ── decree_score ────────────────────────────────────────────

    #[test]
    fn full_score_all_inputs() {
        // CVSS=9.0, EPSS=0.5, Reachability=10.0
        // = (9.0*0.4) + (0.5*100*0.35) + (10.0*0.25)
        // = 3.6 + 17.5 + 2.5 = 23.6
        let score = decree_score(Some(9.0), Some(0.5), 10.0).unwrap();
        assert!((score - 23.6).abs() < 0.01);
    }

    #[test]
    fn score_without_epss() {
        // CVSS=7.0, EPSS=None, Reachability=5.0
        // = (7.0*0.4) + (0.0*100*0.35) + (5.0*0.25)
        // = 2.8 + 0.0 + 1.25 = 4.05
        let score = decree_score(Some(7.0), None, 5.0).unwrap();
        assert!((score - 4.05).abs() < 0.01);
    }

    #[test]
    fn score_without_cvss_returns_none() {
        assert!(decree_score(None, Some(0.5), 5.0).is_none());
    }

    #[test]
    fn score_all_zeros() {
        let score = decree_score(Some(0.0), Some(0.0), 0.0).unwrap();
        assert!((score - 0.0).abs() < 0.01);
    }

    #[test]
    fn score_max_inputs() {
        // CVSS=10.0, EPSS=1.0, Reachability=10.0
        // = (10.0*0.4) + (1.0*100*0.35) + (10.0*0.25)
        // = 4.0 + 35.0 + 2.5 = 41.5
        let score = decree_score(Some(10.0), Some(1.0), 10.0).unwrap();
        assert!((score - 41.5).abs() < 0.01);
    }

    #[test]
    fn score_low_epss() {
        // CVSS=5.0, EPSS=0.01, Reachability=3.0
        // = (5.0*0.4) + (0.01*100*0.35) + (3.0*0.25)
        // = 2.0 + 0.35 + 0.75 = 3.1
        let score = decree_score(Some(5.0), Some(0.01), 3.0).unwrap();
        assert!((score - 3.1).abs() < 0.01);
    }

    // ── severity_label ──────────────────────────────────────────

    #[test]
    fn severity_mapping() {
        assert_eq!(severity_label(Some(9.8)), "critical");
        assert_eq!(severity_label(Some(9.0)), "critical");
        assert_eq!(severity_label(Some(7.5)), "high");
        assert_eq!(severity_label(Some(7.0)), "high");
        assert_eq!(severity_label(Some(5.0)), "medium");
        assert_eq!(severity_label(Some(4.0)), "medium");
        assert_eq!(severity_label(Some(2.0)), "low");
        assert_eq!(severity_label(Some(0.1)), "low");
        assert_eq!(severity_label(Some(0.0)), "unknown");
        assert_eq!(severity_label(None), "unknown");
    }
}

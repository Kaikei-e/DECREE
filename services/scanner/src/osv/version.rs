use crate::osv::types::OsvAffected;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeEvaluationStatus {
    SupportsMatch,
    ContradictsMatch,
    Inconclusive,
}

impl RangeEvaluationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SupportsMatch => "supports_match",
            Self::ContradictsMatch => "contradicts_match",
            Self::Inconclusive => "inconclusive",
        }
    }
}

/// Check whether a package version falls within any of the affected ranges
/// declared by an OSV vulnerability entry.
///
/// Returns `true` (conservatively "affected") when:
/// - The version or range versions cannot be parsed as semver
/// - The range type is not SEMVER or ECOSYSTEM (e.g. GIT)
/// - No affected entries match the package name/ecosystem
/// - The affected list is empty
///
/// Returns `false` only when we can **definitively prove** the version
/// is outside every applicable affected range.
pub fn is_version_affected(
    pkg_name: &str,
    pkg_version: &str,
    ecosystem: &str,
    affected_entries: &[OsvAffected],
) -> bool {
    !matches!(
        classify_version_match(pkg_name, pkg_version, ecosystem, affected_entries),
        RangeEvaluationStatus::ContradictsMatch
    )
}

pub fn classify_version_match(
    pkg_name: &str,
    pkg_version: &str,
    ecosystem: &str,
    affected_entries: &[OsvAffected],
) -> RangeEvaluationStatus {
    let parsed_version = match parse_version(pkg_version) {
        Some(v) => v,
        None => return RangeEvaluationStatus::Inconclusive,
    };

    // Collect only affected entries that match our package
    let matching: Vec<&OsvAffected> = affected_entries
        .iter()
        .filter(|a| entry_matches_package(a, pkg_name, ecosystem))
        .collect();

    if matching.is_empty() {
        // No affected entry matches our package name/ecosystem.
        // If there ARE affected entries but none match our package, the vuln
        // doesn't apply to us. If there are NO affected entries at all,
        // be conservative.
        if affected_entries.is_empty() {
            return RangeEvaluationStatus::Inconclusive;
        }
        // All entries are for other packages — not affected
        return RangeEvaluationStatus::ContradictsMatch;
    }

    let mut saw_contradiction = false;
    let mut saw_inconclusive = false;

    // For each matching affected entry, check all its ranges.
    // The package is supported if ANY range in ANY matching entry says so.
    for affected in &matching {
        if affected.ranges.is_empty() {
            saw_inconclusive = true;
            continue;
        }

        for range in &affected.ranges {
            match range.range_type.as_str() {
                "SEMVER" | "ECOSYSTEM" => {}
                _ => {
                    saw_inconclusive = true;
                    continue;
                }
            }

            match evaluate_range_events(&range.events, &parsed_version) {
                Some(true) => return RangeEvaluationStatus::SupportsMatch,
                Some(false) => saw_contradiction = true,
                None => saw_inconclusive = true,
            }
        }
    }

    if saw_inconclusive {
        RangeEvaluationStatus::Inconclusive
    } else if saw_contradiction {
        RangeEvaluationStatus::ContradictsMatch
    } else {
        RangeEvaluationStatus::Inconclusive
    }
}

/// Evaluate a single range's events against a parsed version.
/// Returns Some(true/false) when the range can be evaluated, or None when it
/// is safer to treat the result as inconclusive.
///
/// OSV spec: walk events in order, tracking `is_affected`.
/// - `introduced`: if version >= introduced, set is_affected = true
/// - `fixed`: if version >= fixed, set is_affected = false
/// - `last_known_affected`: if version > last_known_affected, set is_affected = false
fn evaluate_range_events(
    events: &[crate::osv::types::OsvEvent],
    version: &semver::Version,
) -> Option<bool> {
    if events.is_empty() {
        return None;
    }

    let mut is_affected = false;

    for event in events {
        if let Some(ref introduced) = event.introduced {
            match parse_version(introduced) {
                Some(intro_ver) => {
                    if version >= &intro_ver {
                        is_affected = true;
                    }
                }
                None => {
                    // "0" is a common sentinel meaning "all versions"
                    if introduced == "0" {
                        is_affected = true;
                    } else {
                        return None;
                    }
                }
            }
        }
        if let Some(ref fixed) = event.fixed {
            match parse_version(fixed) {
                Some(fixed_ver) => {
                    if version >= &fixed_ver {
                        is_affected = false;
                    }
                }
                None => return None,
            }
        }
        if let Some(ref last_known_affected) = event.last_known_affected {
            match parse_version(last_known_affected) {
                Some(last_known_ver) => {
                    if version > &last_known_ver {
                        is_affected = false;
                    }
                }
                None => return None,
            }
        }
    }

    Some(is_affected)
}

/// Check if an OsvAffected entry matches the given package name and ecosystem.
fn entry_matches_package(affected: &OsvAffected, pkg_name: &str, ecosystem: &str) -> bool {
    let Some(ref pkg) = affected.package else {
        // No package info → could match anything, be conservative
        return true;
    };

    // If ecosystem is specified and doesn't match, skip
    if let Some(ref eco) = pkg.ecosystem
        && !eco.eq_ignore_ascii_case(ecosystem)
    {
        return false;
    }

    // If name is specified and doesn't match, skip
    if let Some(ref name) = pkg.name
        && !name.eq_ignore_ascii_case(pkg_name)
    {
        return false;
    }

    true
}

/// Parse a version string, trying strict semver first, then lenient.
fn parse_version(version_str: &str) -> Option<semver::Version> {
    // Strip leading 'v' if present
    let cleaned = version_str.strip_prefix('v').unwrap_or(version_str);

    // Try strict parse first
    if let Ok(v) = semver::Version::parse(cleaned) {
        return Some(v);
    }

    // Lenient: try padding with .0 segments
    let parts: Vec<&str> = cleaned.split('.').collect();
    match parts.len() {
        1 => semver::Version::parse(&format!("{}.0.0", parts[0])).ok(),
        2 => semver::Version::parse(&format!("{}.{}.0", parts[0], parts[1])).ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osv::types::{OsvAffected, OsvAffectedPackage, OsvEvent, OsvRange};

    fn make_affected(pkg_name: &str, ecosystem: &str, ranges: Vec<OsvRange>) -> OsvAffected {
        OsvAffected {
            package: Some(OsvAffectedPackage {
                name: Some(pkg_name.to_string()),
                ecosystem: Some(ecosystem.to_string()),
            }),
            ranges,
        }
    }

    fn semver_range(events: Vec<OsvEvent>) -> OsvRange {
        OsvRange {
            range_type: "SEMVER".to_string(),
            events,
        }
    }

    fn ecosystem_range(events: Vec<OsvEvent>) -> OsvRange {
        OsvRange {
            range_type: "ECOSYSTEM".to_string(),
            events,
        }
    }

    fn introduced(v: &str) -> OsvEvent {
        OsvEvent {
            introduced: Some(v.to_string()),
            fixed: None,
            last_known_affected: None,
        }
    }

    fn fixed(v: &str) -> OsvEvent {
        OsvEvent {
            introduced: None,
            fixed: Some(v.to_string()),
            last_known_affected: None,
        }
    }

    fn last_known_affected(v: &str) -> OsvEvent {
        OsvEvent {
            introduced: None,
            fixed: None,
            last_known_affected: Some(v.to_string()),
        }
    }

    // 1. Version within a single affected range → affected
    #[test]
    fn version_within_range_is_affected() {
        let affected = vec![make_affected(
            "lodash",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("4.17.21")])],
        )];
        assert!(is_version_affected("lodash", "4.17.20", "npm", &affected));
    }

    // 2. Fixed version exactly → NOT affected (half-open: [introduced, fixed))
    #[test]
    fn fixed_version_exactly_is_not_affected() {
        let affected = vec![make_affected(
            "lodash",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("4.17.21")])],
        )];
        assert!(!is_version_affected("lodash", "4.17.21", "npm", &affected));
    }

    // 3. Version above fixed → NOT affected
    #[test]
    fn version_above_fixed_is_not_affected() {
        let affected = vec![make_affected(
            "lodash",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("4.17.21")])],
        )];
        assert!(!is_version_affected("lodash", "4.18.0", "npm", &affected));
    }

    // 4. Version above fix in ECOSYSTEM range → NOT affected
    //    Advisory says affected introduced=0, fixed=1.20.0
    //    1.20.1 is above the fix → NOT affected
    #[test]
    fn version_above_fix_in_ecosystem_range_not_affected() {
        let affected = vec![make_affected(
            "onnx",
            "PyPI",
            vec![ecosystem_range(vec![introduced("0"), fixed("1.20.0")])],
        )];
        assert!(!is_version_affected("onnx", "1.20.1", "PyPI", &affected));
    }

    // 5. Multiple disjoint ranges, one matches → affected
    #[test]
    fn multiple_ranges_one_matching_is_affected() {
        let affected = vec![make_affected(
            "foo",
            "npm",
            vec![
                semver_range(vec![introduced("1.0.0"), fixed("1.5.0")]),
                semver_range(vec![introduced("2.0.0"), fixed("2.3.0")]),
            ],
        )];
        // 2.1.0 is in the second range
        assert!(is_version_affected("foo", "2.1.0", "npm", &affected));
        // 1.6.0 is between ranges — not affected
        assert!(!is_version_affected("foo", "1.6.0", "npm", &affected));
    }

    // 6. Empty affected list → conservatively affected
    #[test]
    fn empty_affected_is_conservatively_affected() {
        assert!(is_version_affected("anything", "1.0.0", "npm", &[]));
    }

    // 7. GIT range type → conservatively affected
    #[test]
    fn git_range_type_is_conservatively_affected() {
        let affected = vec![OsvAffected {
            package: Some(OsvAffectedPackage {
                name: Some("foo".to_string()),
                ecosystem: Some("npm".to_string()),
            }),
            ranges: vec![OsvRange {
                range_type: "GIT".to_string(),
                events: vec![],
            }],
        }];
        assert!(is_version_affected("foo", "1.0.0", "npm", &affected));
    }

    // 8. Package name mismatch → affected entry ignored, not affected
    #[test]
    fn package_name_mismatch_not_affected() {
        let affected = vec![make_affected(
            "other-pkg",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("99.0.0")])],
        )];
        assert!(!is_version_affected("my-pkg", "1.0.0", "npm", &affected));
    }

    // 9. Unparseable package version → conservatively affected
    #[test]
    fn unparseable_version_is_conservatively_affected() {
        let affected = vec![make_affected(
            "foo",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("2.0.0")])],
        )];
        assert!(is_version_affected(
            "foo",
            "not-a-version",
            "npm",
            &affected
        ));
    }

    // 10. Version below introduced → not affected
    #[test]
    fn version_below_introduced_is_not_affected() {
        let affected = vec![make_affected(
            "foo",
            "npm",
            vec![semver_range(vec![introduced("2.0.0"), fixed("3.0.0")])],
        )];
        assert!(!is_version_affected("foo", "1.5.0", "npm", &affected));
    }

    // 11. Lenient version parsing (two-part version)
    #[test]
    fn lenient_two_part_version_parsing() {
        let affected = vec![make_affected(
            "foo",
            "PyPI",
            vec![ecosystem_range(vec![introduced("0"), fixed("2.0.0")])],
        )];
        assert!(is_version_affected("foo", "1.5", "PyPI", &affected));
        assert!(!is_version_affected("foo", "2.1", "PyPI", &affected));
    }

    // 12. Version with 'v' prefix
    #[test]
    fn version_with_v_prefix() {
        let affected = vec![make_affected(
            "foo",
            "npm",
            vec![semver_range(vec![introduced("0"), fixed("2.0.0")])],
        )];
        assert!(!is_version_affected("foo", "v2.0.0", "npm", &affected));
        assert!(is_version_affected("foo", "v1.9.0", "npm", &affected));
    }

    // 13. Case-insensitive ecosystem matching
    #[test]
    fn case_insensitive_ecosystem_matching() {
        let affected = vec![make_affected(
            "onnx",
            "PyPI",
            vec![ecosystem_range(vec![introduced("0"), fixed("1.20.0")])],
        )];
        assert!(!is_version_affected("onnx", "1.20.1", "pypi", &affected));
    }

    // 14. Affected entry with no package info → conservative match
    #[test]
    fn no_package_info_is_conservative() {
        let affected = vec![OsvAffected {
            package: None,
            ranges: vec![semver_range(vec![introduced("0"), fixed("2.0.0")])],
        }];
        assert!(is_version_affected("foo", "1.0.0", "npm", &affected));
        assert!(!is_version_affected("foo", "3.0.0", "npm", &affected));
    }

    // 15. last_known_affected is inclusive, so version above it is not affected
    #[test]
    fn version_above_last_known_affected_is_not_affected() {
        let affected = vec![make_affected(
            "onnx",
            "PyPI",
            vec![ecosystem_range(vec![
                introduced("0"),
                last_known_affected("1.20.0"),
            ])],
        )];
        assert!(!is_version_affected("onnx", "1.20.1", "PyPI", &affected));
        assert_eq!(
            classify_version_match("onnx", "1.20.1", "PyPI", &affected),
            RangeEvaluationStatus::ContradictsMatch
        );
    }

    // 16. last_known_affected is inclusive, so the boundary version stays affected
    #[test]
    fn last_known_affected_boundary_is_affected() {
        let affected = vec![make_affected(
            "onnx",
            "PyPI",
            vec![ecosystem_range(vec![
                introduced("0"),
                last_known_affected("1.20.0"),
            ])],
        )];
        assert!(is_version_affected("onnx", "1.20.0", "PyPI", &affected));
        assert_eq!(
            classify_version_match("onnx", "1.20.0", "PyPI", &affected),
            RangeEvaluationStatus::SupportsMatch
        );
    }

    // 17. Unparseable last_known_affected keeps the advisory conservatively
    #[test]
    fn unparseable_last_known_affected_is_conservative() {
        let affected = vec![make_affected(
            "onnx",
            "PyPI",
            vec![ecosystem_range(vec![
                introduced("0"),
                last_known_affected("not-a-version"),
            ])],
        )];
        assert!(is_version_affected("onnx", "1.20.1", "PyPI", &affected));
        assert_eq!(
            classify_version_match("onnx", "1.20.1", "PyPI", &affected),
            RangeEvaluationStatus::Inconclusive
        );
    }
}

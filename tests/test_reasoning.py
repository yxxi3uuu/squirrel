import unittest

from reasoning.builder import build_decision_record
from reasoning.rules import calculate_ete, classify_traffic_level


class ReasoningRulesTest(unittest.TestCase):
    def test_classifies_a_level_at_boundary(self):
        rule, result = classify_traffic_level(
            "RD_TEST",
            {"saturation_score": 0.95},
            ["EV-001"],
        )

        self.assertEqual(result.level, "A")
        self.assertEqual(rule.sop_id, "SOP-1")
        self.assertEqual(rule.observed, 0.95)

    def test_classifies_b_level_at_boundary(self):
        _, result = classify_traffic_level(
            "RD_TEST",
            {"saturation_score": 0.85},
            ["EV-001"],
        )

        self.assertEqual(result.level, "B")

    def test_calculates_ete_from_sop_formula(self):
        result = calculate_ete("High", [0.9], ["EV-001"])

        self.assertEqual(result.base_minutes, 40.0)
        self.assertEqual(result.congestion_adjustment_minutes, 24.0)
        self.assertEqual(result.total_minutes, 64.0)


class DecisionBuilderTest(unittest.TestCase):
    def test_builds_demo_decision_with_evidence_chain(self):
        record = build_decision_record("2026-05-20 22:15", "TPE_2026_ACC_001")

        self.assertEqual(record.classification.level, "A")
        self.assertEqual(record.ete.total_minutes, 90.0)
        self.assertTrue(record.evidence)
        self.assertTrue(record.route_candidates)
        self.assertTrue(record.explanation.summary)
        self.assertFalse([issue for issue in record.validation_issues if issue.severity == "error"])

    def test_excludes_low_capacity_route(self):
        record = build_decision_record("2026-05-20 22:15", "TPE_2026_ACC_001")
        yanji = next(route for route in record.route_candidates if route.segment_id == "RD_TPE_008")

        self.assertIn("INSUFFICIENT_CAPACITY", yanji.exclusion_codes)
        self.assertEqual(yanji.status, "excluded")


if __name__ == "__main__":
    unittest.main()

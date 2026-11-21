import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import report


class ReviewPracticesTest(unittest.TestCase):
    def setUp(self):
        self.plan = report.phase_zero("head-coach", "2026-01-01T00:00:00Z")
        self.tasks = [{"id": f"G{i}", "completion": "unaided"} for i in range(1, 6)]
        self.tasks += [{"id": task_id, "completion": "unaided"} for task_id in self.plan["role_task_ids"]]
        self.tasks[-1].update(steps=3, stages=[{"id": stage, "steps": 1} for stage in report.STAGES["head-coach"]])
        self.check = {"task_id": "W1", "result": "reached", "count": 2, "actions": ["Open", "Seek"],
                      "evidence": "ui: evidence/head-coach/test/frame.png"}
        self.data = {"tasks": self.tasks, "phase_0": self.plan, "findings": [], "method": {"live_ui": True},
                     "input_checks": [{"task_id": "W1", "result": "warned", "finding_id": None,
                                       "evidence": "ui: evidence/head-coach/test/warning.png"}],
                     "ai_evidence": {"complete": True, "checks": [self.check]}, "verdict": {"would_use": "yes"}}

    def test_counts_weekly_cycle_and_excludes_orientation(self):
        self.tasks[-1]["completion"] = "abandoned"
        scored = report.scorecard(self.data, self.plan)
        self.assertEqual(scored["role_tasks"], {"met": True, "unaided": 6, "total": 7})
        self.tasks[-2]["completion"] = "with_help"
        scored = report.scorecard(self.data, self.plan)
        self.assertEqual(scored["role_tasks"], {"met": False, "unaided": 5, "total": 7})
        self.assertFalse(scored["overall_met"])

    def test_every_output_needs_the_correct_evidence_within_two_interactions(self):
        scored = report.scorecard(self.data, self.plan)
        self.assertEqual(scored["ai_evidence"], {"met": True, "within_budget": 2, "total": 2})
        for result, actions, complete, within_budget in [
                ("reached", ["A", "B", "C"], True, 0), ("wrong_target", ["A"], True, 0),
                ("missing", [], True, 0), ("unverified", [], True, 0), ("reached", [], False, 2)]:
            with self.subTest(result=result, actions=actions, complete=complete):
                self.check.update(result=result, actions=actions)
                self.data["ai_evidence"]["complete"] = complete
                scored = report.scorecard(self.data, self.plan)
                self.assertEqual(scored["ai_evidence"], {"met": False, "within_budget": within_budget, "total": 2})
        self.data["ai_evidence"] = {"complete": True, "checks": []}
        self.assertFalse(report.scorecard(self.data, self.plan)["ai_evidence"]["met"])

    def test_conditional_use_and_silent_loss_are_distinct_criteria(self):
        self.data["verdict"]["would_use"] = "conditional"
        self.data["success_criteria"] = report.scorecard(self.data, self.plan)
        self.assertFalse(self.data["success_criteria"]["would_use"]["met"])
        self.assertTrue(self.data["success_criteria"]["data_loss"]["met"])
        self.data["findings"] = [{"id": "HC-01", "data_loss": True, "urgency": "high", "value": "high",
                                  "cost_of_delay": 9, "rank": 1}]
        self.data["success_criteria"] = report.scorecard(self.data, self.plan)
        self.assertEqual(self.data["success_criteria"]["data_loss"], {"met": False, "finding_ids": ["HC-01"]})
        with self.assertRaisesRegex(ValueError, "Input probes and data-loss findings disagree"):
            report.validate_practices(self.data, "head-coach", datetime(2026, 1, 2, tzinfo=timezone.utc))
        self.data["input_checks"][0].update(result="lost", finding_id="HC-01")
        report.validate_practices(self.data, "head-coach", datetime(2026, 1, 2, tzinfo=timezone.utc))

    def test_cost_then_urgency_then_permanent_id_determine_rank(self):
        findings = [
            dict(id="HC-03", severity="blocker", urgency="medium", value="high"),
            dict(id="HC-02", severity="minor", urgency="high", value="medium"),
            dict(id="HC-01", severity="major", urgency="high", value="medium"),
            dict(id="HC-04", severity="major", urgency="high", value="high"),
        ]
        self.assertEqual([f["id"] for f in sorted(findings, key=report.priority_key)],
                         ["HC-04", "HC-01", "HC-02", "HC-03"])

    def test_round_two_keeps_prior_priority_for_changed_and_resolved_ids(self):
        def finding(fid, rank, score, moscow):
            return {"id": fid, "rank": rank, "cost_of_delay": score, "moscow": moscow, "title": fid}

        old = {"findings": [finding("HC-01", 1, 9, "must"), finding("HC-02", 2, 4, "should")]}
        new = {"findings": [finding("HC-03", 1, 9, "must"), finding("HC-01", 2, 2, "could")]}
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sample.txt").write_text("Current observation\n")
            evidence = "source: sample.txt:1"
            comparison = {"prior": [{"id": "HC-02", "status": "resolved", "evidence": evidence, "reason": "Verified"},
                                    {"id": "HC-01", "status": "improved", "evidence": evidence, "reason": "Less rework"}],
                          "new": ["HC-03"]}
            rendered = report.comparison_markdown(comparison, old, new, root, root, "head-coach", "test")
        self.assertIn("HC-01 | improved | #1 / 9 / must | #2 / 2 / could", rendered)
        self.assertIn("HC-02 | resolved | #2 / 4 / should | Resolved", rendered)
        self.assertIn("HC-03 · #1 / 9 / must", rendered)


if __name__ == "__main__":
    unittest.main()

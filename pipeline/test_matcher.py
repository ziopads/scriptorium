#!/usr/bin/env python3
"""The quotation matcher in dossier.py against the shared fixtures.

    pipeline/.venv/bin/python3 pipeline/test_matcher.py

Checks normalize, key and Book.find against tests/matcher/expected.json, and
against tests/matcher/corpus.json when that file exists (it is gitignored).
tests/matcher.test.ts checks lib/matcher.ts against the same files.

expected.json is generated from dossier.py by matcher_fixtures.py, so a
failure here means dossier.py or cases.json changed since it was generated.
If the change is intended, regenerate expected.json, read its diff, and make
lib/matcher.ts pass again before pushing.
"""

from __future__ import annotations

import json
import unittest

from dossier import Book
from matcher_fixtures import CASES, CORPUS, EXPECTED, run_cases, run_find


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class Cases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.actual = run_cases(load(CASES))
        cls.expected = load(EXPECTED)

    def check(self, section: str) -> None:
        got, want = self.actual[section], self.expected.get(section, {})
        self.assertEqual(
            sorted(got), sorted(want),
            f"{section}: the case ids differ from expected.json; run matcher_fixtures.py",
        )
        for case_id, value in got.items():
            with self.subTest(section=section, case=case_id):
                self.assertEqual(value, want[case_id])

    def test_normalize(self):
        self.check("normalize")

    def test_key(self):
        self.check("key")

    def test_find(self):
        self.check("find")

    def test_percent(self):
        self.check("percent")


class Corpus(unittest.TestCase):
    def test_corpus(self):
        if not CORPUS.exists():
            self.skipTest("tests/matcher/corpus.json is absent")
        data = load(CORPUS)
        books = {w: Book(p) for w, p in data["books"].items()}
        for case in data["find"]:
            with self.subTest(case=case["id"]):
                self.assertEqual(run_find(books, case), data["expected"][case["id"]])


if __name__ == "__main__":
    unittest.main(verbosity=2)

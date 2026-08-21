import unittest
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from data.f1_2026 import (
    DRIVERS_2026,
    TEAMS_2026,
    CALENDAR_2026,
    DRIVERS_STANDINGS_2026,
    TEAMS_STANDINGS_2026,
    get_static_payload,
    get_driver_color,
)


class TestF12026Data(unittest.TestCase):
    """Validation tests for the 2026 season static database."""

    def test_drivers_data_integrity(self):
        """All drivers should have valid names, acronyms, team affiliations, and flags."""
        self.assertGreaterEqual(len(DRIVERS_2026), 20)
        for num, driver in DRIVERS_2026.items():
            self.assertIsInstance(num, int)
            self.assertTrue(driver["name"])
            self.assertEqual(len(driver["acronym"]), 3)
            self.assertIn(driver["team"], TEAMS_2026)
            self.assertTrue(driver["flag"])

    def test_teams_data_integrity(self):
        """All teams should have valid hex colors and short codes."""
        self.assertGreaterEqual(len(TEAMS_2026), 10)
        for team_name, team_info in TEAMS_2026.items():
            self.assertTrue(team_name)
            self.assertTrue(team_info["color"].startswith("#"))
            self.assertEqual(len(team_info["color"]), 7)
            self.assertTrue(team_info["short"])

    def test_calendar_data(self):
        """Season calendar should contain race rounds and locations."""
        self.assertGreater(len(CALENDAR_2026), 20)
        for grand_prix in CALENDAR_2026:
            self.assertIn("round", grand_prix)
            self.assertIn("name", grand_prix)
            self.assertIn("circuit", grand_prix)
            self.assertIn("country", grand_prix)

    def test_standings_data(self):
        """Standings data contains valid ranks and point totals."""
        self.assertGreater(len(DRIVERS_STANDINGS_2026), 15)
        self.assertGreater(len(TEAMS_STANDINGS_2026), 8)
        self.assertEqual(DRIVERS_STANDINGS_2026[0]["position"], 1)

    def test_static_payload_builder(self):
        """get_static_payload should return complete structured JSON dictionary."""
        payload = get_static_payload()
        self.assertIn("drivers", payload)
        self.assertIn("teams", payload)
        self.assertIn("calendar", payload)
        self.assertIn("drivers_standings", payload)
        self.assertIn("teams_standings", payload)

    def test_get_driver_color(self):
        """Helper returns team color or fallback."""
        color_nor = get_driver_color(1)  # Lando Norris (McLaren: #FF8000)
        self.assertEqual(color_nor, "#FF8000")
        color_fallback = get_driver_color(9999)
        self.assertTrue(color_fallback.startswith("#"))


if __name__ == "__main__":
    unittest.main()

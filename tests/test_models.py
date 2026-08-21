import unittest
import sys
import os
import time

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

try:
    from models import (
        DriverTelemetry,
        WeatherState,
        RaceControlMessage,
        SessionState,
        BroadcastPayload,
    )
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False


class TestModels(unittest.TestCase):
    """Validation tests for Pydantic models & default value guarantees."""

    @unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed in local environment")
    def test_driver_telemetry_defaults(self):
        dt = DriverTelemetry(driver_number=1)
        self.assertEqual(dt.driver_number, 1)
        self.assertEqual(dt.acronym, "---")
        self.assertEqual(dt.compound, "UNKNOWN")
        self.assertEqual(dt.speed, 0)
        self.assertEqual(dt.drs, False)

    @unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed in local environment")
    def test_session_state_defaults(self):
        ss = SessionState()
        self.assertEqual(ss.track_status, "1")
        self.assertEqual(ss.safety_car, False)
        self.assertEqual(ss.lap_current, 0)

    @unittest.skipUnless(HAS_PYDANTIC, "pydantic not installed in local environment")
    def test_broadcast_payload_serialization(self):
        payload = BroadcastPayload(
            server_ts=time.time(),
            session=SessionState(session_name="Race", lap_current=12, lap_total=50),
            standings=[
                DriverTelemetry(driver_number=1, acronym="VER", speed=320, position=1),
                DriverTelemetry(driver_number=16, acronym="LEC", speed=318, position=2),
            ],
            weather=WeatherState(air_temp=25.0, track_temp=35.5),
            race_control=[RaceControlMessage(flag="GREEN", message="TRACK CLEAR")],
        )

        data = payload.model_dump()
        self.assertIn("server_ts", data)
        self.assertEqual(len(data["standings"]), 2)
        self.assertEqual(data["standings"][0]["acronym"], "VER")
        self.assertEqual(data["standings"][1]["position"], 2)


if __name__ == "__main__":
    unittest.main()

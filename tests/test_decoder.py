import base64
import zlib
import unittest
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from decoder import decode_f1_z_payload, filter_position


class TestDecoder(unittest.TestCase):
    """Unit tests for the SignalR telemetry frame decoder."""

    def test_decode_zlib_compressed_payload(self):
        """Compressed Base64 payloads should decompress into original dict."""
        sample_json = '{"R": {"SessionInfo": {"Meeting": {"Name": "Monaco GP"}}}}'
        
        # Compress using raw deflate (-15 wbits)
        compressor = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        compressed = compressor.compress(sample_json.encode("utf-8")) + compressor.flush()
        b64_encoded = base64.b64encode(compressed).decode("ascii")

        decoded = decode_f1_z_payload(b64_encoded)
        self.assertEqual(decoded, {"R": {"SessionInfo": {"Meeting": {"Name": "Monaco GP"}}}})

    def test_decode_empty_or_none(self):
        """Empty input should return empty dict."""
        self.assertEqual(decode_f1_z_payload(""), {})

    def test_filter_position(self):
        """Anti-snapping should reject {X:0, Y:0} coordinate anomalies."""
        self.assertFalse(filter_position({"X": 0, "Y": 0}))
        self.assertTrue(filter_position({"X": 100, "Y": 250}))
        self.assertTrue(filter_position({"X": 0, "Y": 150}))


if __name__ == "__main__":
    unittest.main()

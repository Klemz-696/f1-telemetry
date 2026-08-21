import unittest
import subprocess
import os


class TestProxySyntax(unittest.TestCase):
    """Validation test for Node.js proxy syntax and package configuration."""

    def test_package_json_exists(self):
        pkg_path = os.path.join(os.path.dirname(__file__), "..", "proxy-server", "package.json")
        self.assertTrue(os.path.exists(pkg_path))

    def test_node_syntax_check(self):
        """If node is available, verify syntax of server.js."""
        try:
            res = subprocess.run(
                ["node", "--check", "proxy-server/server.js"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=os.path.join(os.path.dirname(__file__), ".."),
            )
            self.assertEqual(res.returncode, 0, f"Node syntax check failed: {res.stderr}")
        except FileNotFoundError:
            self.skipTest("node executable not found in PATH")


if __name__ == "__main__":
    unittest.main()

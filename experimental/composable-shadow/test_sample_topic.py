import unittest

from sample_topic import sample_once


class TopicSampleGuardTests(unittest.TestCase):
    def test_rejects_invalid_topic_before_loading_ros(self):
        with self.assertRaisesRegex(ValueError, "invalid_topic_or_message_type"):
            sample_once("relative", "example_interfaces/msg/String", "0" * 64, 1)

    def test_rejects_invalid_fingerprint_before_loading_ros(self):
        with self.assertRaisesRegex(ValueError, "invalid_interface_fingerprint"):
            sample_once("/status", "example_interfaces/msg/String", "invalid", 1)

    def test_rejects_unbounded_wait_before_loading_ros(self):
        with self.assertRaisesRegex(ValueError, "sample_timeout_out_of_range"):
            sample_once("/status", "example_interfaces/msg/String", "0" * 64, 100)


if __name__ == "__main__":
    unittest.main()

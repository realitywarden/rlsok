"""Focused tests of topic metadata collection. No ROS installation or robot used."""
import ast
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from test_collect import collect, message, slot, NOW


class MessageInterfaces:
    def __init__(self):
        vector = slot('NamespacedType', namespaces=('geometry_msgs', 'msg'), name='Vector3')
        self.types = {
            'geometry_msgs/msg/Vector3': message([(axis, slot('BasicType', typename='double')) for axis in ('x', 'y', 'z')]),
            'geometry_msgs/msg/Twist': message([('linear', vector), ('angular', vector)])}

    def describe(self, name):
        def no_action(_):
            raise AssertionError('Message discovery must not load an action')
        return collect.describe_interface(name, no_action, self.types.__getitem__)


class TopicTests(unittest.TestCase):
    def provider(self, subscriptions=None):
        provider = collect.RosGraphProvider()
        provider.graph_ready = True
        provider.interfaces = MessageInterfaces()
        provider.environment = lambda: {'rosDistro': 'jazzy', 'rmwImplementation': 'rmw_fastrtps_cpp', 'domainId': 42}
        provider.action_servers = lambda _: {}
        info = SimpleNamespace(node_name='gait_input', node_namespace='/sim', topic_type='geometry_msgs/msg/Twist')
        provider.node = SimpleNamespace(
            get_node_names_and_namespaces=lambda: [('gait_input', '/sim'), ('logger', '/')],
            get_topic_names_and_types=lambda: [('/sim/cmd_vel', ['geometry_msgs/msg/Twist'])],
            get_subscriptions_info_by_topic=lambda _: [info] if subscriptions is None else subscriptions)
        return provider

    def test_message_definition_and_catalog_are_canonical(self):
        catalog = collect.discover_interfaces(self.provider())
        topic = catalog['topics'][0]
        self.assertEqual(topic['subscribers'], [{'name': 'gait_input', 'namespace': '/sim', 'count': 1}])
        self.assertEqual(topic['typeTree']['algorithm'], 'rosidl-message-fields-tree/v1')
        digest = hashlib.sha256(json.dumps(topic['typeTree'], sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()
        self.assertEqual(digest, topic['interfaceSha256'])

    def test_duplicate_subscriptions_counted_not_collapsed_to_one(self):
        info = SimpleNamespace(node_name='gait_input', node_namespace='/sim', topic_type='geometry_msgs/msg/Twist')
        self.assertEqual(self.provider([info, info]).topic_subscribers(None)['/sim/cmd_vel']['subscribers'][0]['count'], 2)

    def test_conflicting_types_and_duplicate_node_names_fail(self):
        provider = self.provider()
        provider.node.get_topic_names_and_types = lambda: [('/sim/cmd_vel', ['geometry_msgs/msg/Twist', 'other_msgs/msg/Velocity'])]
        with self.assertRaisesRegex(collect.CollectionError, 'ambiguous'):
            provider.topic_subscribers(None)
        provider = self.provider()
        provider.node.get_node_names_and_namespaces = lambda: [('same', '/'), ('same', '/')]
        with self.assertRaisesRegex(collect.CollectionError, 'ambiguous'):
            provider.topic_subscribers(None)

    def test_capture_reads_actual_fact_bytes_and_explicit_receiver(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'controller.yaml').write_bytes(b'controller: A\n')
            profile = {'schemaVersion': 1, 'mode': 'shadow', 'id': 'synthetic-topic',
                       'facts': [{'id': 'controller', 'kind': 'file_sha256', 'path': 'controller.yaml', 'expected': '0' * 64}],
                       'paths': [{'id': 'velocity', 'adapter': 'topic_twist', 'endpoint': '/sim/cmd_vel',
                                  'messageType': 'geometry_msgs/msg/Twist', 'subscriber': {'name': 'gait_input', 'namespace': '/sim'}}]}
            observed = collect.collect_observation(profile, root, self.provider(), lambda: NOW)
            self.assertEqual(observed['paths'][0]['subscriberCount'], 1)
            self.assertEqual(observed['facts'][0]['value'], hashlib.sha256(b'controller: A\n').hexdigest())
            (root / 'controller.yaml').write_bytes(b'controller: B\n')
            changed = collect.collect_observation(profile, root, self.provider([]), lambda: NOW)
            self.assertNotEqual(changed['facts'][0]['value'], observed['facts'][0]['value'])
            self.assertEqual(changed['paths'][0]['subscriberCount'], 0)

    def test_no_command_client_publisher_or_subscription_api(self):
        tree = ast.parse((Path(__file__).parent / 'collect.py').read_text(encoding='utf8'))
        names = {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
        names.update(node.id for node in ast.walk(tree) if isinstance(node, ast.Name))
        self.assertFalse(names & {'ActionClient', 'send_goal_async', 'cancel_goal_async', 'create_client',
                                  'create_publisher', 'create_subscription', 'publish', 'call_async'})


if __name__ == '__main__':
    unittest.main()

#!/usr/bin/env python3
"""Read a selected Jazzy Nav2 graph twice. No action client or command publisher.

The local manifest declares which installed package belongs to each visible node.
DDS does not authenticate that association; this is a software review, not a
physical-path proof or protection against unobserved/adversarial command sources.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET
from controller_state import RosStateReader, CollectionError, NODE, parameter_value
from collect import utc_now, write_output, describe_interface


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def typed(item):
    t, v = item['type'], item['value']
    if t == 2: return int(v)
    if t == 3: return float(v)
    if t == 7: return [int(x) for x in v]
    if t == 8: return [float(x) for x in v]
    return v


class Nav2Reader(RosStateReader):
    def __enter__(self):
        super().__enter__()
        return self

    def parameters(self, node):
        request = self.list_parameters.Request(); request.depth = 0; request.prefixes = []
        names = sorted(self.request(self.list_parameters, node + '/list_parameters', request).result.names)
        if len(names) > 512 or len(names) != len(set(names)): raise CollectionError('invalid_nav2_parameter_name_set')
        result = {}
        def read(batch):
            request = self.get_parameters.Request(); request.names = batch
            response = self.request(self.get_parameters, node + '/get_parameters', request)
            if len(response.values) == len(batch):
                result.update({k: parameter_value(v) for k, v in zip(batch, response.values)})
            elif not response.values and len(batch) > 1:
                midpoint = len(batch)//2; read(batch[:midpoint]); read(batch[midpoint:])
            elif not response.values and batch[0].endswith('.max_points') and batch[0][:-10]+'min_points' in names:
                # Nav2 1.3.12 polygon.cpp declares deprecated max_points without
                # initializing it, then intentionally uses min_points instead.
                # Preserve the unavailable state; never invent a numeric limit.
                result[batch[0]] = {'type': 0, 'value': None}
            else: raise CollectionError('unavailable_selected_nav2_parameter:' + ','.join(batch))
        for offset in range(0, len(names), 64): read(names[offset:offset+64])
        return result

    def lifecycle(self, node):
        from lifecycle_msgs.srv import GetState
        return int(self.request(GetState, node + '/get_state', GetState.Request()).current_state.id)

    def endpoints(self, topic, publisher):
        rows = (self.node.get_publishers_info_by_topic(topic) if publisher else self.node.get_subscriptions_info_by_topic(topic))
        if len(rows) > 128: raise CollectionError('too_many_topic_endpoints')
        result = []
        for row in rows:
            name = (row.node_namespace.rstrip('/') + '/' + row.node_name)
            q = row.qos_profile
            result.append({'node': name, 'type': row.topic_type, 'gid': bytes(row.endpoint_gid).hex(),
                           'qos': {'reliability': int(q.reliability), 'durability': int(q.durability)}})
        return sorted(result, key=lambda r: (r['node'], r['gid']))

    def odometry(self, topic):
        from nav_msgs.msg import Odometry
        from rclpy.qos import qos_profile_sensor_data
        received = []
        sub = self.node.create_subscription(Odometry, topic, lambda msg: received.append(msg), qos_profile_sensor_data)
        try:
            until = min(self.deadline, time.monotonic() + 3)
            while not received and time.monotonic() < until: self.executor.spin_once(timeout_sec=0.05)
            if not received: raise CollectionError('closed_loop_odometry_sample_unavailable')
            msg = received[-1]
            if not msg.header.frame_id or not msg.child_frame_id: raise CollectionError('odometry_frames_missing')
            return {'frame': msg.header.frame_id, 'childFrame': msg.child_frame_id,
                    'sample': [msg.twist.twist.linear.x, msg.twist.twist.linear.y, msg.twist.twist.angular.z]}
        finally: self.node.destroy_subscription(sub)

    def one_pass(self, manifest):
        from ament_index_python.packages import get_package_share_directory
        from nav2_msgs.action import FollowPath
        from rosidl_runtime_py.utilities import get_action, get_message
        from rclpy.action.graph import get_action_server_names_and_types_by_node
        self.executor.spin_once(timeout_sec=0.05)
        environment = self.environment()
        if environment['rosDistro'] != 'jazzy': raise CollectionError('nav2_observer_requires_jazzy')
        names = self.node.get_node_names_and_namespaces()
        if len(names) > 4096 or len(names) != len(set(names)): raise CollectionError('ambiguous_ros_node_names')
        fields = dict(FollowPath.Goal.get_fields_and_field_types())
        if set(fields) != {'path', 'controller_id', 'goal_checker_id', 'progress_checker_id'}:
            raise CollectionError('unsupported_follow_path_goal_fields')
        stages, params, binding, issues, software = [], {}, {}, [], {}
        nodes = manifest['stages']
        if not 3 <= len(nodes) <= 12: raise CollectionError('invalid_selected_stage_count')
        for entry in nodes:
            name, package = entry['node'], entry['package']
            if not NODE.fullmatch(name): raise CollectionError('absolute_ros_node_required')
            share = Path(get_package_share_directory(package))
            metadata = (share / 'package.xml').read_bytes()
            version = ET.fromstring(metadata).findtext('version')
            if not version: raise CollectionError('installed_package_version_missing')
            software[package] = version
            raw = self.parameters(name)
            params[name] = {k: typed(v) for k, v in raw.items()}
            # Typed strings retain ROS inf defaults without producing invalid JSON.
            config = {'parameters': raw, 'packageXmlSha256': hashlib.sha256(metadata).hexdigest()}
            files = entry.get('sourceFiles', [])
            if len(files) > 16: raise CollectionError('too_many_selected_source_files')
            config['selectedLocalSourceFiles'] = []
            for file in files:
                path = Path(file)
                if not path.is_file() or path.stat().st_size > 2*1024*1024: raise CollectionError('selected_source_file_unavailable_or_too_large')
                config['selectedLocalSourceFiles'].append({'name': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            if entry['role'] != 'base':
                config['lifecycleState'] = self.lifecycle(name)
                if config['lifecycleState'] != 3: issues.append('inactive_selected_node:' + name)
            namespace, basename = name.rsplit('/', 1)
            subscriptions = self.node.get_subscriber_names_and_types_by_node(basename, namespace or '/')
            command_inputs = sorted(topic for topic, types in subscriptions if any(t in ('geometry_msgs/msg/Twist', 'geometry_msgs/msg/TwistStamped') for t in types))
            expected = [] if entry['inputTopic'] is None else [entry['inputTopic']]
            if command_inputs != expected: issues.append('unexpected_command_subscriptions:' + name)
            binding[name] = {'package': package, 'commandInputs': command_inputs, 'configuration': config}
            stages.append({k: entry[k] for k in ('role', 'node', 'inputTopic', 'outputTopic')} | {
                'implementation': package, 'version': version, 'configurationSha256': digest(config)})
        controller, smoother = nodes[0], nodes[1]
        cp, sp = params[controller['node']], params[smoother['node']]
        # Derive edges from visible endpoints, not manifest boolean assertions.
        edges, graph = [], {}
        for before, after in zip(stages, stages[1:]):
            topic = after['inputTopic']
            if not topic or not NODE.fullmatch(topic): raise CollectionError('invalid_command_topic')
            pub, sub = self.endpoints(topic, True), self.endpoints(topic, False)
            selected_pub = [x for x in pub if x['node'] == before['node']]
            selected_sub = [x for x in sub if x['node'] == after['node']]
            other = [x for x in pub if x['node'] != before['node']]
            if len(selected_pub) != 1 or len(selected_sub) != 1 or other: issues.append('missing_or_ambiguous_edge:' + topic)
            if any(x['type'] != manifest['commandType'] for x in selected_pub + selected_sub): issues.append('command_message_type_mismatch:' + topic)
            if selected_pub and selected_sub:
                from rclpy.qos import qos_check_compatible, QoSCompatibility
                pubs = self.node.get_publishers_info_by_topic(topic)
                subs = self.node.get_subscriptions_info_by_topic(topic)
                p = next(x for x in pubs if bytes(x.endpoint_gid).hex() == selected_pub[0]['gid'])
                s = next(x for x in subs if bytes(x.endpoint_gid).hex() == selected_sub[0]['gid'])
                if qos_check_compatible(p.qos_profile, s.qos_profile)[0] != QoSCompatibility.OK: issues.append('command_qos_not_confirmed_compatible:' + topic)
            edges.append({'publisher': before['node'], 'subscriber': after['node'], 'topic': topic,
                          'selectedPublisherCount': len(selected_pub), 'selectedSubscriptionCount': len(selected_sub), 'otherPublisherCount': len(other)})
            graph[topic] = {'publishers': pub, 'selectedSubscribers': selected_sub}
        servers = []
        for name, namespace in names:
            for endpoint, types in get_action_server_names_and_types_by_node(self.node, name, namespace):
                if endpoint == manifest['actionEndpoint']:
                    servers.append({'node': namespace.rstrip('/') + '/' + name, 'types': list(types)})
        if servers != [{'node': controller['node'], 'types': ['nav2_msgs/action/FollowPath']}]: issues.append('follow_path_server_not_unique_or_wrong_type')
        loaded = {}
        for key, name in [('controller_id', 'controller_plugins'), ('goal_checker_id', 'goal_checker_plugins'), ('progress_checker_id', 'progress_checker_plugins')]:
            ids = cp.get(name)
            if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)): raise CollectionError('loaded_plugin_set_missing:' + name)
            loaded[key] = []
            for selected in ids:
                implementation = cp.get(selected + '.plugin')
                if not isinstance(implementation, str) or not implementation: raise CollectionError('plugin_implementation_missing:' + selected)
                plugin_params = {k: v for k, v in cp.items() if k.startswith(selected + '.')}
                loaded[key].append({'id': selected, 'implementation': implementation, 'version': software[controller['package']], 'configurationSha256': digest(plugin_params)})
        keys = ('feedback', 'scale_velocities', 'smoothing_frequency', 'velocity_timeout', 'max_velocity', 'min_velocity', 'max_accel', 'max_decel', 'deadband_velocity')
        smoothed = {k: sp[k] for k in keys}
        smoothed.update({'stamp_smoothed_velocity_with_smoothing_time': sp.get('stamp_smoothed_velocity_with_smoothing_time', False),
                         'timestampConsumed': manifest['commandType'] == 'geometry_msgs/msg/TwistStamped'})
        volatile = {}
        if sp['feedback'] == 'CLOSED_LOOP':
            topic = sp['odom_topic']
            if not NODE.fullmatch(topic): raise CollectionError('absolute_odom_topic_required_for_selected_mapping')
            publishers = self.endpoints(topic, True)
            if len(publishers) != 1 or publishers[0]['type'] != 'nav_msgs/msg/Odometry': raise CollectionError('odometry_source_not_unique')
            subscriptions = [x for x in self.endpoints(topic, False) if x['node'] == smoother['node']]
            if len(subscriptions) != 1 or subscriptions[0]['type'] != 'nav_msgs/msg/Odometry': raise CollectionError('smoother_not_subscribed_to_selected_odometry')
            sample = self.odometry(topic)
            if not all(math.isfinite(v) for v in sample['sample']): raise CollectionError('nonfinite_odometry')
            smoothed['odometry'] = {'topic': topic, 'sourceNode': publishers[0]['node'], 'frame': sample['frame'], 'duration': sp['odom_duration']}
            binding['odometry'] = {'publishers': publishers, 'smootherSubscriptions': subscriptions, 'frame': sample['frame'], 'childFrame': sample['childFrame']}
            volatile['velocity_sample'] = sample['sample']
        goal = {'path': {}, **{k: v[0]['id'] for k, v in loaded.items()}}
        return {'input': {'schemaVersion': 1, 'kind': 'RlsokNav2ReviewInput', 'distribution': 'jazzy', 'inputSource': 'operator-supplied',
            'observedAt': self.started, 'actionEndpoint': manifest['actionEndpoint'], 'software': [{'identity': k, 'version': v} for k, v in sorted(software.items())],
            'smoother': smoothed, 'topology': {'selectedPathComplete': not issues, 'stages': stages, 'edges': edges}, 'loadedPlugins': loaded, 'goal': goal, 'volatile': volatile},
            'binding': {'environment': environment, 'manifestSha256': digest(manifest), 'nodes': binding, 'graph': graph, 'actionServers': servers,
                        'goalFields': fields, 'interface': describe_interface('nav2_msgs/action/FollowPath', get_action, get_message)}, 'issues': issues}

    def capture(self, manifest):
        self.started = utc_now()
        self.deadline = time.monotonic() + 25
        # Wait for parameter services first so DDS discovery is populated before graph inspection.
        self.parameters(manifest['stages'][0]['node'])
        first, second = self.one_pass(manifest), self.one_pass(manifest)
        def stable(x):
            value = json.loads(json.dumps(x)); value['input'].pop('volatile', None); return value
        if digest(stable(first)) != digest(stable(second)): raise CollectionError('nav2_graph_or_parameters_changed_during_capture')
        return {'schemaVersion': 1, 'kind': 'RlsokNav2RosObservation', 'startedAt': self.started, 'completedAt': utc_now(),
                **second, 'observationMethod': 'read-only-ros-two-pass', 'authenticatedTopology': False, 'hardwareDispatch': 'NO'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path); parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        if args.manifest.stat().st_size > 65536: raise CollectionError('manifest_too_large')
        manifest = json.loads(args.manifest.read_text())
        with Nav2Reader() as reader: result = reader.capture(manifest)
        if args.output: write_output(args.output, result)
        else: print(json.dumps(result, allow_nan=False))
        return 0
    except Exception as error:
        print(f'nav2_capture_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__': sys.exit(main())

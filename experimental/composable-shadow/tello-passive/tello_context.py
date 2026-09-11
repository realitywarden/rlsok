#!/usr/bin/env python3
"""Read selected ROS service metadata and local files; never create a client."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid

TYPE = 'tello_msgs/srv/TelloAction'
NAME = re.compile(r'^/(?:[A-Za-z_][A-Za-z0-9_]*/)*[A-Za-z_][A-Za-z0-9_]*$')


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def read_manifest(path):
    if path.stat().st_size > 65536:
        raise ValueError('manifest_too_large')
    m = json.loads(path.read_text(encoding='utf-8'))
    if set(m) != {'schemaVersion', 'clientNode', 'serverNode', 'endpoint', 'clientServiceName', 'files'} or m['schemaVersion'] != 1:
        raise ValueError('invalid_manifest_fields')
    for field in ('clientNode', 'serverNode', 'endpoint'):
        if not isinstance(m[field], str) or not NAME.fullmatch(m[field]):
            raise ValueError('absolute_ros_name_required:' + field)
    if not isinstance(m['clientServiceName'], str) or not 0 < len(m['clientServiceName']) <= 256:
        raise ValueError('client_service_name_required')
    if not isinstance(m['files'], list) or not 1 <= len(m['files']) <= 32:
        raise ValueError('select_1_to_32_files')
    ids = set()
    for f in m['files']:
        if set(f) != {'id', 'path'} or not isinstance(f['id'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', f['id']) or f['id'] in ids:
            raise ValueError('invalid_selected_file_id')
        if not isinstance(f['path'], str) or not f['path']:
            raise ValueError('selected_file_path_required')
        ids.add(f['id'])
    return m


class ContextReader:
    def __init__(self, manifest_path, discovery_seconds=10.0):
        self.manifest_path = Path(manifest_path).resolve()
        self.manifest = read_manifest(self.manifest_path)
        self.node = None
        self.context = None
        self.executor = None
        self.discovery_seconds = discovery_seconds

    def __enter__(self):
        import rclpy
        from rclpy.context import Context
        from rclpy.executors import SingleThreadedExecutor
        from rclpy.utilities import get_rmw_implementation_identifier
        from rosidl_runtime_py.utilities import get_service
        self.context = Context()
        rclpy.init(args=[], context=self.context)
        try:
            self.node = rclpy.create_node('rlsok_tello_observer_' + uuid.uuid4().hex,
                                         context=self.context, enable_rosout=False,
                                         start_parameter_services=False, use_global_arguments=False)
            self.executor = SingleThreadedExecutor(context=self.context)
            self.executor.add_node(self.node)
            self.rmw = get_rmw_implementation_identifier()
            self.service = get_service(TYPE)
            deadline = time.monotonic() + self.discovery_seconds
            while time.monotonic() < deadline:
                if self.selected_graph_visible():
                    break
                self.executor.spin_once(timeout_sec=min(0.05, max(0, deadline - time.monotonic())))
            return self
        except Exception:
            self.__exit__()
            raise

    def __exit__(self, *_exc):
        if self.executor is not None:
            self.executor.shutdown(timeout_sec=2)
        if self.node is not None:
            self.node.destroy_node()
        if self.context is not None and self.context.ok():
            self.context.shutdown()

    def selected_graph_visible(self):
        """Bound discovery by observed selected endpoints, not a fixed sleep.

        Visibility alone is not validity: capture still checks all associations,
        types, duplicate servers, selected files and two-pass consistency.
        """
        wanted = self.manifest
        visible = {namespace.rstrip('/') + '/' + name: (name, namespace)
                   for name, namespace in self.node.get_node_names_and_namespaces()}
        if wanted['clientNode'] not in visible or wanted['serverNode'] not in visible:
            return False
        try:
            clients = self.node.get_client_names_and_types_by_node(*visible[wanted['clientNode']])
            servers = self.node.get_service_names_and_types_by_node(*visible[wanted['serverNode']])
            return any(endpoint == wanted['endpoint'] for endpoint, _ in clients) and any(endpoint == wanted['endpoint'] for endpoint, _ in servers)
        except RuntimeError:
            return False

    def facts(self):
        m = read_manifest(self.manifest_path)
        if canonical(m) != canonical(self.manifest):
            raise ValueError('manifest_changed_during_session_restart_and_review')
        domain = os.environ.get('ROS_DOMAIN_ID', '0')
        distro = os.environ.get('ROS_DISTRO', '')
        if not distro or not re.fullmatch(r'[0-9]{1,3}', domain) or not 0 <= int(domain) <= 232:
            raise ValueError('ros_environment_missing_or_invalid')
        nodes = self.node.get_node_names_and_namespaces()
        if len(nodes) > 4096 or len(set(nodes)) != len(nodes):
            raise ValueError('ambiguous_or_excessive_node_names')
        clients, servers = [], []
        for node_name, namespace in nodes:
            full = namespace.rstrip('/') + '/' + node_name
            if full == m['clientNode']:
                for endpoint, types in self.node.get_client_names_and_types_by_node(node_name, namespace):
                    for service_type in types:
                        if service_type == TYPE or endpoint == m['endpoint']:
                            clients.append({'node': full, 'endpoint': endpoint, 'type': service_type})
            for endpoint, types in self.node.get_service_names_and_types_by_node(node_name, namespace):
                if endpoint == m['endpoint']:
                    servers.extend({'node': full, 'endpoint': endpoint, 'type': t} for t in types)
        files = []
        for selected in m['files']:
            path = (self.manifest_path.parent / selected['path']).resolve(strict=True)
            if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
                raise ValueError('selected_file_not_regular_or_over_2MiB:' + selected['id'])
            files.append({'id': selected['id'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        definition = {'request': self.service.Request.get_fields_and_field_types(),
                      'response': self.service.Response.get_fields_and_field_types(),
                      'responseConstants': {key: getattr(self.service.Response, key, None) for key in ('OK', 'ERROR_NOT_CONNECTED', 'ERROR_BUSY')}}
        issues = []
        if definition['request'] != {'cmd': 'string'} or definition['response'] != {'rc': 'uint8'} or definition['responseConstants'] != {'OK': 1, 'ERROR_NOT_CONNECTED': 2, 'ERROR_BUSY': 3}:
            issues.append('installed_tello_action_definition_differs_from_reviewed_source')
        binding = {'manifestSha256': digest(m),
                   'environment': {'rosDistro': distro, 'rmwImplementation': self.rmw, 'domainId': int(domain)},
                   'selected': {key: m[key] for key in ('clientNode', 'serverNode', 'endpoint', 'clientServiceName')},
                   'clients': sorted(clients, key=canonical), 'servers': sorted(servers, key=canonical),
                   'interface': {'type': TYPE, 'definitionSha256': digest(definition)},
                   'files': sorted(files, key=lambda f: f['id'])}
        return binding, issues

    def capture(self):
        # A newly started client can emit its first local observation before
        # its DDS endpoint metadata reaches this separate process. Wait only
        # here, never in the instrumented client's command path.
        deadline = time.monotonic() + 2.0
        while not self.selected_graph_visible() and time.monotonic() < deadline:
            self.executor.spin_once(timeout_sec=0.05)
        started = utc_now()
        first, issues1 = self.facts()
        second, issues2 = self.facts()
        issues = list(set(issues1 + issues2))
        if canonical(first) != canonical(second):
            issues.append('selected_configuration_changed_during_read')
        return {'schemaVersion': 1, 'kind': 'RlsokTelloConfigurationObservation',
                'startedAt': started, 'completedAt': utc_now(), 'binding': second,
                'issues': sorted(issues), 'observationMethod': 'read-only-ros-two-pass',
                'authenticatedHardware': False, 'commandDispatches': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        with ContextReader(args.manifest) as reader:
            snapshot = reader.capture()
        with os.fdopen(os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as stream:
            json.dump(snapshot, stream, indent=2)
            stream.write('\n')
    except Exception as error:
        parser.exit(2, 'tello_context_failed: %s\n' % error)


if __name__ == '__main__':
    main()

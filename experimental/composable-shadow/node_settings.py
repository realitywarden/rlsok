#!/usr/bin/env python3
"""Read a node's typed ROS parameters twice; never change parameters or publish.
The result observes the parameter service, not arbitrary cached member variables.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from controller_state import RosStateReader, canonical, CollectionError, NODE
from collect import utc_now, write_output


def export_settings(reader, node, downstream=None):
    if not NODE.fullmatch(node): raise CollectionError('absolute_node_name_required')
    observed = utc_now()
    def capture():
        parameters = reader.parameters(node)
        link = None
        if downstream:
            target, topic, message_type = downstream
            if not NODE.fullmatch(target) or not NODE.fullmatch(topic): raise CollectionError('absolute_link_names_required')
            def endpoints(publisher):
                rows = reader.node.get_publishers_info_by_topic(topic) if publisher else reader.node.get_subscriptions_info_by_topic(topic)
                return sorted([{'node': r.node_namespace.rstrip('/')+'/'+r.node_name, 'type': r.topic_type, 'gid': bytes(r.endpoint_gid).hex()} for r in rows], key=lambda r: (r['node'], r['gid']))
            publishers, subscribers = endpoints(True), endpoints(False)
            selected = [r for r in subscribers if r['node'] == target]
            # A newly created reader can discover parameter services before
            # topic endpoints. Wait only for absence; conflicts still reject.
            while (not publishers or not selected) and time.monotonic() < reader.deadline:
                reader.executor.spin_once(timeout_sec=0.05)
                publishers, subscribers = endpoints(True), endpoints(False)
                selected = [r for r in subscribers if r['node'] == target]
            if len(publishers) != 1 or publishers[0]['node'] != node or publishers[0]['type'] != message_type or len(selected) != 1 or selected[0]['type'] != message_type:
                raise CollectionError('downstream_link_missing_or_ambiguous:' + json.dumps({'publishers': publishers, 'selectedSubscribers': selected}))
            link = {'node': target, 'topic': topic, 'messageType': message_type, 'publishers': publishers, 'subscribers': selected}
        return {'parameters': parameters, 'downstream': link}
    first, second = capture(), capture()
    if canonical(first) != canonical(second): raise CollectionError('node_parameters_changed_during_read')
    configuration = {'schemaVersion': 1, 'source': {'node': node, 'environment': reader.environment()}, **second}
    return {'schemaVersion': 1, 'kind': 'RlsokRosNodeSettings', 'observedAt': observed,
            'configuration': configuration, 'configurationSha256': hashlib.sha256(canonical(configuration).encode()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', required=True); parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--downstream-node'); parser.add_argument('--topic'); parser.add_argument('--type')
    args = parser.parse_args()
    try:
        if args.output.exists(): raise CollectionError('output_already_exists')
        link = (args.downstream_node, args.topic, args.type)
        if any(link) and not all(link): raise CollectionError('provide_all_downstream_link_options')
        with RosStateReader() as reader: result = export_settings(reader, args.node, link if all(link) else None)
        write_output(args.output, result)
        return 0
    except Exception as error:
        print(f'node_settings_export_failed:{type(error).__name__}:{error}', file=sys.stderr)
        return 2


if __name__ == '__main__': sys.exit(main())

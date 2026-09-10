#!/usr/bin/env python3
"""Targeted isolated Nav2 graph experiment. Real Nav2; an explicit software base.
Starts no hardware driver and never sends FollowPath goals or Twist messages.
Requires a private Linux network namespace containing only loopback.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import threading
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--runtime', required=True, type=Path)
parser.add_argument('--node', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--gazebo', action='store_true', help='Use a real ROS-GZ bridge and Gazebo DiffDrive base for the core path cases.')
args = parser.parse_args()
ROOT, OUT, NODE = args.runtime.resolve(), args.output.resolve(), args.node.resolve()
assert os.readlink('/proc/self/ns/net') != os.readlink('/proc/1/ns/net'), 'use unshare --net'
assert {p['ifname'] for p in json.loads(subprocess.check_output(['ip', '-j', 'link']))} == {'lo'}, 'loopback-only network required'
OUT.mkdir()
os.environ.update(ROS_DOMAIN_ID='223', ROS_AUTOMATIC_DISCOVERY_RANGE='LOCALHOST', RMW_IMPLEMENTATION='rmw_fastrtps_cpp')
os.environ.pop('ROS_LOCALHOST_ONLY', None)
import yaml
import rclpy
from rclpy.executors import MultiThreadedExecutor
from rclpy.parameter import Parameter
from lifecycle_msgs.srv import ChangeState
from rcl_interfaces.srv import SetParameters
from geometry_msgs.msg import Twist, TransformStamped
from nav_msgs.msg import Odometry
from tf2_ros import StaticTransformBroadcaster

def save(path, value): path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
def run(command, name, success=(0,), timeout=40):
    result = subprocess.run(list(map(str, command)), text=True, capture_output=True, timeout=timeout, cwd=ROOT)
    (OUT/(name+'.log')).write_text(result.stdout+result.stderr)
    if result.returncode not in success: raise RuntimeError(name + ': ' + result.stdout[-1500:]+result.stderr[-1500:])
    return result
def cli(name, *options, success=(0,)):
    return run([NODE, ROOT/'dist/apps/cli/rlsok.js', 'profile', *options], name, success)

dwb = {'plugin': 'dwb_core::DWBLocalPlanner', 'critics': ['RotateToGoal', 'Oscillation', 'BaseObstacle', 'GoalAlign', 'PathAlign', 'PathDist', 'GoalDist'],
       'min_vel_x': 0.0, 'max_vel_x': 0.4, 'max_vel_theta': 1.0, 'acc_lim_x': 1.0, 'acc_lim_theta': 1.0,
       'decel_lim_x': -1.0, 'decel_lim_theta': -1.0, 'vx_samples': 3, 'vy_samples': 1, 'vtheta_samples': 3}
config = {'controller_server': {'ros__parameters': {
    'use_sim_time': False, 'controller_frequency': 10.0, 'controller_plugins': ['FollowPath', 'Alternative'],
    'goal_checker_plugins': ['goal_checker', 'alternate_goal'], 'progress_checker_plugins': ['progress_checker', 'alternate_progress'],
    'FollowPath': dwb, 'Alternative': {**dwb, 'max_vel_x': 0.3},
    'goal_checker': {'plugin': 'nav2_controller::SimpleGoalChecker', 'xy_goal_tolerance': 0.2},
    'alternate_goal': {'plugin': 'nav2_controller::SimpleGoalChecker', 'xy_goal_tolerance': 0.1},
    'progress_checker': {'plugin': 'nav2_controller::SimpleProgressChecker', 'required_movement_radius': 0.5},
    'alternate_progress': {'plugin': 'nav2_controller::SimpleProgressChecker', 'required_movement_radius': 0.3}}},
    'local_costmap': {'local_costmap': {'ros__parameters': {'use_sim_time': False, 'global_frame': 'odom', 'robot_base_frame': 'base_link',
        'rolling_window': True, 'width': 3, 'height': 3, 'resolution': 0.1, 'robot_radius': 0.2,
        'plugins': ['inflation_layer'], 'inflation_layer': {'plugin': 'nav2_costmap_2d::InflationLayer'},
        'update_frequency': 2.0, 'publish_frequency': 1.0}}},
    'velocity_smoother': {'ros__parameters': {'use_sim_time': False, 'smoothing_frequency': 20.0, 'scale_velocities': False,
        'feedback': 'OPEN_LOOP', 'max_velocity': [0.5, 0.0, 2.5], 'min_velocity': [-0.5, 0.0, -2.5],
        'max_accel': [2.5, 0.0, 3.2], 'max_decel': [-2.5, 0.0, -3.2], 'deadband_velocity': [0.0, 0.0, 0.0],
        'velocity_timeout': 1.0, 'odom_topic': '/odom', 'odom_duration': 0.1}},
    'collision_monitor': {'ros__parameters': {'use_sim_time': False, 'base_frame_id': 'base_link', 'odom_frame_id': 'odom',
        'cmd_vel_in_topic': '/cmd_vel_smoothed', 'cmd_vel_out_topic': '/cmd_vel', 'state_topic': '/collision_monitor_state',
        'transform_tolerance': 0.2, 'source_timeout': 1.0, 'stop_pub_timeout': 1.0, 'polygons': ['StopPolygon'],
        'StopPolygon': {'type': 'polygon', 'points': '[[0.3, 0.3], [0.3, -0.3], [-0.3, -0.3], [-0.3, 0.3]]',
            'action_type': 'stop', 'min_points': 1, 'visualize': False, 'enabled': True},
        'observation_sources': ['scan'], 'scan': {'type': 'scan', 'topic': '/scan', 'enabled': True}}}}
(OUT/'nav2.yaml').write_text(yaml.safe_dump(json.loads(json.dumps(config)), sort_keys=False))
manifest = {'schemaVersion': 1, 'actionEndpoint': '/follow_path', 'commandType': 'geometry_msgs/msg/Twist', 'stages': [
    {'role': 'controller', 'node': '/controller_server', 'inputTopic': None, 'outputTopic': '/cmd_vel_raw', 'package': 'nav2_controller'},
    {'role': 'smoother', 'node': '/velocity_smoother', 'inputTopic': '/cmd_vel_raw', 'outputTopic': '/cmd_vel_smoothed', 'package': 'nav2_velocity_smoother'},
    {'role': 'gate', 'node': '/collision_monitor', 'inputTopic': '/cmd_vel_smoothed', 'outputTopic': '/cmd_vel', 'package': 'nav2_collision_monitor'},
    {'role': 'base', 'node': '/rlsok_sim_base', 'inputTopic': '/cmd_vel', 'outputTopic': None, 'package': 'rclpy'}]}
save(OUT/'manifest.json', manifest)
if args.gazebo:
    manifest['stages'][-1] = {'role': 'base', 'node': '/rlsok_gz_base', 'inputTopic': '/cmd_vel', 'outputTopic': None, 'package': 'ros_gz_bridge',
                            'sourceFiles': [str(OUT/'bridge.yaml'), str(OUT/'world.sdf')]}
    save(OUT/'manifest.json', manifest)
    (OUT/'world.sdf').write_bytes((ROOT/'experimental/composable-shadow/nav2_base.sdf').read_bytes())
    ET.parse(OUT/'world.sdf')
    (OUT/'bridge.yaml').write_text(yaml.safe_dump([
      {'ros_topic_name': '/cmd_vel', 'gz_topic_name': '/model/rlsok_base/cmd_vel', 'ros_type_name': 'geometry_msgs/msg/Twist', 'gz_type_name': 'gz.msgs.Twist', 'direction': 'ROS_TO_GZ'},
      {'ros_topic_name': '/odom', 'gz_topic_name': '/model/rlsok_base/odometry', 'ros_type_name': 'nav_msgs/msg/Odometry', 'gz_type_name': 'gz.msgs.Odometry', 'direction': 'GZ_TO_ROS'}]))
header = {'stamp': {'sec': 0, 'nanosec': 0}, 'frame_id': 'odom'}
goal = {'controller_id': 'FollowPath', 'goal_checker_id': 'goal_checker', 'progress_checker_id': 'progress_checker',
        'path': {'header': header, 'poses': [{'header': header, 'pose': {'position': {'x': x, 'y': 0.0, 'z': 0.0},
           'orientation': {'x': 0.0, 'y': 0.0, 'z': 0.0, 'w': 1.0}}} for x in [0.0, 0.5]]}}
save(OUT/'goal.json', goal)
rclpy.init(args=[])
base = rclpy.create_node('rlsok_sim_base')
base.declare_parameter('fixture_kind', 'software-only-no-hardware-driver')
received = []; velocity = [0.0]; odom_frame = ['odom']
gazebo_odometry = []
if args.gazebo: base.create_subscription(Odometry, '/odom', lambda msg: gazebo_odometry.append(msg), 10)
sub = base.create_subscription(Twist, '/cmd_vel', lambda msg: received.append(msg), 10)
odom = base.create_publisher(Odometry, '/odom', 10) if not args.gazebo else None
other_odom = base.create_publisher(Odometry, '/other_odom', 10) if not args.gazebo else None
def publish_state():
    msg = Odometry(); msg.header.frame_id = odom_frame[0]; msg.child_frame_id = 'base_link'
    msg.header.stamp = base.get_clock().now().to_msg(); msg.pose.pose.orientation.w = 1.0
    msg.twist.twist.linear.x = velocity[0]
    odom.publish(msg); other_odom.publish(msg)
if not args.gazebo: base.create_timer(0.05, publish_state)
tf = StaticTransformBroadcaster(base)
t = TransformStamped(); t.header.frame_id = 'odom'; t.child_frame_id = 'base_link'; t.transform.rotation.w = 1.0
tf.sendTransform(t)
executor = MultiThreadedExecutor(num_threads=2); executor.add_node(base)
thread = threading.Thread(target=executor.spin, daemon=True); thread.start()
processes, logs, cases = [], [], []
def start(package, executable, remaps=()):
    log = open(OUT/(executable+'.log'), 'w'); logs.append(log)
    command = ['/opt/ros/jazzy/lib/'+package+'/'+executable, '--ros-args', '--params-file', str(OUT/'nav2.yaml'), *remaps]
    p = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True); processes.append(p)
    return p
def request(kind, endpoint, value):
    client = base.create_client(kind, endpoint)
    try:
        if not client.wait_for_service(timeout_sec=12): raise RuntimeError('missing experiment service '+endpoint)
        future = client.call_async(value); end = time.monotonic()+15
        while not future.done() and time.monotonic() < end: time.sleep(0.02)
        if not future.done(): raise RuntimeError('experiment service timeout '+endpoint)
        return future.result()
    finally: base.destroy_client(client)
def lifecycle(node, transition):
    req = ChangeState.Request(); req.transition.id = transition
    assert request(ChangeState, node+'/change_state', req).success, (node, transition)
def set_param(node, name, value):
    req = SetParameters.Request(parameters=[Parameter(name, value=value).to_parameter_msg()])
    results = request(SetParameters, node+'/set_parameters', req).results
    assert len(results) == 1 and results[0].successful, str(results)
    time.sleep(0.12)
def review(name):
    observation = OUT/(name+'-observation.json'); approval = OUT/(name+'-approval.json')
    cli(name+'-capture', 'capture-nav2', '--manifest', OUT/'manifest.json', '--output', observation)
    cli(name+'-approve', 'approve-nav2', '--observation', observation, '--goal', OUT/'goal.json', '--actor', 'isolated-graph-experiment',
        '--expires-at', (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(), '--output', approval)
    return approval
def check(name, approval, expected, candidate=None):
    assert all(p.poll() is None for p in processes), 'an experiment process exited; inspect its log'
    path = OUT/'goal.json'
    if candidate:
        path = OUT/(name+'-goal.json'); save(path, candidate)
    cli(name, 'shadow-nav2', '--manifest', OUT/'manifest.json', '--approval', approval, '--goal', path, '--output', OUT/name, success=(0, 1))
    report = json.loads((OUT/name/'report.json').read_text())
    assert report['decision'] == expected, (name, report['reason'])
    if name.startswith('changed-') or name in ['collision-monitor-changed', 'feedback-changed', 'odom-duration-changed', 'odom-topic-changed', 'odom-frame-changed']:
        assert report['reason'] == 'nav2_review_required', (name, report['reason'])
        assert report.get('current'), 'negative case needs its actual observed inputs'
    if name.startswith('swapped-') or name == 'replaced-path':
        assert report['reason'] == 'nav2_exact_goal_not_approved', (name, report['reason'])
    assert (OUT/name/'shadow-handoff.json').exists() == (expected == 'WOULD_ALLOW'), name
    cases.append({'name': name, 'decision': report['decision'], 'reason': report['reason'], 'approvalSha256': report['approvalSha256'],
                  'shadowHandoffs': report['shadowHandoffs'], 'actionGoalsSent': 0, 'velocityCommandsPublishedByExperiment': 0})
    print(name+': '+report['decision'], flush=True)
try:
    if args.gazebo:
        os.environ['GZ_PARTITION'] = 'rlsok-nav2-' + str(os.getpid())
        log = open(OUT/'gazebo.log', 'w'); logs.append(log)
        processes.append(subprocess.Popen(['/usr/bin/gz', 'sim', '-s', '-r', '-v', '4', str(OUT/'world.sdf')],
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
        log = open(OUT/'gazebo-bridge.log', 'w'); logs.append(log)
        processes.append(subprocess.Popen(['/opt/ros/jazzy/lib/ros_gz_bridge/parameter_bridge', '--ros-args', '-r', '__node:=rlsok_gz_base',
            '-p', 'config_file:='+str(OUT/'bridge.yaml')], stdout=log, stderr=subprocess.STDOUT, start_new_session=True))
        end = time.monotonic()+40
        while len(gazebo_odometry) < 2 and time.monotonic() < end:
            assert all(p.poll() is None for p in processes), 'Gazebo/bridge exited before observed odometry'
            time.sleep(0.05)
        assert len(gazebo_odometry) >= 2, 'no actual Gazebo odometry through the bridge'
    start('nav2_controller', 'controller_server', ['-r', 'cmd_vel:=/cmd_vel_raw'])
    start('nav2_velocity_smoother', 'velocity_smoother', ['-r', 'cmd_vel:=/cmd_vel_raw', '-r', 'cmd_vel_smoothed:=/cmd_vel_smoothed'])
    start('nav2_collision_monitor', 'collision_monitor')
    for name in ['/controller_server', '/velocity_smoother', '/collision_monitor']:
        lifecycle(name, 1); lifecycle(name, 3)
    time.sleep(1)
    approval = review('open-loop')
    check('unchanged-real-graph', approval, 'WOULD_ALLOW')
    for name, changed, original in [('smoothing_frequency', 10.0, 20.0), ('scale_velocities', True, False),
       ('velocity_timeout', 2.0, 1.0), ('deadband_velocity', [0.1, 0.0, 0.0], [0.0, 0.0, 0.0]), ('max_velocity', [0.4, 0.0, 2.5], [0.5, 0.0, 2.5])]:
        set_param('/velocity_smoother', name, changed)
        check('changed-'+name, approval, 'WOULD_BLOCK')
        set_param('/velocity_smoother', name, original)
    for key, value in [('controller_id', 'Alternative'), ('goal_checker_id', 'alternate_goal'), ('progress_checker_id', 'alternate_progress')]:
        proposed = copy.deepcopy(goal); proposed[key] = value
        check('swapped-'+key, approval, 'WOULD_BLOCK', proposed)
    proposed = copy.deepcopy(goal); proposed['path']['poses'][1]['pose']['position']['x'] = 0.6
    check('replaced-path', approval, 'WOULD_BLOCK', proposed)
    if args.gazebo:
        set_param("/velocity_smoother", "feedback", "CLOSED_LOOP")
        check("gazebo-feedback-changed", approval, "WOULD_BLOCK")
        closed = review("gazebo-closed-loop")
        check("gazebo-closed-loop-observed", closed, "WOULD_ALLOW")
        run(["gz", "topic", "-i", "-t", "/model/rlsok_base/cmd_vel"], "gazebo-command-topic")
    else:
        bypass = base.create_publisher(Twist, '/cmd_vel', 10)  # Endpoint only; publish is never called.
        time.sleep(0.3); check('extra-base-publisher', approval, 'WOULD_BLOCK'); base.destroy_publisher(bypass)
        extra = base.create_subscription(Twist, '/cmd_vel_raw', lambda _: None, 10)
        time.sleep(0.3); check('base-bypasses-smoother', approval, 'WOULD_BLOCK'); base.destroy_subscription(extra)
        set_param('/collision_monitor', 'StopPolygon.enabled', False)
        check('collision-monitor-changed', approval, 'WOULD_BLOCK')
        set_param('/collision_monitor', 'StopPolygon.enabled', True)
        lifecycle('/velocity_smoother', 4)
        check('smoother-inactive', approval, 'WOULD_BLOCK')
        lifecycle('/velocity_smoother', 3)
        set_param('/velocity_smoother', 'feedback', 'CLOSED_LOOP')
        check('feedback-changed', approval, 'WOULD_BLOCK')
        closed = review('closed-loop')
        check('closed-loop-unchanged', closed, 'WOULD_ALLOW')
        velocity[0] = 0.15; time.sleep(0.2)
        check('volatile-velocity-only', closed, 'WOULD_ALLOW')
        set_param('/velocity_smoother', 'odom_duration', 0.2)
        check('odom-duration-changed', closed, 'WOULD_BLOCK')
        set_param('/velocity_smoother', 'odom_duration', 0.1)
        set_param('/velocity_smoother', 'odom_topic', '/other_odom')
        check('odom-topic-changed', closed, 'WOULD_BLOCK')
        set_param('/velocity_smoother', 'odom_topic', '/odom')
        odom_frame[0] = 'changed_odom'; time.sleep(0.2)
        check('odom-frame-changed', closed, 'WOULD_BLOCK')
        odom_frame[0] = 'odom'
        alternate_source = rclpy.create_node('alternate_odom_source'); executor.add_node(alternate_source)
        duplicate_odom = alternate_source.create_publisher(Odometry, '/odom', 10)
        time.sleep(0.3); check('ambiguous-odom-source', closed, 'WOULD_BLOCK')
        executor.remove_node(alternate_source); alternate_source.destroy_node()
        check('recreated-odom-endpoint-needs-review', closed, 'WOULD_BLOCK')
        renewed = review('explicitly-reviewed-restored-graph')
        check('restored-after-explicit-review', renewed, 'WOULD_ALLOW')
    assert not received, 'unexpected velocity command reached software base'
    versions = subprocess.check_output(['dpkg-query', '-W', 'ros-jazzy-nav2-controller', 'ros-jazzy-nav2-velocity-smoother', 'ros-jazzy-nav2-collision-monitor'], text=True)
    save(OUT/'summary.json', {'scope': ('Real installed Jazzy Nav2 with ROS-GZ bridge and Gazebo DiffDrive; zero RLSOK commands, no hardware claim' if args.gazebo else 'Real installed Jazzy Nav2 graph with explicit software base and odometry; no Gazebo physics or hardware claim'),
         'versions': versions, 'network': 'private-loopback-only-namespace', 'actionGoalsSent': 0,
         'velocityCommandsPublishedByExperiment': 0, 'velocityMessagesBeforeShutdown': len(received),
         'gazeboOdometryMessages': len(gazebo_odometry), 'cases': cases})
finally:
    for p in processes:
        try: os.killpg(p.pid, signal.SIGTERM)
        except ProcessLookupError: pass
    for p in processes:
        try: p.wait(timeout=5)
        except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=5)
    for log in logs: log.close()
    executor.shutdown(timeout_sec=5); base.destroy_node()
    if rclpy.ok(): rclpy.shutdown()
    thread.join(timeout=5)

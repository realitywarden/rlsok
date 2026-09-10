#!/usr/bin/env python3
"""Pinned public Hexapod Gazebo/gait chain and read-only Shadow comparison.
Builds only the two supplied Python ROS packages. RLSOK sends no Twist, trajectory
or action goal; the unmodified source gait publishes its own neutral stance in
the isolated simulator. No physical transport or HAL is started.
"""
import argparse
from collections import deque
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
for arg in ['runtime', 'source', 'node', 'output']: parser.add_argument('--'+arg, required=True, type=Path)
args = parser.parse_args()
ROOT, SOURCE, NODE, OUT = (getattr(args, k).resolve() for k in ['runtime', 'source', 'node', 'output'])
assert os.readlink('/proc/self/ns/net') != os.readlink('/proc/1/ns/net'), 'private network namespace required'
assert {x['ifname'] for x in json.loads(subprocess.check_output(['ip', '-j', 'link']))} == {'lo'}, 'loopback only'
OUT.mkdir()
os.environ.update(ROS_DOMAIN_ID='224', ROS_AUTOMATIC_DISCOVERY_RANGE='LOCALHOST', RMW_IMPLEMENTATION='rmw_fastrtps_cpp',
                  GZ_IP='127.0.0.1', GZ_PARTITION='rlsok-hexapod-'+str(os.getpid()))
os.environ.pop('ROS_LOCALHOST_ONLY', None)
REVISION = '656eebab5587977a1f41d44657cb853433927053'
def save(path, value): path.write_text(json.dumps(value, indent=2, allow_nan=False)+'\n')
def run(command, name, timeout=45):
    result = subprocess.run(list(map(str, command)), cwd=ROOT, text=True, capture_output=True, timeout=timeout)
    (OUT/(name+'.log')).write_text(result.stdout+result.stderr)
    if result.returncode: raise RuntimeError(name+': '+result.stdout[-2000:]+result.stderr[-2000:])
    return result.stdout
def cli(name, *options): return run([NODE, ROOT/'dist/apps/cli/rlsok.js', 'profile', *options], name)
assert run(['git', '-c', 'safe.directory='+str(SOURCE), '-C', SOURCE, 'rev-parse', 'HEAD'], 'source-revision').strip() == REVISION
run(['colcon', '--log-base', OUT/'colcon-log', 'build', '--base-paths', SOURCE/'src', '--packages-select',
     'Hexapod_Robot_description', 'hexapod_gait', '--build-base', OUT/'build', '--install-base', OUT/'install'], 'two-package-build', timeout=90)
prefixes = [OUT/'install/Hexapod_Robot_description', OUT/'install/hexapod_gait']
os.environ['AMENT_PREFIX_PATH'] = ':'.join(map(str, prefixes))+':/opt/ros/jazzy'
os.environ['PYTHONPATH'] = str(SOURCE/'src/hexapod_gait')+':'+os.environ.get('PYTHONPATH', '')
os.environ['GZ_SIM_RESOURCE_PATH'] = str(prefixes[0]/'share')+':/usr/share/gz/gz-sim8/worlds'
os.environ['GZ_SIM_SYSTEM_PLUGIN_PATH'] = '/opt/ros/jazzy/lib:/usr/lib/x86_64-linux-gnu/gz-sim-8/plugins'
import yaml
import xacro
import rclpy
from rclpy.executors import MultiThreadedExecutor
from rosidl_runtime_py.convert import message_to_ordereddict
from trajectory_msgs.msg import JointTrajectory
from sensor_msgs.msg import JointState
from geometry_msgs.msg import Twist
from rosgraph_msgs.msg import Clock

model = xacro.process_file(str(prefixes[0]/'share/Hexapod_Robot_description/urdf/Hexapod_Robot.xacro')).toxml()
(OUT/'robot.urdf').write_text(model)
(OUT/'rsp.yaml').write_text(yaml.safe_dump({'robot_state_publisher': {'ros__parameters': {'robot_description': model, 'use_sim_time': True}}}))
settings = {'publicRevision': REVISION, 'environment': 'isolated-gazebo-harmonic', 'physicalHardwareStarted': False,
            'gaitInput': '/cmd_vel', 'gaitOutput': '/leg_controller/joint_trajectory', 'simulationWorld': 'empty.sdf'}
save(OUT/'runtime-settings.json', settings)
save(OUT/'example.json', {'linear': {'x': 0.05, 'y': 0.0, 'z': 0.0}, 'angular': {'x': 0.0, 'y': 0.0, 'z': 0.0}})
rclpy.init(args=[])
observer = rclpy.create_node('rlsok_hexapod_experiment_observer', enable_rosout=False, start_parameter_services=False)
counts = {'trajectories': 0, 'jointStates': 0, 'twists': 0, 'clock': 0}
trajectories, joint_states = deque(maxlen=4), deque(maxlen=4)
def received(kind, target=None):
    def callback(msg):
        counts[kind] += 1
        if target is not None: target.append(dict(message_to_ordereddict(msg)))
    return callback
observer.create_subscription(JointTrajectory, '/leg_controller/joint_trajectory', received('trajectories', trajectories), 10)
observer.create_subscription(JointState, '/joint_states', received('jointStates', joint_states), 10)
observer.create_subscription(Twist, '/cmd_vel', received('twists'), 10)
observer.create_subscription(Clock, '/clock', received('clock'), 10)
executor = MultiThreadedExecutor(num_threads=2); executor.add_node(observer)
thread = threading.Thread(target=executor.spin, daemon=True); thread.start()
processes, logs = [], []
def start(command, name):
    log = open(OUT/(name+'.log'), 'w'); logs.append(log)
    p = subprocess.Popen(list(map(str, command)), stdout=log, stderr=subprocess.STDOUT, start_new_session=True); processes.append(p)
    return p
def stop(p):
    try: os.killpg(p.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=5)
def wait_for_activity(previous):
    until = time.monotonic()+30
    while time.monotonic() < until:
        if counts['trajectories'] >= previous['trajectories']+5 and counts['jointStates'] >= previous['jointStates']+5 and counts['clock'] > previous['clock']:
            sample = trajectories[-1]
            expected = [f'leg_{leg}_{j}' for leg in ['l1', 'l2', 'l3', 'r1', 'r2', 'r3'] for j in ['coxa', 'femur', 'tibia']]
            assert sample['joint_names'] == expected
            assert sample['points'] and all(len(p['positions']) == 18 and all(math.isfinite(x) for x in p['positions']) for p in sample['points'])
            assert set(expected).issubset(set(joint_states[-1]['name']))
            assert all(math.isfinite(x) for x in joint_states[-1]['position']), 'non-finite simulator joint feedback'
            publishers = observer.get_publishers_info_by_topic('/leg_controller/joint_trajectory')
            subscribers = observer.get_subscriptions_info_by_topic('/leg_controller/joint_trajectory')
            if len(publishers) == 1 and publishers[0].node_name == 'hexapod_gait' and len([r for r in subscribers if r.node_name == 'leg_controller']) == 1:
                return
        time.sleep(0.05)
    raise RuntimeError('gait, controller feedback or Gazebo clock did not become active')
def exports(name):
    controller, gait = OUT/(name+'-controller.json'), OUT/(name+'-gait.json')
    cli(name+'-export-controller', 'export-controller', '--manager', '/controller_manager', '--controller', 'leg_controller', '--node', '/leg_controller', '--output', controller)
    cli(name+'-export-gait', 'export-node-settings', '--node', '/hexapod_gait', '--downstream-node', '/leg_controller', '--topic', '/leg_controller/joint_trajectory',
        '--type', 'trajectory_msgs/msg/JointTrajectory', '--output', gait)
    save(OUT/(name+'-activity.json'), {'counts': dict(counts), 'recentTrajectories': list(trajectories), 'recentJointStates': list(joint_states)})
    return controller, gait
try:
    start(['/usr/bin/gz', 'sim', '-s', '-r', '-v', '3', '/usr/share/gz/gz-sim8/worlds/empty.sdf'], 'gazebo')
    start(['/opt/ros/jazzy/lib/robot_state_publisher/robot_state_publisher', '--ros-args', '--params-file', OUT/'rsp.yaml'], 'robot-state-publisher')
    start(['/opt/ros/jazzy/lib/ros_gz_bridge/parameter_bridge', '--ros-args', '-p', 'config_file:='+str(prefixes[0]/'share/Hexapod_Robot_description/config/ros_gz_bridge_gazebo.yaml')], 'clock-bridge')
    run(['/opt/ros/jazzy/lib/ros_gz_sim/create', '-file', OUT/'robot.urdf', '-name', 'Hexapod_Robot', '-allow_renaming', 'false', '-z', '0.32'], 'spawn-original-model')
    for controller in ['joint_state_broadcaster', 'leg_controller', 'face_controller']:
        run(['/opt/ros/jazzy/lib/controller_manager/spawner', controller, '-c', '/controller_manager'], 'activate-'+controller)
    gait_command = [sys.executable, SOURCE/'src/hexapod_gait/hexapod_gait/gait_node.py', '--ros-args', '-p', 'use_sim_time:=true']
    before = dict(counts); gait = start(gait_command, 'gait-baseline'); wait_for_activity(before)
    baseline_controller, baseline_gait = exports('baseline')
    cli('discover', 'discover', '--output', OUT/'catalog.json')
    workspace = OUT/'workspace'
    cli('prepare-source', 'prepare-source', '--recipe', 'hexapod-gait', '--source', SOURCE, '--catalog', OUT/'catalog.json', '--urdf', OUT/'robot.urdf',
        '--settings', OUT/'runtime-settings.json', '--example', OUT/'example.json', '--device-id', 'isolated-public-hexapod', '--frame', 'base_footprint',
        '--controller-state', baseline_controller, '--node-settings', baseline_gait, '--output', workspace)
    cli('approve', 'approve', '--profile', workspace/'profile.json', '--actor', 'public-gazebo-source-review', '--expires-at',
        (datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(), '--output', workspace/'approval.json')
    cli('baseline-capture', 'capture', '--profile', workspace/'profile.json', '--output', OUT/'baseline.json')
    preserved = {p: hashlib.sha256((workspace/p).read_bytes()).hexdigest() for p in ['approval.json', 'profile.json', 'proposals.json']}
    # This source caches parameters during construction. A parameter-service
    # update alone would not prove changed effective settings: restart with the
    # explicit launch override, preserving source, model and all controllers.
    stop(gait); before = dict(counts)
    gait = start([*gait_command, '-p', 'cycle_time:=2.0'], 'gait-changed'); wait_for_activity(before)
    changed_controller, changed_gait = exports('changed')
    a, b = (json.loads(p.read_text()) for p in [baseline_gait, changed_gait])
    assert a['configuration']['parameters']['cycle_time']['value'] == '1.0'
    assert b['configuration']['parameters']['cycle_time']['value'] == '2.0'
    cli('refresh-source', 'refresh-source', '--workspace', workspace, '--source', SOURCE, '--urdf', OUT/'robot.urdf', '--settings', OUT/'runtime-settings.json',
        '--controller-state', changed_controller, '--node-settings', changed_gait)
    cli('changed-capture', 'capture', '--profile', workspace/'profile.json', '--output', OUT/'changed.json')
    cli('compare', 'compare', '--profile', workspace/'profile.json', '--approval', workspace/'approval.json', '--baseline', OUT/'baseline.json',
        '--changed', OUT/'changed.json', '--proposals', workspace/'proposals.json', '--output', OUT/'comparison')
    old, changed = (json.loads((OUT/'comparison'/name/'report.json').read_text()) for name in ['baseline', 'changed'])
    assert old['decision'] == 'WOULD_ALLOW' and changed['decision'] == 'WOULD_BLOCK'
    assert any(x['reason'] == 'fact_mismatch:gait-node-settings' for x in changed['results'][0]['checks'])
    assert not old['hardwareSignalSent'] and not changed['hardwareSignalSent'] and counts['twists'] == 0
    assert preserved == {p: hashlib.sha256((workspace/p).read_bytes()).hexdigest() for p in preserved}
    save(OUT/'summary.json', {'sourceRevision': REVISION, 'scope': 'Unmodified public Gazebo model and gait/IK, neutral stance only; no physical HAL or customer acceptance',
         'baseline': old['decision'], 'changed': changed['decision'], 'change': 'gait restart with cycle_time 1.0 -> 2.0; same source/model/controllers and original approval',
         'preserved': preserved, 'countsBeforeShutdown': dict(counts), 'rlsokCommandPublications': 0, 'rlsokActionGoalsSent': 0})
    print('Hexapod real Gazebo/gait chain: WOULD_ALLOW -> WOULD_BLOCK, original approval preserved; zero RLSOK commands', flush=True)
finally:
    for p in reversed(processes):
        if p.poll() is None: stop(p)
    for log in logs: log.close()
    executor.shutdown(timeout_sec=5); observer.destroy_node()
    if rclpy.ok(): rclpy.shutdown()
    thread.join(timeout=5)

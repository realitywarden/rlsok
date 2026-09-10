"""One isolated real ros2_control controller swap on GenericSystem mock hardware.
Uses public SO-101/Kortex controller parameters. No physical driver is started;
no trajectory, velocity or motion command is published. Not customer acceptance.
"""
import copy, hashlib, json, os, pathlib, subprocess, sys, time, xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
import argparse
parser=argparse.ArgumentParser(description='Explicit isolated GenericSystem experiment; switches mock controllers, never sends motion commands.')
parser.add_argument('--recipe',choices=['so101-arm','kinova-gen3-7dof'],required=True)
parser.add_argument('--runtime',type=pathlib.Path,required=True)
parser.add_argument('--source',type=pathlib.Path,required=True)
parser.add_argument('--node',type=pathlib.Path,required=True)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
ROOT=args.runtime.resolve(); KEY=args.recipe
OUT=args.output.resolve(); OUT.mkdir()
NODE=args.node.resolve(); CLI=ROOT/'dist/apps/cli/rlsok.js'
os.environ['ROS_DOMAIN_ID'] = '220' if KEY == 'so101-arm' else '221'
os.environ['ROS_AUTOMATIC_DISCOVERY_RANGE'] = 'LOCALHOST'
os.environ.pop('ROS_LOCALHOST_ONLY', None)
os.environ['RMW_IMPLEMENTATION'] = 'rmw_fastrtps_cpp'
import yaml, rclpy
from std_msgs.msg import String
from rcl_interfaces.srv import SetParameters
from rcl_interfaces.msg import Parameter, ParameterValue, ParameterType
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
recipes = json.loads(subprocess.check_output([str(NODE), '-e', "console.log(JSON.stringify(require('./dist/packages/composable-shadow/source-recipes.js').sourceRecipes))"], cwd=ROOT))
recipe = recipes[KEY]; spec = recipe['controllerState']
source = args.source.resolve()
def save(path, value): path.write_text(json.dumps(value, indent=2)+'\n')
def run(args, name, timeout=70):
    result = subprocess.run(list(map(str,args)), cwd=ROOT, text=True, capture_output=True, timeout=timeout)
    (OUT/(name+'.log')).write_text(result.stdout+result.stderr)
    if result.returncode: raise RuntimeError(name+': '+result.stdout+result.stderr)
    return result.stdout
def cli(name, *args): return run([NODE,CLI,'profile',*args],name)
def export(name):
    target=OUT/(name+'.json')
    cli(name,'export-controller','--manager','/controller_manager','--controller',spec['name'],'--node','/'+spec['name'],'--output',target)
    return target
def capture(name, profile):
    target=OUT/(name+'.json');cli(name,'capture','--profile',profile,'--output',target);return target

def set_mock_controller_type(value):
    # Use this experiment's node directly; do not depend on a ros2 CLI daemon's
    # cached node list after unloading a controller. Never called by the exporter.
    client=description.create_client(SetParameters,'/controller_manager/set_parameters')
    try:
        if not client.wait_for_service(timeout_sec=10): raise RuntimeError('mock manager parameter service unavailable')
        request=SetParameters.Request(parameters=[Parameter(name='arm_controller.type',
            value=ParameterValue(type=ParameterType.PARAMETER_STRING,string_value=value))])
        future=client.call_async(request);rclpy.spin_until_future_complete(description,future,timeout_sec=10)
        if not future.done() or future.result() is None: raise RuntimeError('mock type-change request timed out')
        results=future.result().results
        if len(results)!=1 or not results[0].successful: raise RuntimeError('mock type change rejected: '+str(results))
        save(OUT/'set-arm-type.json',{'successful':True,'type':value,'scope':'explicit mock experiment only'})
    finally: description.destroy_client(client)

# Mock kinematics only: no robot dynamics or physical driver is validated.
robot=ET.Element('robot',name='rlsok_software_controller_fixture')
ET.SubElement(robot,'link',name='base')
joint_names=list(recipe['joints'])+(['gripper'] if KEY=='so101-arm' else [])
for i,name in enumerate(joint_names):
    ET.SubElement(robot,'link',name='link_'+str(i))
    j=ET.SubElement(robot,'joint',name=name,type='revolute')
    ET.SubElement(j,'parent',link='base' if i==0 else 'link_'+str(i-1))
    ET.SubElement(j,'child',link='link_'+str(i))
    ET.SubElement(j,'axis',xyz='0 0 1')
    ET.SubElement(j,'limit',lower='-3.14',upper='3.14',velocity='1',effort='1')
control=ET.SubElement(robot,'ros2_control',name='RlsokMockSystem',type='system')
hardware=ET.SubElement(control,'hardware');ET.SubElement(hardware,'plugin').text='mock_components/GenericSystem'
for claim in spec['claimedInterfaces']+(['gripper/position'] if KEY=='so101-arm' else []):
    joint_name, interface=claim.rsplit('/',1)
    assert robot.find("./joint[@name='"+joint_name+"']") is not None
    joint=ET.SubElement(control,'joint',name=joint_name)
    ET.SubElement(joint,'command_interface',name=interface)
    for state_name in ['position','velocity']:
        state=ET.SubElement(joint,'state_interface',name=state_name);ET.SubElement(state,'param',name='initial_value').text='0.0'
urdf=OUT/'mock-expanded.urdf';urdf.write_text(ET.tostring(robot,encoding='unicode'))
config=yaml.safe_load((source/recipe['files'][0]).read_text())
config['controller_manager']['ros__parameters']['use_sim_time']=False

params=OUT/'controller-manager.yaml';params.write_text(yaml.safe_dump(config, sort_keys=False))
settings=OUT/'settings.json';save(settings,{'validationOnly':True,'hardwarePlugin':'mock_components/GenericSystem','customerRun':False,
    'managerConfigurationSha256':hashlib.sha256(params.read_bytes()).hexdigest(),'sourceCommit':recipe['referenceCommit']})
if recipe.get('joints'):
    example={'trajectory':{'joint_names':recipe['joints'],'points':[{'positions':[0]*len(recipe['joints']),'time_from_start':{'sec':1,'nanosec':0}}]}}
else:
    example={'header':{'frame_id':'base_footprint','stamp':{'sec':1,'nanosec':0}},'twist':{'linear':{'x':0,'y':0,'z':0},'angular':{'x':0,'y':0,'z':0}}}
sample=OUT/'example.json';save(sample,example)
rclpy.init(args=[])
description=rclpy.create_node('rlsok_isolated_model_source', enable_rosout=False, start_parameter_services=False)
process=None; log=None
try:
    until=time.monotonic()+2
    while time.monotonic()<until:rclpy.spin_once(description,timeout_sec=0.1)
    nodes=description.get_node_names_and_namespaces()
    assert all(name=='rlsok_isolated_model_source' for name,_ in nodes),'isolation domain already contains nodes'
    qos=QoSProfile(depth=1,reliability=ReliabilityPolicy.RELIABLE,durability=DurabilityPolicy.TRANSIENT_LOCAL)
    publisher=description.create_publisher(String,'/robot_description',qos)
    publisher.publish(String(data=urdf.read_text()))
    log=open(OUT/'controller-manager.log','w')
    process=subprocess.Popen(['/opt/ros/jazzy/lib/controller_manager/ros2_control_node','--ros-args','--params-file',str(params)],stdout=log,stderr=subprocess.STDOUT)
    extra=['--param-file',str(params)]
    run(['/opt/ros/jazzy/lib/controller_manager/spawner',spec['name'],'--controller-manager','/controller_manager',*extra],'activate-baseline')
    print(KEY+': real controller active on mock hardware',flush=True)
    if KEY=='so101-arm':
        run(['/opt/ros/jazzy/lib/controller_manager/spawner','gripper_controller','-c','/controller_manager','-p',params],'activate-gripper')
        cli('gripper-before','export-controller','--manager','/controller_manager','--controller','gripper_controller','--node','/gripper_controller','--output',OUT/'gripper-before.json')
    state=export('baseline-controller')
    cli('discover','discover','--output',OUT/'catalog.json')
    workspace=OUT/'workspace'
    args=['prepare-source','--recipe',KEY,'--source',source,'--catalog',OUT/'catalog.json','--urdf',urdf,'--settings',settings,'--example',sample,
          '--controller-state',state,'--device-id','isolated-mock-controller','--output',workspace]
    if KEY=='trik-drive':args+=['--frame','base_footprint']
    cli('prepare',*args)
    expires=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()
    profile=workspace/'profile.json'; approval=workspace/'approval.json'
    cli('approve','approve','--profile',profile,'--actor','local-mock-controller-validation','--expires-at',expires,'--output',approval)
    before=capture('baseline',profile)
    keep={p:hashlib.sha256((workspace/p).read_bytes()).hexdigest() for p in ['profile.json','approval.json','proposals.json']}
    if KEY=='so101-arm':
        changed_params=OUT/'changed-controller-manager.yaml'
        cli('prepare-swap','prepare-so101-swap','--input',params,'--output',changed_params)
        run(['ros2','control','switch_controllers','--deactivate',spec['name'],'--strict','-c','/controller_manager'],'deactivate-arm')
        run(['ros2','control','unload_controller',spec['name'],'-c','/controller_manager'],'unload-arm')
        set_mock_controller_type('position_controllers/JointGroupPositionController')
        run(['/opt/ros/jazzy/lib/controller_manager/spawner',spec['name'],'-c','/controller_manager','-p',changed_params],'activate-changed-arm')
    else:
        # A software-state change in the same seven-axis controller, on mock hardware.
        run(['ros2','control','switch_controllers','--deactivate',spec['name'],'--strict','-c','/controller_manager'],'deactivate-controller')
    state=export('changed-controller')
    changed_state=json.loads(state.read_text())['configuration']
    if KEY=='so101-arm':
        assert changed_state['controller']['state']=='active'
        assert changed_state['controller']['type']=='position_controllers/JointGroupPositionController'
        assert sorted(changed_state['controller']['claimed_interfaces'])==sorted(spec['claimedInterfaces'])
        assert changed_state['actionServers']==[]
        assert changed_state['parameters']['joints']['value']==recipe['joints']
        cli('gripper-after','export-controller','--manager','/controller_manager','--controller','gripper_controller','--node','/gripper_controller','--output',OUT/'gripper-after.json')
        assert json.loads((OUT/'gripper-before.json').read_text())['configuration']==json.loads((OUT/'gripper-after.json').read_text())['configuration']
    else:
        assert changed_state['controller']['state']=='inactive'
    cli('controller-diff','compare-controllers','--baseline',OUT/'baseline-controller.json','--changed',state,'--output',OUT/'controller-diff')
    cli('refresh','refresh-source','--workspace',workspace,'--source',source,'--urdf',urdf,'--settings',settings,'--controller-state',state)
    after=capture('changed',profile)
    cli('compare','compare','--profile',profile,'--approval',approval,'--baseline',before,'--changed',after,'--proposals',workspace/'proposals.json','--output',OUT/'comparison')
    reports=[json.loads((OUT/'comparison'/phase/'report.json').read_text()) for phase in ['baseline','changed']]
    assert [r['decision'] for r in reports]==['WOULD_ALLOW','WOULD_BLOCK']
    assert any(c['reason']=='fact_mismatch:active-controller' for c in reports[1]['results'][0]['checks'])
    assert not any(r['hardwareSignalSent'] or r['controllerGoalsAttempted'] for r in reports)
    assert keep=={p:hashlib.sha256((workspace/p).read_bytes()).hexdigest() for p in keep}
    summary={'recipe':KEY,'sourceCommit':recipe['referenceCommit'],'controllers':'real installed ROS 2 controller_manager and plugins',
       'hardware':'mock_components/GenericSystem only','change':('same-name JTC to JointGroupPositionController, same five joints, gripper unchanged' if KEY=='so101-arm' else 'deactivate seven-axis JTC'),
       'baseline':'WOULD_ALLOW','changed':'WOULD_BLOCK','activeControllerFactMismatch':True,'motionCommandsPublished':0,'customerRun':False}
    save(OUT/'summary.json',summary);print(json.dumps(summary),flush=True)
finally:
    if process:
        process.terminate()
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:process.kill();process.wait()
    if log:log.close()
    description.destroy_node();rclpy.shutdown()

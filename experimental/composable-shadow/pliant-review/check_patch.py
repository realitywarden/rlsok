"""Focused pure-Python checks of two patched callbacks. No ROS/SDK imports or hardware.
Usage: python3 check_patch.py PATH_TO_REVIEWED_PATCHED_CHECKOUT
Verifies exact reviewed bytes, then compiles only the selected method AST nodes.
"""
import ast, hashlib, json, math, pathlib, sys, types
root=pathlib.Path(sys.argv[1]); manifest=json.loads(pathlib.Path(__file__).with_name('source.json').read_text())
def method(filename, name):
    path=next(p for p in manifest['files'] if p.endswith('/'+filename))
    raw=(root/path).read_bytes()
    # Normalize checkout line endings to the published LF patch's representation.
    raw=raw.replace(b'\r\n', b'\n')
    assert hashlib.sha256(raw).hexdigest()==manifest['files'][path]['afterSha256'], 'unreviewed file bytes: '+path
    tree=ast.parse(raw.decode()); f=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name==name)
    for arg in f.args.args:arg.annotation=None
    f.returns=None
    ns={'math':math,'MODE_POSITION':3,'MODE_VELOCITY':1}
    exec(compile(ast.Module(body=[f],type_ignores=[]),filename,'exec'),ns)
    return ns[name]
cmd=method('controller.py','_command_targets'); recv=method('Dynamixel_XW430_T200_interface.py','_cmd_cb')
class Fixture:
    def __init__(self):
        self.all_ids=[1,2];self.operating_mode='position';self.limits={1:(-1,1),2:(-2,2)}
        self.command_smoothing=0;self._cmd_smooth={};self.feedback={};self.last_pos_time={};self.POSE_TOLERANCE=0.01
        self.sent=[];self.logged=[];self.latest_command=([1],[3],[0.5]);self.is_configured=True;self.active_ids=[1,2]
    def get_logger(self):return self
    def error(self,x):self.logged.append(x)
    warn=error
    def _publish_cmd(self,*args):self.sent.append(args)
    def _buffer_telemetry(self,*args):pass
count=0
for invalid in [math.nan, math.inf, -math.inf, '1', True]:
    for mode in ['position','velocity']:
        f=Fixture();f.operating_mode=mode;cmd(f,{1:0.2,2:invalid});assert not f.sent;count+=1
for defect in ['missing','reversed','infinite','unknown','smooth-nan','smooth-history','duplicate']:
    f=Fixture();target={1:0.2}
    if defect=='missing':del f.limits[2]
    if defect=='reversed':f.limits[2]=(2,-2)
    if defect=='infinite':f.limits[2]=(-math.inf,math.inf)
    if defect=='unknown':target[3]=0.3
    if defect=='smooth-nan':f.command_smoothing=math.nan
    if defect=='smooth-history':f.command_smoothing=0.5;f._cmd_smooth[2]=math.nan
    if defect=='duplicate':f.all_ids=[1,1]
    cmd(f,target);assert not f.sent;assert not f._cmd_smooth or defect=='smooth-history';count+=1
f=Fixture();cmd(f,{1:5,2:-5});assert f.sent==[([1,2],[3,3],[1,-2])];count+=1
f=Fixture();cmd(f,{2:0.5},only_named=True);assert f.sent==[([2],[3],[0.5])];count+=1
f=Fixture();f.operating_mode='velocity';cmd(f,{1:0.2,2:-0.3});assert f.sent==[([1,2],[1,1],[0.2,-0.3])];count+=1
for data in [[],[1,3,0,9],[1,3,math.nan],[1.5,3,0],[253,3,0],[1,2,0],[1,1,3,3,0,0],[3,3,0],[1,math.inf,0]]:
    f=Fixture();recv(f,types.SimpleNamespace(data=data));assert f.latest_command is None;count+=1
f=Fixture();recv(f,types.SimpleNamespace(data=[1,2,3,1,0.25,-0.1]));assert f.latest_command==([1,2],[3,1],[0.25,-0.1]);count+=1
print(json.dumps({'checksPassed':count,'ROSImported':False,'hardwareOpened':False,'scope':'two reviewed callbacks only'}))

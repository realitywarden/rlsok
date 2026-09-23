# RealRobot UR7e：先读一次真机状态，不动机械臂

这是给 [RealRobot](https://github.com/wyh336699/RealRobot) v1.1 维护者审阅的第一次接入。依据公开源码 commit `76cc03ded04f7bc12e47007a840712da513e5118`：项目默认是 Mock；选择真实硬件并连接后，自己的后端同时建立 Dashboard、RTDE Receive、RTDE Control 和 RTDE IO 连接。因此 RLSOK **不调用** RealRobot 的 `connect()`、`disconnect()` 或 GUI 命令路径。它只新建一个短暂的 `RTDEReceiveInterface`，以 10 Hz 读两次时间戳和一次状态，然后断开自己的接收连接；不创建 Control/IO 对象，不调用 `stopScript()`、上电、松刹车、Jog、moveJ 或 moveL。

这仍是一次到机器人 RTDE 服务的网络连接，不是“完全没有网络流量”。请先看脚本；仅在你本来就要使用真实 UR7e、并且确认额外的接收连接不会干扰现有工作时运行。不要为了 RLSOK 开机、切模式或移动机械臂。如果 RTDE 接收端报告连接冲突或异常，停止这次检查，把错误行发回来即可。

## 在现有 RealRobot 环境中运行

1. 下载本页对应 release 的 ZIP，核对 SHA-256，然后解压。不要从旧的 Local Check 安装包猜测这个脚本已包含其中。
2. 使用 RealRobot 目前实际运行的 Git checkout。它的 `configs/robots/ur7e.yaml` 应包含当前机器人 IP；脚本只在本机读取该地址，不把地址或其简单哈希写入 JSON。若 GUI 使用的是另一个配置副本，先不要运行。
3. 在已经安装 RealRobot `.[ur]` 依赖的 Python 环境中，从解压包的 `experimental/composable-shadow` 目录运行：

```bash
python3 realrobot_ur_status.py --source-root /path/to/RealRobot --output realrobot-ur-status.json
```

脚本要求配置中的地址是私有 IPv4；不会接受公共、环回或未指定地址。输出文件已存在时不会覆盖。它不会安装、启动或重启 RealRobot。成功时显示 `OBSERVED | RealRobot UR RTDE Receive | hardware dispatch: NO`。如果失败，请只发完整错误行，不必发 IP、凭据或整份配置。

## 这次结果能说明什么

JSON 记录选定的 RealRobot 版本、Git checkout commit/dirty 状态、去掉主机地址后的配置选项，以及连续增长的 RTDE 控制器时间戳、机器人/安全模式、六轴状态可读性。为减少披露，第一次报告不保存 IP、实时关节角或 TCP 位姿。`observationSha256` 可用于发现报告内容被修改。

它不能独立证明 GUI 当时处于真实而非 Mock 模式、该 checkout 就是正在运行的 GUI、RTDE 对端是预期 UR7e、机器人序列号或校准正确，也不能证明 RLSOK 已接管命令授权。请只有在确实是正常真机工作会话时，连同 JSON 简单说明“当时是实体 UR7e，RealRobot GUI 已在真实硬件模式正常连接”；如果不是，直接说明即可。不要附机器人私有 IP。

这一步是**实时接收链路**，不是 RealRobot 完整运行时集成。要让 RLSOK 真正参与 GUI 的下发前检查，需要在其命令路径明确选择接入点、失败返回方式和审阅者；不能把这个只读观察器说成已阻止了 Jog 或 moveJ。

参考：[RealRobot v1.1 源码](https://github.com/wyh336699/RealRobot/tree/76cc03ded04f7bc12e47007a840712da513e5118)、[ur_rtde Receive/Control/IO 接口区别](https://sdurobotics.gitlab.io/ur_rtde/pages/getting_started/quick_start.html)、[ur_rtde 架构说明](https://sdurobotics.gitlab.io/ur_rtde/introduction/introduction.html)。

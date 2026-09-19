# Navigation preflight before Nav2

`profile check-navigation-preflight` turns recurring real-bringup checks into a
single fail-closed, zero-dispatch decision. It covers the selected DDS/network
configuration and peers, host/robot clock skew, lidar identity/configuration and
fresh scan rate, required TF edges, scan/odometry timestamp and alignment
checks, and the selected Nav2 lifecycle/command path.

```sh
rlsok profile check-navigation-preflight \
  --input go2-preflight-observation.json --output go2-preflight-report
```

The input is `RlsokNavigationPreflightObservation` JSON. Record an actual
observation time, explicit thresholds, DDS domain/RMW/configuration digest and
expected robot peers; clock source/sample count/skew; lidar model, optional
serial, topic/frame/configuration digest, publisher count/rate/age; every
required parent→child transform with availability and age; scan and odometry
freshness/monotonicity plus the named alignment diagnostic; and every required
Nav2 lifecycle node.

Exit 0 and `WOULD_ALLOW` mean only that all selected checks passed while fresh.
The command creates no ROS entity and sends no goal or velocity command. An
operator-supplied JSON is self-attested. An integration observer must collect
the values read-only and preserve the real timestamp; changing a timestamp to
make stale data pass invalidates the evidence.

This preflight complements the [observed Nav2 Shadow workflow](nav2-observed-shadow.md),
which binds exact FollowPath selectors, topology, smoother settings and the
reviewed goal. It does not authenticate a Go2 or Hokuyo merely from a hostname,
topic or serial string; use an authenticated device/session observer where the
hardware supports one. It also does not validate localization accuracy, scan
geometry, path safety or physical stopping, and it cannot prevent unrelated
nodes from commanding the robot.

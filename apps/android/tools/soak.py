#!/usr/bin/env python3
"""Read-only real-time Pixel 3 evidence collector. No credentials or inventory payloads."""
import argparse, datetime, json, pathlib, subprocess, time
from device import ADB, SERIAL, check_device
parser=argparse.ArgumentParser()
parser.add_argument('--hours', type=float, default=24)
parser.add_argument('--interval', type=int, default=300)
args=parser.parse_args()
if not 0 < args.hours <= 168 or args.interval < 30: raise SystemExit('Choose 0–168 hours and interval >=30 seconds.')
check_device()
start=datetime.datetime.now(datetime.timezone.utc)
out=pathlib.Path(__file__).resolve().parents[3]/'output/android'/('soak-'+start.strftime('%Y%m%dT%H%M%SZ')+'.jsonl')
commands={
 'battery':'dumpsys battery',
 'thermal':'dumpsys thermalservice',
 'power':'dumpsys power',
 'dreams':'dumpsys dreams',
 'camera':'dumpsys media.camera',
 'sync':'su -c "cat /data/user/0/top.protium.acornary/no_backup/sync-journal.csv"',
 'crash':'logcat -d -b crash -t 100',
}
out.parent.mkdir(parents=True,exist_ok=True)
end=time.monotonic()+args.hours*3600
with out.open('x') as stream:
 def record(value): stream.write(json.dumps(value,ensure_ascii=False)+'\n'); stream.flush()
 record({'type':'start','at':start.isoformat(),'requested_hours':args.hours,'interval_seconds':args.interval})
 try:
  while True:
   sample={'type':'sample','at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
   for name,command in commands.items():
    try:
     result=subprocess.run([ADB,'-s',SERIAL,'shell',command],capture_output=True,text=True,timeout=20)
     # Camera/power diagnostics are bounded; no screen capture or authentication files.
     sample[name]={'exit':result.returncode,'output':result.stdout[-30000:]}
    except subprocess.TimeoutExpired: sample[name]={'error':'timeout'}
   record(sample)
   remaining=end-time.monotonic()
   if remaining<=0: break
   time.sleep(min(args.interval,remaining))
  record({'type':'completed','at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 except KeyboardInterrupt: record({'type':'interrupted','at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
print(out)

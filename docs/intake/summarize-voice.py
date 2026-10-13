"""Summarize real host trials without counting failed/partial tasks as speed wins."""
import csv, json, math, sys
from collections import defaultdict
from pathlib import Path
rows = list(csv.DictReader(Path(sys.argv[1]).open(newline='', encoding='utf-8')))
groups = defaultdict(list)
for row in rows:
    conditions = tuple(row[k] for k in ('phase', 'scenario', 'client', 'client_version', 'model', 'plugin_version', 'approval_settings', 'test_dataset', 'first_policy_confirmation'))
    groups[conditions].append(row)
results = []
for key, sample in groups.items():
    successful = [r for r in sample if r['success'].lower() in ('true', '1', 'yes') and int(r['classification_deviations']) == 0]
    times = sorted(float(r['task_seconds']) for r in successful)
    percentile = lambda p: times[max(0, math.ceil(len(times)*p)-1)] if times else None
    results.append(dict(conditions=key, attempted=len(sample), successful=len(successful), success_rate=len(successful)/len(sample), median_seconds=percentile(.5), p90_seconds=percentile(.9), clarifications=sum(int(r['clarifications']) for r in sample), tool_roundtrips=sum(int(r['tool_roundtrips']) for r in sample), platform_approvals=sum(int(r['platform_approvals']) for r in sample), classification_deviations=sum(int(r['classification_deviations']) for r in sample), at_least_20=len(sample)>=20))
print(json.dumps({'scope': 'Real host only; compare matching conditions and frozen thresholds separately', 'groups': results, 'status': 'NO_REAL_SAMPLES' if not rows else 'REVIEW_REQUIRED'}, ensure_ascii=False, indent=2))

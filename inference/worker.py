"""Long-lived NumPyro worker for the app's background inference.

Reads one JSON job per line on stdin: {"id", "script", "dataset", "out", "method", "options"}.
Writes "STAGE <name>" while working, then "DONE <id>" or "ERROR <id> <json message>".
Keeping one process alive saves the JAX import on every job.
"""
import importlib.util
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pw_numpyro  # noqa: E402

pw_numpyro.setup(4)
import jax  # noqa: E402,F401  (warm the import now, not on the first job)

print("READY", flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    job = json.loads(line)
    try:
        pw_numpyro.stage("load")
        spec = importlib.util.spec_from_file_location(f"pw_model_{job['id']}", job["script"])
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        pw_numpyro.fit(mod, job["dataset"], job["out"], job["method"], **job.get("options", {}))
        print(f"DONE {job['id']}", flush=True)
    except Exception:
        print(f"ERROR {job['id']} {json.dumps(traceback.format_exc()[-1500:])}", flush=True)

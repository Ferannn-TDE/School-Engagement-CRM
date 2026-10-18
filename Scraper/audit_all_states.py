import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).parent
RESULTS = ROOT / "all_state_audit.json"


def check_state(state):
    from source_resolver import StateSourceResolver

    try:
        with tempfile.TemporaryDirectory() as folder:
            schools = StateSourceResolver(states=[state]).load(folder)
            health = json.loads((Path(folder) / "source_health.json").read_text())
        public = sum(school.school_type.startswith("Public") for school in schools)
        private = sum(school.school_type.startswith("Private") for school in schools)
        if not public or not private:
            missing = "public" if not public else "private"
            raise RuntimeError(f"No {missing} grade-12 schools were resolved.")
        seeded = sum(bool(school.seeds) for school in schools)
        if seeded != len(schools):
            raise RuntimeError(f"Only {seeded} of {len(schools)} schools have seed URLs.")
        return {
            "state": state,
            "success": True,
            "schools": len(schools),
            "public": public,
            "private": private,
            "seeded": seeded,
            "official_website_fields": sum(bool(school.website) for school in schools),
            "directory_roster_candidates": sum("nfhsnetwork.com" in school.data_source for school in schools),
            "failed_sources": [name for name, status in health.get(state, {}).items() if not status.get("success")],
            "coverage_note": "Seed availability is not verified homepage resolution or complete state coverage.",
        }
    except Exception as error:
        return {
            "state": state,
            "success": False,
            "error": " ".join(str(error).split()),
        }


def child(state):
    print("AUDIT_RESULT=" + json.dumps(check_state(state)), flush=True)


def run_one(state, timeout=600):
    environment = dict(os.environ)
    environment["PYTHONPATH"] = os.pathsep.join(filter(None, (
        str(ROOT),
        environment.get("PYTHONPATH", ""),
    )))
    try:
        process = subprocess.run(
            [sys.executable, __file__, "--state", state],
            cwd=ROOT,
            env=environment,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"state": state, "success": False, "error": f"Timed out after {timeout} seconds."}

    for line in reversed(process.stdout.splitlines()):
        if line.startswith("AUDIT_RESULT="):
            return json.loads(line.removeprefix("AUDIT_RESULT="))
    detail = process.stderr.strip() or process.stdout.strip() or f"Exited with {process.returncode}."
    return {"state": state, "success": False, "error": " ".join(detail.split())}


def parent(workers, selected=None, timeout=600):
    catalog = json.loads((ROOT / "state_sources.json").read_text(encoding="utf-8-sig"))
    states = sorted(selected or catalog["states"])
    unknown = set(states) - set(catalog["states"])
    if unknown:
        raise ValueError(f"Unknown states: {sorted(unknown)}")
    results = {}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(run_one, state, timeout): state for state in states}
        for job in as_completed(jobs):
            result = job.result()
            results[result["state"]] = result
            status = (
                f"{result['schools']} schools "
                f"({result['public']} public, {result['private']} private), "
                f"{result['seeded']} seeded"
                if result["success"] else result["error"]
            )
            print(f"{result['state']}: {status}", flush=True)
            RESULTS.write_text(
                json.dumps([results[state] for state in sorted(results)], indent=2) + "\n",
                encoding="utf-8",
            )

    return 0 if all(item["success"] for item in results.values()) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--state")
    parser.add_argument("--timeout", type=int, default=600, help="Per-state timeout in seconds")
    parser.add_argument("--states", help="Comma-separated states, e.g. CA,IA,MN,VA")
    parser.add_argument("--workers", type=int, default=6)
    options = parser.parse_args()
    if options.workers < 1:
        parser.error("--workers must be at least 1")
    if options.state:
        child(options.state.upper())
    else:
        selected = [value.strip().upper() for value in options.states.split(",") if value.strip()] if options.states else None
        sys.exit(parent(options.workers, selected, options.timeout))

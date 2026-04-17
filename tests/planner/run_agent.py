#!/usr/bin/env python3
# tests/planner/run_agent.py
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).parent
PATHS_DIR = ROOT / "paths"
FLOWS_DIR = ROOT / "flows"
RESULTS_DIR = ROOT / "results"
CONFIG_PATH = ROOT.parent.parent / "config" / "models.json"


def list_paths(paths_dir: Path = PATHS_DIR) -> None:
    for p in sorted(paths_dir.glob("*.yaml")):
        d = yaml.safe_load(p.read_text())
        print(f"  {d['id']:2d}. {d['name']}")


def load_path(path_id: int, paths_dir: Path = PATHS_DIR) -> dict:
    matches = list(paths_dir.glob(f"{path_id:02d}_*.yaml"))
    if not matches:
        print(f"Error: path {path_id} not found in {paths_dir}", file=sys.stderr)
        sys.exit(1)
    return yaml.safe_load(matches[0].read_text())


def load_default_provider() -> tuple[str, str]:
    with open(CONFIG_PATH) as f:
        config = json.load(f)
    for m in config.get("models", []):
        if m.get("supports_tools"):
            return m["provider"], m["id"]
    return "anthropic", "claude-sonnet-4-6"


def main() -> None:
    parser = argparse.ArgumentParser(description="Planner LLM testing agent")
    parser.add_argument("--path", type=int, help="Path ID (1-7)")
    parser.add_argument("--all", action="store_true", help="Run all paths")
    parser.add_argument("--list", action="store_true", help="List available paths")
    parser.add_argument("--provider", help="LLM provider name (anthropic/google/openrouter/…)")
    parser.add_argument("--model", help="Model ID from config/models.json")
    args = parser.parse_args()

    if args.list:
        list_paths()
        return

    if not args.path and not args.all:
        parser.print_help()
        return

    from providers import load_provider
    from agent import run_test

    provider_name, model_name = args.provider, args.model
    if not provider_name:
        provider_name, model_name = load_default_provider()
    elif not model_name:
        print("Error: --model is required when --provider is specified", file=sys.stderr)
        sys.exit(1)

    provider = load_provider(provider_name, model_name)
    print(f"Provider: {provider_name}/{model_name}\n")

    FLOWS_DIR.mkdir(exist_ok=True)
    RESULTS_DIR.mkdir(exist_ok=True)

    paths = (
        [yaml.safe_load(p.read_text()) for p in sorted(PATHS_DIR.glob("*.yaml"))]
        if args.all
        else [load_path(args.path)]
    )

    results = []
    for descriptor in paths:
        print(f"── Path {descriptor['id']}: {descriptor['name']}")
        result = run_test(provider, descriptor, FLOWS_DIR, RESULTS_DIR)
        results.append(result)

    passed = sum(1 for r in results if r["result"] == "PASS")
    print(f"\n{'─' * 40}")
    print(f"Results: {passed}/{len(results)} passed")


if __name__ == "__main__":
    main()

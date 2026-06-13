#!/usr/bin/env python3
"""Manual e2e tester for autonomous agent tasks.

Publishes a TASK_START frame straight to Redis (exactly what
RedisSession._spawn_background_task does), so a task runs deterministically
without relying on the model choosing the start_background_task tool. Can also
send steering / approval decisions and tail the live event stream.

Run from the `back/` directory with the venv active:

    # start a task and follow its events live
    python scripts/trigger_task.py start \
        --goal "Plan a 5-step team offsite and summarize each step" --tail

    # steer a running task
    python scripts/trigger_task.py steer --task <TASK_ID> \
        --message "Use argparse, not click"

    # approve / reject a pending gate
    python scripts/trigger_task.py approve --task <TASK_ID>
    python scripts/trigger_task.py approve --task <TASK_ID> --reject

    # just tail an existing task
    python scripts/trigger_task.py tail --task <TASK_ID>

Env: REDIS_URL (default redis://localhost:6379). The Python worker (app.py)
must be running. Read results back via the Go API:
    GET /api/tasks            GET /api/tasks/:id
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid

# Make `src` importable when run from back/scripts.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.server.models import Op  # noqa: E402
from src.server.redis_client import make_redis_client  # noqa: E402
from src.server.utils import make_signal  # noqa: E402

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
TERMINAL = {"done", "failed", "cancelled"}


async def cmd_start(args: argparse.Namespace) -> None:
    redis = make_redis_client(REDIS_URL)
    task_id = args.task or str(uuid.uuid4())
    user_id = args.user or str(uuid.uuid4())
    chat_id = args.chat or str(uuid.uuid4())

    payload = {
        "user_id": user_id,
        "chat_id": chat_id,
        "goal": args.goal,
        "task_id": task_id,
        "agent_type": "nomi",
    }
    if args.model:
        payload["model"] = args.model

    frame = make_signal(0, Op.TASK_START, chat_id, payload)
    await redis.publish(f"chat:request:{chat_id}", json.dumps(frame.marshal()))

    print("Published TASK_START")
    print(f"  task_id = {task_id}")
    print(f"  user_id = {user_id}")
    print(f"  chat_id = {chat_id}")
    print(f"  goal    = {args.goal}")
    print()
    print("Read back via the Go API (auth as this user):")
    print(f"  GET /api/tasks/{task_id}")

    if args.tail:
        print("\n--- tailing events (Ctrl-C to stop) ---")
        await _tail(redis, task_id)
    else:
        await redis.aclose()


async def cmd_steer(args: argparse.Namespace) -> None:
    redis = make_redis_client(REDIS_URL)
    await redis.rpush(
        f"agent:task:steer:{args.task}", json.dumps({"message": args.message})
    )
    print(f"Queued steering for task {args.task}: {args.message}")
    await redis.aclose()


async def cmd_approve(args: argparse.Namespace) -> None:
    redis = make_redis_client(REDIS_URL)
    decision = {"approved": not args.reject}
    if args.request_id:
        decision["request_id"] = args.request_id
    await redis.rpush(f"agent:task:approval:{args.task}", json.dumps(decision))
    print(
        f"Submitted {'REJECT' if args.reject else 'APPROVE'} for task {args.task}"
    )
    await redis.aclose()


async def cmd_tail(args: argparse.Namespace) -> None:
    redis = make_redis_client(REDIS_URL)
    print(f"--- tailing task {args.task} (Ctrl-C to stop) ---")
    await _tail(redis, args.task)


async def _tail(redis, task_id: str) -> None:
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"agent:task:event:{task_id}")
    try:
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            data = message.get("data")
            if isinstance(data, bytes):
                data = data.decode("utf-8", errors="replace")
            try:
                msg = json.loads(data)
            except (json.JSONDecodeError, TypeError):
                continue
            evt = msg.get("event") or {}
            line = f"[{msg.get('status'):<13}]"
            if evt:
                line += f" {evt.get('kind')}: {json.dumps(evt.get('payload', {}))}"
            print(line)
            if msg.get("finished"):
                print("--- task finished ---")
                break
    finally:
        await pubsub.aclose()
        await redis.aclose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_start = sub.add_parser("start", help="publish a TASK_START frame")
    p_start.add_argument("--goal", required=True)
    p_start.add_argument("--user", help="user_id (uuid); random if omitted")
    p_start.add_argument("--chat", help="chat_id (uuid); random if omitted")
    p_start.add_argument("--task", help="task_id (uuid); random if omitted")
    p_start.add_argument("--model", help="model name (optional)")
    p_start.add_argument("--tail", action="store_true", help="follow events")
    p_start.set_defaults(func=cmd_start)

    p_steer = sub.add_parser("steer", help="send a steering message")
    p_steer.add_argument("--task", required=True)
    p_steer.add_argument("--message", required=True)
    p_steer.set_defaults(func=cmd_steer)

    p_appr = sub.add_parser("approve", help="approve/reject a pending gate")
    p_appr.add_argument("--task", required=True)
    p_appr.add_argument("--request-id", dest="request_id")
    p_appr.add_argument("--reject", action="store_true")
    p_appr.set_defaults(func=cmd_approve)

    p_tail = sub.add_parser("tail", help="follow a task's event stream")
    p_tail.add_argument("--task", required=True)
    p_tail.set_defaults(func=cmd_tail)

    args = parser.parse_args()
    asyncio.run(args.func(args))


if __name__ == "__main__":
    main()

"""Hermes CLI wrapper — streams command output, queries agent state."""
import asyncio
import json
import subprocess
import sys
from typing import AsyncGenerator

HERMES_BIN = "hermes"


async def stream_hermes(args: list[str]) -> AsyncGenerator[dict, None]:
    """Run `hermes <args>` and yield stdout/stderr lines as events."""
    try:
        proc = await asyncio.create_subprocess_exec(
            HERMES_BIN, *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            yield {"type": "stdout", "data": line.decode().rstrip()}
        await proc.wait()
        yield {"type": "exit", "code": proc.returncode}
    except FileNotFoundError:
        yield {"type": "error", "data": f"{HERMES_BIN} not found on PATH"}
    except Exception as e:
        yield {"type": "error", "data": str(e)}


async def run_command(args: list[str]) -> dict:
    """Run a hermes command, capture output, return JSON-compatible result."""
    lines = []
    async for event in stream_hermes(args):
        if event["type"] == "stdout":
            lines.append(event["data"])
        elif event["type"] == "error":
            return {"ok": False, "error": event["data"]}
    return {"ok": True, "output": "\n".join(lines), "exit_code": 0}


async def get_hermes_version() -> dict:
    return await run_command(["--version"])


async def list_agents() -> dict:
    return await run_command(["agents", "list"])


async def get_sessions() -> dict:
    return await run_command(["sessions", "list"])
"""
Discovery of non-Hermes coding agents (Claude Code, Codex, OpenClaw).

Each tool keeps local session transcripts; the hub reads them the same way
it reads Hermes state — best-effort and strictly read-only. An agent is
"working" when its newest session file changed inside the activity window,
"idle" while it stays inside the idle window, and hidden after that.

The hub's own configuration is the one file this module writes, and it
lives outside every tool's state directory.
"""
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

SETTINGS_PATH = Path(
    os.environ.get(
        "HUB_SETTINGS",
        Path.home() / ".config" / "hermes-agent-hub" / "settings.json",
    )
).expanduser()

DEFAULT_SETTINGS: dict = {
    "external_activity_seconds": 120,
    "external_idle_hours": 6,
    "external_max_per_source": 3,
    "sources": {
        "claude": {"enabled": True, "home": str(Path.home() / ".claude"), "label": "Claude Code"},
        "codex": {"enabled": True, "home": str(Path.home() / ".codex"), "label": "Codex"},
        "openclaw": {"enabled": True, "home": str(Path.home() / ".openclaw"), "label": "OpenClaw"},
    },
}

_SOURCE_META = {
    "claude": {"role": "Claude Code", "specialty": "Interactive coding sessions", "hue": 0},
    "codex": {"role": "Codex", "specialty": "OpenAI coding sessions", "hue": 1},
    "openclaw": {"role": "OpenClaw", "specialty": "Personal agent sessions", "hue": 2},
}


def load_settings() -> dict:
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    try:
        saved = json.loads(SETTINGS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return settings
    return _merge_settings(settings, saved)


def _merge_settings(settings: dict, patch: dict) -> dict:
    """Fold a saved/submitted patch into settings, keeping only known keys."""
    for key in ("external_activity_seconds", "external_idle_hours", "external_max_per_source"):
        value = patch.get(key)
        if isinstance(value, (int, float)) and value > 0:
            settings[key] = int(value)
    sources = patch.get("sources")
    if isinstance(sources, dict):
        for name, source in settings["sources"].items():
            update = sources.get(name)
            if not isinstance(update, dict):
                continue
            if isinstance(update.get("enabled"), bool):
                source["enabled"] = update["enabled"]
            if isinstance(update.get("home"), str) and update["home"].strip():
                source["home"] = str(Path(update["home"].strip()).expanduser())
    return settings


def save_settings(patch: dict) -> dict:
    settings = _merge_settings(load_settings(), patch or {})
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2))
    return settings


def _iso(ts: Optional[float]) -> Optional[str]:
    if ts:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    return None


def _tail_text(path: Path, size: int = 65536) -> str:
    try:
        with path.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            length = handle.tell()
            handle.seek(max(0, length - size))
            return handle.read().decode(errors="replace")
    except OSError:
        return ""


_COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.DOTALL)
_COMMAND_NAME = re.compile(r"<command-name>(.*?)</command-name>", re.DOTALL)


def _human_prompt(text: str) -> str:
    """The human-readable part of a prompt, unwrapping slash-command records."""
    if text.startswith("<command-name>"):
        args = _COMMAND_ARGS.search(text)
        if args and args.group(1).strip():
            return args.group(1).strip()
        name = _COMMAND_NAME.search(text)
        return name.group(1).strip() if name else ""
    return "" if text.startswith("<") else text


def _last_user_text(path: Path) -> str:
    """Best-effort: the newest human message in a JSONL transcript."""
    for line in reversed(_tail_text(path, 4 * 1024 * 1024).splitlines()):
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if record.get("isMeta"):  # hook output and other injected system records
            continue
        message = record.get("message") if isinstance(record.get("message"), dict) else record
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        candidate = message if message.get("role") == "user" else payload if payload.get("role") == "user" else None
        if not candidate:
            continue
        content = candidate.get("content")
        texts = [content] if isinstance(content, str) else [
            part.get("text") or part.get("input_text") or ""
            for part in content if isinstance(part, dict)
        ] if isinstance(content, list) else []
        for text in texts:
            # Skip tool results and harness wrappers; keep real human prompts.
            prompt = _human_prompt(text.strip()) if isinstance(text, str) else ""
            if prompt:
                return prompt
    return ""


def _head_text(path: Path, size: int = 16384) -> str:
    try:
        with path.open("rb") as handle:
            return handle.read(size).decode(errors="replace")
    except OSError:
        return ""


def _project_from_file(path: Path) -> str:
    """The working directory the session was launched in, from the file head."""
    for line in _head_text(path).splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        cwd = record.get("cwd") or payload.get("cwd")
        if isinstance(cwd, str) and cwd:
            return Path(cwd).name
    return ""


def _session_files(source: str, home: Path) -> list[Path]:
    if source == "claude":
        return list(home.glob("projects/*/*.jsonl"))
    if source == "codex":
        return list(home.glob("sessions/*/*/*/rollout-*.jsonl"))
    # OpenClaw keeps per-agent transcripts; accept both known layouts.
    return list(home.glob("agents/*/sessions/*.jsonl")) + list(home.glob("sessions/*.jsonl"))


def source_counts(settings: Optional[dict] = None) -> dict[str, int]:
    """How many session transcripts each source directory currently holds."""
    settings = settings or load_settings()
    counts: dict[str, int] = {}
    for name, source in settings["sources"].items():
        home = Path(source["home"]).expanduser()
        counts[name] = len(_session_files(name, home)) if home.exists() else 0
    return counts


def read_external_agents(settings: Optional[dict] = None) -> list[dict]:
    settings = settings or load_settings()
    now = time.time()
    activity_window = settings["external_activity_seconds"]
    idle_cutoff = now - settings["external_idle_hours"] * 3600
    max_per_source = settings["external_max_per_source"]

    agents: list[dict] = []
    for name, source in settings["sources"].items():
        if not source.get("enabled"):
            continue
        home = Path(source["home"]).expanduser()
        if not home.exists():
            continue
        files = []
        for path in _session_files(name, home):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if mtime >= idle_cutoff:
                files.append((mtime, path))
        files.sort(reverse=True)

        # One agent per project/workspace, newest session wins. Claude keeps
        # one directory per project, so that directory is the natural key.
        seen_projects: set[str] = set()
        label = source.get("label") or _SOURCE_META[name]["role"]
        for mtime, path in files:
            project = _project_from_file(path) or path.parent.name
            dedupe_key = path.parent.name if name == "claude" else project
            if dedupe_key in seen_projects:
                continue
            seen_projects.add(dedupe_key)
            working = now - mtime <= activity_window
            task = _last_user_text(path)
            agents.append({
                "id": f"{name}-{project.lower()}",
                "name": f"{label} · {project}" if project else label,
                "role": _SOURCE_META[name]["role"],
                "specialty": _SOURCE_META[name]["specialty"],
                "home": "coding",
                "source": name,
                "status": "working" if working else "idle",
                "status_reason": "session_active" if working else "available",
                "current_task": task[:160] or (f"Session in {project}" if project else "Local session"),
                "started_at": None,
                "last_activity_at": _iso(mtime),
                "task_id": None,
                "run_id": None,
                "progress_value": None,
                "progress_label": "Live session" if working else None,
                "progress_mode": "activity" if working else None,
                "position": {"top": 10, "left": 10},
            })
            if len(seen_projects) >= max_per_source:
                break
    return agents

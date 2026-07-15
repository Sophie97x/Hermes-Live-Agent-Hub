# Hermes Agent Hub

A lightweight live office dashboard for a local Hermes Agent installation. It discovers the current agent roster, reads local task and session state, and places agents in animated office departments based on what they are doing.

## Features

- Live agent office with seven departments and lightweight 2D animation
- Automatic discovery of new Hermes profiles
- Break Room routing for idle agents
- Clickable agent profiles and task details
- Backlog, in-progress, review, completed and archive columns
- Persistent minimized Task Board columns
- Midnight, Daylight and Botanical office themes
- Full-screen office view
- Server-sent live updates with low-frequency background polling

## Run locally

Requirements: Python 3.11+ and Node.js 18+.

```bash
cd frontend
npm install
npm run build

cd ../backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 3001
```

Open <http://localhost:3001>.

The backend reads Hermes state from `~/.hermes` by default. Override locations when needed:

```bash
HERMES_HOME=/path/to/.hermes \
OBSIDIAN_PROJECTS=/path/to/obsidian/projects \
python -m uvicorn main:app --host 127.0.0.1 --port 3001
```

No API keys are required by this dashboard. It reads local Hermes SQLite and JSON files in read-only mode.

## Architecture

- `backend/`: FastAPI, SQLite/JSON readers and server-sent events
- `frontend/`: React and Vite UI
- Production frontend assets are built into `frontend/dist` and served by FastAPI

The UI intentionally avoids WebGL, physics engines and large component frameworks to keep CPU and memory use low.

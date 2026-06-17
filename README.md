# Momentum FastAPI Stage 1

This version keeps things simple:

- No real login yet
- All tasks are global
- FastAPI stores tasks in SQLite
- The frontend uses `fetch()` instead of `localStorage`

## Run

```bash
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --reload
```

If you already installed the dependencies globally, this also works:

```bash
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Then open:

```text
http://127.0.0.1:8000
```

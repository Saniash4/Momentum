from __future__ import annotations

import sqlite3
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "momentum.db"
STATIC_DIR = BASE_DIR / "frontend"

Status = Literal["todo", "progress", "done"]


app = FastAPI(title="Momentum API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    desc: str = ""


class TaskUpdate(BaseModel):
    title: str = Field(min_length=1)
    desc: str = ""


class TaskMove(BaseModel):
    status: Status
    orderedIds: list[str]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_ms() -> int:
    return int(time.time() * 1000)


def init_db() -> None:
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                desc TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'todo',
                position INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                previous_status TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER
            )
            """
        )


def row_to_task(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "desc": row["desc"],
        "status": row["status"],
        "position": row["position"],
        "isDeleted": bool(row["is_deleted"]),
        "previousStatus": row["previous_status"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "deletedAt": row["deleted_at"],
    }


def get_task_or_404(task_id: str) -> sqlite3.Row:
    with connect() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return task


def next_position(status: Status) -> int:
    with connect() as conn:
        result = conn.execute(
            """
            SELECT COALESCE(MAX(position), -1) + 1 AS next_position
            FROM tasks
            WHERE status = ? AND is_deleted = 0
            """,
            (status,),
        ).fetchone()

    return int(result["next_position"])


def reorder_status(status: Status, ordered_ids: list[str]) -> None:
    with connect() as conn:
        existing_rows = conn.execute(
            """
            SELECT id
            FROM tasks
            WHERE status = ? AND is_deleted = 0
            ORDER BY position, created_at
            """,
            (status,),
        ).fetchall()

        existing_ids = [row["id"] for row in existing_rows]
        final_ids = [task_id for task_id in ordered_ids if task_id in existing_ids]
        final_ids.extend(task_id for task_id in existing_ids if task_id not in final_ids)

        for index, task_id in enumerate(final_ids):
            conn.execute(
                "UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?",
                (index, now_ms(), task_id),
            )


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/tasks")
def list_tasks() -> dict:
    init_db()

    grouped_tasks = {
        "todo": [],
        "progress": [],
        "done": [],
        "trash": [],
    }

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM tasks
            ORDER BY is_deleted, position, created_at
            """
        ).fetchall()

    for row in rows:
        task = row_to_task(row)

        if task["isDeleted"]:
            grouped_tasks["trash"].append(task)
        else:
            grouped_tasks[task["status"]].append(task)

    grouped_tasks["trash"].sort(key=lambda task: task["deletedAt"] or 0, reverse=True)
    return grouped_tasks


@app.post("/api/tasks", status_code=201)
def create_task(payload: TaskCreate) -> dict:
    task_id = str(uuid.uuid4())
    created_at = now_ms()

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO tasks (
                id, title, desc, status, position, is_deleted,
                previous_status, created_at, updated_at, deleted_at
            )
            VALUES (?, ?, ?, 'todo', ?, 0, NULL, ?, ?, NULL)
            """,
            (
                task_id,
                payload.title.strip(),
                payload.desc.strip(),
                next_position("todo"),
                created_at,
                created_at,
            ),
        )

    return row_to_task(get_task_or_404(task_id))


@app.patch("/api/tasks/{task_id}")
def update_task(task_id: str, payload: TaskUpdate) -> dict:
    get_task_or_404(task_id)

    with connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET title = ?, desc = ?, updated_at = ?
            WHERE id = ? AND is_deleted = 0
            """,
            (payload.title.strip(), payload.desc.strip(), now_ms(), task_id),
        )

    return row_to_task(get_task_or_404(task_id))


@app.patch("/api/tasks/{task_id}/move")
def move_task(task_id: str, payload: TaskMove) -> dict:
    task = get_task_or_404(task_id)

    if task["is_deleted"]:
        raise HTTPException(status_code=400, detail="Deleted tasks cannot be moved")

    with connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET status = ?, position = ?, updated_at = ?
            WHERE id = ?
            """,
            (payload.status, next_position(payload.status), now_ms(), task_id),
        )

    reorder_status(payload.status, payload.orderedIds)
    return list_tasks()


@app.delete("/api/tasks/{task_id}")
def move_task_to_trash(task_id: str) -> dict:
    task = get_task_or_404(task_id)

    if task["is_deleted"]:
        return row_to_task(task)

    with connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET is_deleted = 1,
                previous_status = status,
                deleted_at = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (now_ms(), now_ms(), task_id),
        )

    return row_to_task(get_task_or_404(task_id))


@app.post("/api/tasks/{task_id}/restore")
def restore_task(task_id: str) -> dict:
    task = get_task_or_404(task_id)

    if not task["is_deleted"]:
        return row_to_task(task)

    restore_status = task["previous_status"] or "todo"

    with connect() as conn:
        conn.execute(
            """
            UPDATE tasks
            SET is_deleted = 0,
                status = ?,
                position = ?,
                previous_status = NULL,
                deleted_at = NULL,
                updated_at = ?
            WHERE id = ?
            """,
            (restore_status, next_position(restore_status), now_ms(), task_id),
        )

    return row_to_task(get_task_or_404(task_id))


@app.delete("/api/tasks/{task_id}/forever", status_code=204)
def delete_task_forever(task_id: str) -> None:
    get_task_or_404(task_id)

    with connect() as conn:
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")

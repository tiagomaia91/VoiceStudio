"""Maia Voice: metadados da Biblioteca de Vozes.

Complementa os perfis de voz (``/profiles``) com informações de organização
usadas pela página Biblioteca, no estilo da Voice Library do ElevenLabs:

    GET    /maia/library            -> metadados de todas as vozes
    PUT    /maia/library/{id}       -> cria ou atualiza os metadados de uma voz
    DELETE /maia/library/{id}       -> remove os metadados de uma voz

Campos: categoria (uso da voz), cliente, tags, favorita e notas.
Os dados ficam numa tabela própria do SQLite do app, criada sob demanda,
sem alterar o esquema existente dos perfis.
"""
from __future__ import annotations

import json
import time
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.db import db_conn

router = APIRouter()

CATEGORIES = (
    "anuncio",
    "narracao",
    "atendimento",
    "personagem",
    "institucional",
    "social",
    "outro",
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS maia_voice_library (
    profile_id TEXT PRIMARY KEY,
    category   TEXT NOT NULL DEFAULT '',
    client     TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    favorite   INTEGER NOT NULL DEFAULT 0,
    notes      TEXT NOT NULL DEFAULT '',
    updated_at REAL NOT NULL
)
"""


class LibraryMeta(BaseModel):
    category: str = Field(default="", max_length=40)
    client: str = Field(default="", max_length=120)
    tags: List[str] = Field(default_factory=list, max_length=20)
    favorite: bool = False
    notes: str = Field(default="", max_length=2000)


class LibraryMetaOut(LibraryMeta):
    profile_id: str
    updated_at: Optional[float] = None


def _clean_tags(tags: List[str]) -> List[str]:
    seen: list[str] = []
    for tag in tags:
        value = " ".join(str(tag).split())[:40].strip().lower()
        if value and value not in seen:
            seen.append(value)
    return seen


def _row_to_out(row) -> LibraryMetaOut:
    try:
        tags = json.loads(row["tags"] or "[]")
        if not isinstance(tags, list):
            tags = []
    except (TypeError, ValueError):
        tags = []
    return LibraryMetaOut(
        profile_id=row["profile_id"],
        category=row["category"] or "",
        client=row["client"] or "",
        tags=[str(t) for t in tags],
        favorite=bool(row["favorite"]),
        notes=row["notes"] or "",
        updated_at=row["updated_at"],
    )


@router.get("/maia/library")
def list_library_meta() -> dict:
    with db_conn() as conn:
        conn.execute(_SCHEMA)
        rows = conn.execute("SELECT * FROM maia_voice_library").fetchall()
    items = [_row_to_out(row).model_dump() for row in rows]
    return {"categories": list(CATEGORIES), "items": items}


@router.put("/maia/library/{profile_id}")
def upsert_library_meta(profile_id: str, body: LibraryMeta) -> dict:
    profile_id = profile_id.strip()
    if not profile_id or len(profile_id) > 128:
        raise HTTPException(status_code=400, detail="profile_id inválido")
    category = body.category.strip().lower()
    if category and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="categoria inválida")
    tags = _clean_tags(body.tags)
    now = time.time()
    with db_conn() as conn:
        conn.execute(_SCHEMA)
        exists = conn.execute(
            "SELECT 1 FROM voice_profiles WHERE id = ?", (profile_id,)
        ).fetchone() if _has_profiles_table(conn) else True
        if not exists:
            raise HTTPException(status_code=404, detail="voz não encontrada")
        conn.execute(
            """
            INSERT INTO maia_voice_library
                (profile_id, category, client, tags, favorite, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(profile_id) DO UPDATE SET
                category = excluded.category,
                client = excluded.client,
                tags = excluded.tags,
                favorite = excluded.favorite,
                notes = excluded.notes,
                updated_at = excluded.updated_at
            """,
            (
                profile_id,
                category,
                body.client.strip(),
                json.dumps(tags, ensure_ascii=False),
                1 if body.favorite else 0,
                body.notes.strip(),
                now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM maia_voice_library WHERE profile_id = ?", (profile_id,)
        ).fetchone()
    return _row_to_out(row).model_dump()


@router.delete("/maia/library/{profile_id}")
def delete_library_meta(profile_id: str) -> dict:
    with db_conn() as conn:
        conn.execute(_SCHEMA)
        conn.execute("DELETE FROM maia_voice_library WHERE profile_id = ?", (profile_id,))
    return {"success": True}


def _has_profiles_table(conn) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='voice_profiles'"
    ).fetchone()
    return row is not None

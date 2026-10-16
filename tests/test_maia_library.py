"""Maia Voice: Biblioteca de Vozes (/maia/library)."""
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import maia_library
from core.db import db_conn


@pytest.fixture()
def client():
    from core.db import init_db

    init_db()
    app = FastAPI()
    app.include_router(maia_library.router)
    return TestClient(app)


def _make_profile() -> str:
    profile_id = "maia-" + uuid.uuid4().hex[:8]
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO voice_profiles (id, name) VALUES (?, ?)",
            (profile_id, "Voz teste"),
        )
    return profile_id


def test_upsert_list_and_delete(client):
    profile_id = _make_profile()
    body = {
        "category": "anuncio",
        "client": "  Nex Tech ",
        "tags": ["Grave", "grave", " varejo  promo "],
        "favorite": True,
        "notes": "Tom confiante",
    }
    saved = client.put(f"/maia/library/{profile_id}", json=body)
    assert saved.status_code == 200, saved.text
    data = saved.json()
    assert data["client"] == "Nex Tech"
    assert data["tags"] == ["grave", "varejo promo"]
    assert data["favorite"] is True

    listed = client.get("/maia/library").json()
    assert "anuncio" in listed["categories"]
    item = next(i for i in listed["items"] if i["profile_id"] == profile_id)
    assert item["notes"] == "Tom confiante"

    client.put(f"/maia/library/{profile_id}", json={**body, "favorite": False})
    item = next(
        i for i in client.get("/maia/library").json()["items"] if i["profile_id"] == profile_id
    )
    assert item["favorite"] is False

    assert client.delete(f"/maia/library/{profile_id}").status_code == 200
    ids = [i["profile_id"] for i in client.get("/maia/library").json()["items"]]
    assert profile_id not in ids


def test_rejects_unknown_category_and_profile(client):
    profile_id = _make_profile()
    bad = client.put(f"/maia/library/{profile_id}", json={"category": "hack"})
    assert bad.status_code == 400
    missing = client.put("/maia/library/nao-existe", json={"category": "narracao"})
    assert missing.status_code == 404

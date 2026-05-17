import os
import json
from pathlib import Path
import models

DATABASE_URL = os.getenv("DATABASE_URL")

# ── Database backend ──────────────────────────────────────────────────────────

if DATABASE_URL:
    import psycopg2
    import psycopg2.extras

    P = "%s"

    def _binary(b):
        return psycopg2.Binary(b)

    def get_conn():
        url = DATABASE_URL
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        if "sslmode" not in url:
            url += ("&" if "?" in url else "?") + "sslmode=require"
        conn = psycopg2.connect(url)
        conn.autocommit = False
        return conn

    def _rows(cur):
        if cur.description is None:
            return []
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def _row(cur):
        if cur.description is None:
            return None
        cols = [d[0] for d in cur.description]
        row = cur.fetchone()
        return dict(zip(cols, row)) if row else None

else:
    import sqlite3

    P = "?"

    def _binary(b):
        return sqlite3.Binary(b)

    DB_PATH = Path(__file__).parent / "resumes.db"

    def get_conn():
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _rows(cur):
        return [dict(r) for r in cur.fetchall()]

    def _row(cur):
        row = cur.fetchone()
        return dict(row) if row else None


# ── Init ──────────────────────────────────────────────────────────────────────

def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(models.RESUMES_TABLE)
    cur.execute(models.CONTACTS_TABLE)
    for stmt in models.INDEX_STATEMENTS:
        try:
            cur.execute(stmt)
        except Exception:
            pass
    conn.commit()
    conn.close()
    print("Database initialized.")


# ── Resumes ───────────────────────────────────────────────────────────────────

def insert_resume(original_filename: str, pdf_bytes: bytes) -> int:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO resumes (original_filename, file_data) VALUES ({P}, {P}) RETURNING id"
        if DATABASE_URL else
        f"INSERT INTO resumes (original_filename, file_data) VALUES ({P}, {P})",
        (original_filename, _binary(pdf_bytes)),
    )
    if DATABASE_URL:
        row_id = cur.fetchone()[0]
    else:
        row_id = cur.lastrowid
    conn.commit()
    conn.close()
    return row_id


def update_resume_status(resume_id: int, status: str, raw_text: str = None, error_message: str = None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE resumes SET status={P}, raw_text={P}, error_message={P} WHERE id={P}",
        (status, raw_text, error_message, resume_id),
    )
    conn.commit()
    conn.close()


def get_pdf_bytes(resume_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"SELECT file_data FROM resumes WHERE id={P}", (resume_id,))
    row = cur.fetchone()
    conn.close()
    if row is None or row[0] is None:
        return None
    return bytes(row[0])


def get_resume_by_id(resume_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"SELECT id, original_filename, upload_date, status, error_message FROM resumes WHERE id={P}", (resume_id,))
    result = _row(cur)
    conn.close()
    return result


def delete_resume(resume_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM resumes WHERE id={P}", (resume_id,))
    conn.commit()
    conn.close()


# ── Contacts ──────────────────────────────────────────────────────────────────

def insert_contact(resume_id: int, fields: dict):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""INSERT INTO contacts
            (resume_id, name, email, phone, linkedin, location,
             job_title, company, skills, other_details)
            VALUES ({P},{P},{P},{P},{P},{P},{P},{P},{P},{P})""",
        (
            resume_id,
            fields.get("name"),
            fields.get("email"),
            fields.get("phone"),
            fields.get("linkedin"),
            fields.get("location"),
            fields.get("job_title"),
            fields.get("company"),
            fields.get("skills"),
            fields.get("other_details"),
        ),
    )
    conn.commit()
    conn.close()


def get_all_contacts() -> list:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                  c.location, c.job_title, c.company, c.skills, c.other_details,
                  c.extracted_at,
                  r.original_filename, r.upload_date, r.status
           FROM contacts c
           JOIN resumes r ON c.resume_id = r.id
           ORDER BY c.extracted_at DESC"""
    )
    rows = _rows(cur)
    conn.close()
    result = []
    for d in rows:
        try:
            d["skills"] = json.loads(d["skills"]) if d["skills"] else []
        except (json.JSONDecodeError, TypeError):
            d["skills"] = []
        # Convert datetime objects to strings for JSON serialisation
        for key in ("extracted_at", "upload_date"):
            if d.get(key) and not isinstance(d[key], str):
                d[key] = str(d[key])
        result.append(d)
    return result


def get_processing_status() -> dict:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT
               COALESCE(SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END),0) AS pending,
               COALESCE(SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END),0) AS processing,
               COALESCE(SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END),0) AS done,
               COALESCE(SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END),0) AS failed,
               COUNT(*) AS total
           FROM resumes"""
    )
    row = _row(cur)
    conn.close()
    return row or {"pending": 0, "processing": 0, "done": 0, "failed": 0, "total": 0}


def get_failed_resumes() -> list:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, original_filename, upload_date, error_message FROM resumes WHERE status='failed' ORDER BY upload_date DESC"
    )
    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("upload_date") and not isinstance(r["upload_date"], str):
            r["upload_date"] = str(r["upload_date"])
    return rows

import os

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    # PostgreSQL schema
    RESUMES_TABLE = """
    CREATE TABLE IF NOT EXISTS resumes (
        id                SERIAL PRIMARY KEY,
        original_filename TEXT NOT NULL,
        file_data         BYTEA,
        upload_date       TIMESTAMP DEFAULT NOW(),
        status            TEXT NOT NULL DEFAULT 'pending',
        raw_text          TEXT,
        error_message     TEXT
    );
    """
    CONTACTS_TABLE = """
    CREATE TABLE IF NOT EXISTS contacts (
        id            SERIAL PRIMARY KEY,
        resume_id     INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        name          TEXT,
        email         TEXT,
        phone         TEXT,
        linkedin      TEXT,
        location      TEXT,
        job_title     TEXT,
        company       TEXT,
        skills        TEXT,
        other_details TEXT,
        extracted_at  TIMESTAMP DEFAULT NOW()
    );
    """
else:
    # SQLite schema
    RESUMES_TABLE = """
    CREATE TABLE IF NOT EXISTS resumes (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        original_filename TEXT NOT NULL,
        file_data         BLOB,
        upload_date       DATETIME DEFAULT (datetime('now', 'localtime')),
        status            TEXT NOT NULL DEFAULT 'pending',
        raw_text          TEXT,
        error_message     TEXT
    );
    """
    CONTACTS_TABLE = """
    CREATE TABLE IF NOT EXISTS contacts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        resume_id     INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        name          TEXT,
        email         TEXT,
        phone         TEXT,
        linkedin      TEXT,
        location      TEXT,
        job_title     TEXT,
        company       TEXT,
        skills        TEXT,
        other_details TEXT,
        extracted_at  DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    """

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_contacts_resume_id ON contacts(resume_id);",
    "CREATE INDEX IF NOT EXISTS idx_resumes_status ON resumes(status);",
    "CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);",
]

import os

DATABASE_URL = os.getenv("DATABASE_URL")

if DATABASE_URL:
    USERS_TABLE = """
    CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'customer'
                      CHECK (role IN ('superadmin', 'reseller', 'customer')),
        created_at    TIMESTAMP DEFAULT NOW()
    );
    """
    RESUMES_TABLE = """
    CREATE TABLE IF NOT EXISTS resumes (
        id                SERIAL PRIMARY KEY,
        original_filename TEXT NOT NULL,
        file_data         BYTEA,
        upload_date       TIMESTAMP DEFAULT NOW(),
        status            TEXT NOT NULL DEFAULT 'pending',
        raw_text          TEXT,
        error_message     TEXT,
        user_id           INTEGER REFERENCES users(id)
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
    USERS_TABLE = """
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE,
        email         TEXT,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'customer'
                      CHECK (role IN ('superadmin', 'reseller', 'customer')),
        created_at    DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    """
    RESUMES_TABLE = """
    CREATE TABLE IF NOT EXISTS resumes (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        original_filename TEXT NOT NULL,
        file_data         BLOB,
        upload_date       DATETIME DEFAULT (datetime('now', 'localtime')),
        status            TEXT NOT NULL DEFAULT 'pending',
        raw_text          TEXT,
        error_message     TEXT,
        user_id           INTEGER REFERENCES users(id)
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
    "CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);",
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);",
]

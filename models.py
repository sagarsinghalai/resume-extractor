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
        reseller_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        phone         TEXT,
        membership_type TEXT,
        amount_paid   REAL,
        date_of_expiry TEXT,
        created_at    TIMESTAMP DEFAULT NOW()
    );
    """
    PROJECTS_TABLE = """
    CREATE TABLE IF NOT EXISTS projects (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMP DEFAULT NOW()
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
        user_id           INTEGER REFERENCES users(id),
        project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL
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
    LEADS_TABLE = """
    CREATE TABLE IF NOT EXISTS leads (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL,
        phone      TEXT,
        profession TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );
    """
    PAYMENT_HISTORY_TABLE = """
    CREATE TABLE IF NOT EXISTS payment_history (
        id             SERIAL PRIMARY KEY,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        membership_type TEXT,
        amount         REAL,
        payment_date   TEXT,
        notes          TEXT
    );
    """
    SITE_SETTINGS_TABLE = """
    CREATE TABLE IF NOT EXISTS site_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    """
    PASSWORD_RESET_TOKENS_TABLE = """
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
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
        reseller_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        phone         TEXT,
        membership_type TEXT,
        amount_paid   REAL,
        date_of_expiry TEXT,
        created_at    DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    """
    PROJECTS_TABLE = """
    CREATE TABLE IF NOT EXISTS projects (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        description TEXT,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at  DATETIME DEFAULT (datetime('now', 'localtime'))
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
        user_id           INTEGER REFERENCES users(id),
        project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL
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
    LEADS_TABLE = """
    CREATE TABLE IF NOT EXISTS leads (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        email      TEXT NOT NULL,
        phone      TEXT,
        profession TEXT,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
    );
    """
    PAYMENT_HISTORY_TABLE = """
    CREATE TABLE IF NOT EXISTS payment_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        membership_type TEXT,
        amount          REAL,
        payment_date    TEXT,
        notes           TEXT
    );
    """
    SITE_SETTINGS_TABLE = """
    CREATE TABLE IF NOT EXISTS site_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    );
    """
    PASSWORD_RESET_TOKENS_TABLE = """
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL
    );
    """

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_contacts_resume_id ON contacts(resume_id);",
    "CREATE INDEX IF NOT EXISTS idx_resumes_status ON resumes(status);",
    "CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);",
    "CREATE INDEX IF NOT EXISTS idx_resumes_user_id ON resumes(user_id);",
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);",
    "CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);",
    "CREATE INDEX IF NOT EXISTS idx_resumes_project_id ON resumes(project_id);",
]

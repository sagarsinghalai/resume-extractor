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

    # Order matters: users → projects → resumes → contacts (FK chain)
    cur.execute(models.USERS_TABLE)
    cur.execute(models.PROJECTS_TABLE)
    cur.execute(models.RESUMES_TABLE)
    cur.execute(models.CONTACTS_TABLE)
    cur.execute(models.LEADS_TABLE)
    cur.execute(models.PAYMENT_HISTORY_TABLE)
    cur.execute(models.SITE_SETTINGS_TABLE)
    cur.execute(models.PASSWORD_RESET_TOKENS_TABLE)

    # Migrations: add columns that may not exist on older databases
    if DATABASE_URL:
        cur.execute("ALTER TABLE resumes ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);")
        cur.execute("ALTER TABLE resumes ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS reseller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS membership_type TEXT;")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS amount_paid REAL;")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_expiry TEXT;")
    else:
        for col_sql in [
            "ALTER TABLE resumes ADD COLUMN user_id INTEGER REFERENCES users(id);",
            "ALTER TABLE resumes ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;",
            "ALTER TABLE users ADD COLUMN reseller_id INTEGER REFERENCES users(id) ON DELETE SET NULL;",
            "ALTER TABLE users ADD COLUMN phone TEXT;",
            "ALTER TABLE users ADD COLUMN membership_type TEXT;",
            "ALTER TABLE users ADD COLUMN amount_paid REAL;",
            "ALTER TABLE users ADD COLUMN date_of_expiry TEXT;",
        ]:
            try:
                cur.execute(col_sql)
            except Exception:
                pass  # column already exists

    for stmt in models.INDEX_STATEMENTS:
        try:
            cur.execute(stmt)
        except Exception:
            pass

    conn.commit()

    # Seed site settings defaults
    _seed_site_settings(conn)
    _seed_superadmin(conn)
    conn.close()
    print("Database initialized.")


def _seed_site_settings(conn):
    cur = conn.cursor()
    for key, default_val in [
        ("hubspot_form_code", ""),
        ("contact_us_content", "<p>Contact us at support@example.com</p>"),
        ("razorpay_url_monthly",  ""),
        ("razorpay_url_annual",   ""),
        ("razorpay_url_lifetime", ""),
    ]:
        cur.execute(f"SELECT key FROM site_settings WHERE key={P}", (key,))
        if _row(cur) is None:
            cur.execute(
                f"INSERT INTO site_settings (key, value) VALUES ({P},{P})",
                (key, default_val),
            )
    conn.commit()


def _seed_superadmin(conn):
    from werkzeug.security import generate_password_hash
    cur = conn.cursor()
    cur.execute(f"SELECT id FROM users WHERE username = {P}", ("admin",))
    if _row(cur) is None:
        cur.execute(
            f"INSERT INTO users (username, email, password_hash, role) VALUES ({P},{P},{P},{P})",
            ("admin", "admin@localhost", generate_password_hash("Admin@123"), "superadmin"),
        )
        conn.commit()
        print("Default superadmin created — username: admin  password: Admin@123")


# ── User CRUD ─────────────────────────────────────────────────────────────────

def create_user(username: str, email: str, password: str, role: str,
                reseller_id: int = None, phone: str = None,
                membership_type: str = None, amount_paid: float = None,
                date_of_expiry: str = None):
    from werkzeug.security import generate_password_hash
    conn = get_conn()
    cur = conn.cursor()
    try:
        if DATABASE_URL:
            cur.execute(
                f"""INSERT INTO users
                    (username, email, password_hash, role, reseller_id,
                     phone, membership_type, amount_paid, date_of_expiry)
                    VALUES ({P},{P},{P},{P},{P},{P},{P},{P},{P}) RETURNING id""",
                (username, email or None, generate_password_hash(password), role,
                 reseller_id, phone or None, membership_type or None,
                 amount_paid, date_of_expiry or None),
            )
            new_id = cur.fetchone()[0]
        else:
            cur.execute(
                f"""INSERT INTO users
                    (username, email, password_hash, role, reseller_id,
                     phone, membership_type, amount_paid, date_of_expiry)
                    VALUES ({P},{P},{P},{P},{P},{P},{P},{P},{P})""",
                (username, email or None, generate_password_hash(password), role,
                 reseller_id, phone or None, membership_type or None,
                 amount_paid, date_of_expiry or None),
            )
            new_id = cur.lastrowid
        conn.commit()
        return {"id": new_id, "username": username, "role": role}
    except Exception:
        conn.rollback()
        return None
    finally:
        conn.close()


def update_user_role(user_id: int, role: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"UPDATE users SET role={P} WHERE id={P}", (role, user_id))
    conn.commit()
    conn.close()


def assign_customer_reseller(customer_id: int, reseller_id):
    """Set (or clear) the reseller that owns a customer account."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE users SET reseller_id={P} WHERE id={P}",
        (reseller_id if reseller_id else None, customer_id),
    )
    conn.commit()
    conn.close()


def get_customers_of_reseller(reseller_id: int) -> list:
    """Return all customer accounts assigned to a reseller."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""SELECT id, username, email, membership_type, amount_paid, date_of_expiry
            FROM users
            WHERE reseller_id={P} AND role='customer'
            ORDER BY username ASC""",
        (reseller_id,),
    )
    rows = _rows(cur)
    conn.close()
    return rows


def get_user_by_username(username: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"SELECT id, username, email, password_hash, role, created_at FROM users WHERE username={P}",
        (username,),
    )
    result = _row(cur)
    conn.close()
    return result


def get_user_by_email(email: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"SELECT id, username, email, role FROM users WHERE email={P}",
        (email,),
    )
    result = _row(cur)
    conn.close()
    return result


def get_user_by_id(user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""SELECT u.id, u.username, u.email, u.role, u.created_at,
                   u.phone, u.membership_type, u.amount_paid, u.date_of_expiry,
                   u.reseller_id, r.username AS reseller_username
            FROM users u
            LEFT JOIN users r ON u.reseller_id = r.id
            WHERE u.id = {P}""",
        (user_id,),
    )
    result = _row(cur)
    conn.close()
    return result


def get_all_users() -> list:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT u.id, u.username, u.email, u.role, u.reseller_id, u.created_at,
                  u.phone, u.membership_type, u.amount_paid, u.date_of_expiry,
                  r.username AS reseller_username
           FROM users u
           LEFT JOIN users r ON u.reseller_id = r.id
           ORDER BY u.created_at ASC"""
    )
    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("created_at") and not isinstance(r["created_at"], str):
            r["created_at"] = str(r["created_at"])
    return rows


def delete_user(user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM users WHERE id={P}", (user_id,))
    conn.commit()
    conn.close()


def update_user_password(user_id: int, new_password: str):
    from werkzeug.security import generate_password_hash
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"UPDATE users SET password_hash={P} WHERE id={P}",
        (generate_password_hash(new_password), user_id),
    )
    conn.commit()
    conn.close()


def update_user_profile(user_id: int, phone: str, membership_type: str,
                        amount_paid, date_of_expiry: str, email: str = None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""UPDATE users
            SET phone={P}, membership_type={P}, amount_paid={P}, date_of_expiry={P}, email={P}
            WHERE id={P}""",
        (phone or None, membership_type or None,
         float(amount_paid) if amount_paid not in (None, '') else None,
         date_of_expiry or None, email or None, user_id),
    )
    conn.commit()
    conn.close()


def update_user_full(user_id: int, username: str, email: str, phone: str,
                     role: str, reseller_id, membership_type: str,
                     amount_paid, date_of_expiry: str):
    """Update all editable fields for a user in one call."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""UPDATE users
            SET username={P}, email={P}, phone={P}, role={P}, reseller_id={P},
                membership_type={P}, amount_paid={P}, date_of_expiry={P}
            WHERE id={P}""",
        (username, email or None, phone or None, role,
         int(reseller_id) if reseller_id else None,
         membership_type or None,
         float(amount_paid) if amount_paid not in (None, '') else None,
         date_of_expiry or None, user_id),
    )
    conn.commit()
    conn.close()


# ── Leads ─────────────────────────────────────────────────────────────────────

def save_lead(name: str, email: str, phone: str, profession: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO leads (name, email, phone, profession) VALUES ({P},{P},{P},{P})",
        (name, email, phone or None, profession or None),
    )
    conn.commit()
    conn.close()


def get_all_leads() -> list:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, phone, profession, created_at FROM leads ORDER BY created_at DESC")
    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("created_at") and not isinstance(r["created_at"], str):
            r["created_at"] = str(r["created_at"])
    return rows


# ── Site Settings ─────────────────────────────────────────────────────────────

def get_site_setting(key: str) -> str:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"SELECT value FROM site_settings WHERE key={P}", (key,))
    row = _row(cur)
    conn.close()
    return row["value"] if row else ""


def set_site_setting(key: str, value: str):
    conn = get_conn()
    cur = conn.cursor()
    if DATABASE_URL:
        cur.execute(
            f"INSERT INTO site_settings (key, value) VALUES ({P},{P}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
            (key, value),
        )
    else:
        cur.execute(
            f"INSERT OR REPLACE INTO site_settings (key, value) VALUES ({P},{P})",
            (key, value),
        )
    conn.commit()
    conn.close()


# ── Password Reset Tokens ─────────────────────────────────────────────────────

def create_reset_token(user_id: int, token: str, expires_at: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ({P},{P},{P})",
        (token, user_id, expires_at),
    )
    conn.commit()
    conn.close()


def get_reset_token(token: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"SELECT token, user_id, expires_at FROM password_reset_tokens WHERE token={P}",
        (token,),
    )
    result = _row(cur)
    conn.close()
    return result


def delete_reset_token(token: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM password_reset_tokens WHERE token={P}", (token,))
    conn.commit()
    conn.close()


# ── Payment History ───────────────────────────────────────────────────────────

def get_all_payment_history(user_id: int) -> list:
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""SELECT id, user_id, membership_type, amount, payment_date, notes
            FROM payment_history WHERE user_id={P} ORDER BY id DESC""",
        (user_id,),
    )
    rows = _rows(cur)
    conn.close()
    return rows


def add_payment_history(user_id: int, membership_type: str, amount,
                        payment_date: str, notes: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"""INSERT INTO payment_history
            (user_id, membership_type, amount, payment_date, notes)
            VALUES ({P},{P},{P},{P},{P})""",
        (user_id, membership_type or None,
         float(amount) if amount not in (None, '') else None,
         payment_date or None, notes or None),
    )
    conn.commit()
    conn.close()


# ── Resumes ───────────────────────────────────────────────────────────────────

def insert_resume(original_filename: str, pdf_bytes: bytes, user_id: int = None, project_id: int = None) -> int:
    conn = get_conn()
    cur = conn.cursor()
    if DATABASE_URL:
        cur.execute(
            f"INSERT INTO resumes (original_filename, file_data, user_id, project_id) VALUES ({P},{P},{P},{P}) RETURNING id",
            (original_filename, _binary(pdf_bytes), user_id, project_id),
        )
        row_id = cur.fetchone()[0]
    else:
        cur.execute(
            f"INSERT INTO resumes (original_filename, file_data, user_id, project_id) VALUES ({P},{P},{P},{P})",
            (original_filename, _binary(pdf_bytes), user_id, project_id),
        )
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


def get_resume_by_id(resume_id: int, user_id: int = None, role: str = None):
    conn = get_conn()
    cur = conn.cursor()
    if role == "superadmin":
        cur.execute(
            f"SELECT id, original_filename, upload_date, status, error_message, user_id FROM resumes WHERE id={P}",
            (resume_id,),
        )
    else:
        cur.execute(
            f"SELECT id, original_filename, upload_date, status, error_message, user_id FROM resumes WHERE id={P} AND user_id={P}",
            (resume_id, user_id),
        )
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


def get_all_contacts(user_id: int = None, role: str = None) -> list:
    conn = get_conn()
    cur = conn.cursor()

    if role == "superadmin":
        cur.execute(
            """SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                      c.location, c.job_title, c.company, c.skills, c.other_details,
                      c.extracted_at,
                      r.original_filename, r.upload_date, r.status, r.project_id,
                      r.user_id          AS uploaded_by_user_id,
                      u.username         AS uploaded_by_username,
                      u.role             AS uploaded_by_role
               FROM contacts c
               JOIN resumes r ON c.resume_id = r.id
               LEFT JOIN users u ON r.user_id = u.id
               ORDER BY c.extracted_at DESC"""
        )
    elif role == "reseller":
        # Reseller sees own uploads + all their customers' uploads
        cur.execute(
            f"""SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                       c.location, c.job_title, c.company, c.skills, c.other_details,
                       c.extracted_at,
                       r.original_filename, r.upload_date, r.status, r.project_id,
                       r.user_id          AS uploaded_by_user_id,
                       u.username         AS uploaded_by_username,
                       u.role             AS uploaded_by_role
                FROM contacts c
                JOIN resumes r ON c.resume_id = r.id
                JOIN users u ON r.user_id = u.id
                WHERE r.user_id = {P}
                   OR r.user_id IN (SELECT id FROM users WHERE reseller_id = {P})
                ORDER BY c.extracted_at DESC""",
            (user_id, user_id),
        )
    else:
        # Customer — own data only
        cur.execute(
            f"""SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                       c.location, c.job_title, c.company, c.skills, c.other_details,
                       c.extracted_at,
                       r.original_filename, r.upload_date, r.status, r.project_id
                FROM contacts c
                JOIN resumes r ON c.resume_id = r.id
                WHERE r.user_id = {P}
                ORDER BY c.extracted_at DESC""",
            (user_id,),
        )

    rows = _rows(cur)
    conn.close()
    return _process_contact_rows(rows)


def get_processing_status(user_id: int = None, role: str = None) -> dict:
    conn = get_conn()
    cur = conn.cursor()

    if role == "superadmin":
        cur.execute(
            """SELECT
                   COALESCE(SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END),0) AS pending,
                   COALESCE(SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END),0) AS processing,
                   COALESCE(SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END),0) AS done,
                   COALESCE(SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END),0) AS failed,
                   COUNT(*) AS total
               FROM resumes"""
        )
    elif role == "reseller":
        cur.execute(
            f"""SELECT
                   COALESCE(SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END),0) AS pending,
                   COALESCE(SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END),0) AS processing,
                   COALESCE(SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END),0) AS done,
                   COALESCE(SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END),0) AS failed,
                   COUNT(*) AS total
               FROM resumes
               WHERE user_id = {P}
                  OR user_id IN (SELECT id FROM users WHERE reseller_id = {P})""",
            (user_id, user_id),
        )
    else:
        cur.execute(
            f"""SELECT
                   COALESCE(SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END),0) AS pending,
                   COALESCE(SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END),0) AS processing,
                   COALESCE(SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END),0) AS done,
                   COALESCE(SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END),0) AS failed,
                   COUNT(*) AS total
               FROM resumes WHERE user_id = {P}""",
            (user_id,),
        )

    row = _row(cur)
    conn.close()
    return row or {"pending": 0, "processing": 0, "done": 0, "failed": 0, "total": 0}


def get_failed_resumes(user_id: int = None, role: str = None) -> list:
    conn = get_conn()
    cur = conn.cursor()

    if role == "superadmin":
        cur.execute(
            "SELECT id, original_filename, upload_date, error_message FROM resumes WHERE status='failed' ORDER BY upload_date DESC"
        )
    elif role == "reseller":
        cur.execute(
            f"""SELECT id, original_filename, upload_date, error_message FROM resumes
                WHERE status='failed'
                  AND (user_id={P} OR user_id IN (SELECT id FROM users WHERE reseller_id={P}))
                ORDER BY upload_date DESC""",
            (user_id, user_id),
        )
    else:
        cur.execute(
            f"SELECT id, original_filename, upload_date, error_message FROM resumes WHERE status='failed' AND user_id={P} ORDER BY upload_date DESC",
            (user_id,),
        )

    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("upload_date") and not isinstance(r["upload_date"], str):
            r["upload_date"] = str(r["upload_date"])
    return rows


def get_filter_options(user_id: int = None, role: str = None) -> dict:
    contacts = get_all_contacts(user_id, role)
    locations  = sorted({(c.get("location") or "").strip() for c in contacts if c.get("location")})
    job_titles = sorted({(c.get("job_title") or "").strip() for c in contacts if c.get("job_title")})
    skills_set = set()
    for c in contacts:
        for s in (c.get("skills") or []):
            if s:
                skills_set.add(s.strip())

    # Projects scoped to this user/role (include owner_id/role for client-side cascade)
    projects_raw = get_all_projects(user_id, role)
    projects = [
        {
            "id":         p["id"],
            "name":       p["name"],
            "owner_id":   p.get("owner_id"),
            "owner_role": p.get("owner_role"),
        }
        for p in projects_raw
    ]

    # Uploader roles (superadmin only)
    uploader_roles = []
    if role == "superadmin":
        uploader_roles = sorted({c.get("uploaded_by_role") for c in contacts
                                  if c.get("uploaded_by_role")})

    # Customers list (reseller only)
    customers = []
    if role == "reseller":
        customers = get_customers_of_reseller(user_id)

    return {
        "locations":      locations,
        "job_titles":     job_titles,
        "skills":         sorted(skills_set),
        "projects":       projects,
        "uploader_roles": uploader_roles,
        "customers":      customers,
    }


# ── Projects ──────────────────────────────────────────────────────────────────

def create_project(name: str, description: str, user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    try:
        if DATABASE_URL:
            cur.execute(
                f"INSERT INTO projects (name, description, user_id) VALUES ({P},{P},{P}) RETURNING id, name, description, created_at",
                (name, description or None, user_id),
            )
            row = _row(cur)
        else:
            cur.execute(
                f"INSERT INTO projects (name, description, user_id) VALUES ({P},{P},{P})",
                (name, description or None, user_id),
            )
            new_id = cur.lastrowid
            cur.execute(f"SELECT id, name, description, created_at FROM projects WHERE id={P}", (new_id,))
            row = _row(cur)
        conn.commit()
        if row and row.get("created_at") and not isinstance(row["created_at"], str):
            row["created_at"] = str(row["created_at"])
        return row
    except Exception:
        conn.rollback()
        return None
    finally:
        conn.close()


def get_users_by_role(role: str) -> list:
    """Return all users with a given role (id, username, role)."""
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        f"SELECT id, username, role FROM users WHERE role={P} ORDER BY username ASC",
        (role,),
    )
    rows = _rows(cur)
    conn.close()
    return rows


def get_all_projects(user_id: int = None, role: str = None) -> list:
    conn = get_conn()
    cur = conn.cursor()

    if role == "superadmin":
        cur.execute(
            """SELECT p.id, p.name, p.description, p.created_at,
                      p.user_id      AS owner_id,
                      u.username AS owner_username,
                      u.role     AS owner_role,
                      COUNT(DISTINCT r.id)  AS resume_count,
                      COUNT(DISTINCT c.id)  AS contact_count
               FROM projects p
               LEFT JOIN users u    ON p.user_id    = u.id
               LEFT JOIN resumes r  ON r.project_id = p.id
               LEFT JOIN contacts c ON c.resume_id  = r.id
               GROUP BY p.id, p.name, p.description, p.created_at, p.user_id, u.username, u.role
               ORDER BY p.created_at DESC"""
        )
    elif role == "reseller":
        # Own projects + customers' projects
        cur.execute(
            f"""SELECT p.id, p.name, p.description, p.created_at,
                       p.user_id      AS owner_id,
                       u.username AS owner_username,
                       u.role     AS owner_role,
                       COUNT(DISTINCT r.id)  AS resume_count,
                       COUNT(DISTINCT c.id)  AS contact_count
                FROM projects p
                JOIN  users u    ON p.user_id    = u.id
                LEFT JOIN resumes r  ON r.project_id = p.id
                LEFT JOIN contacts c ON c.resume_id  = r.id
                WHERE p.user_id = {P}
                   OR p.user_id IN (SELECT id FROM users WHERE reseller_id = {P})
                GROUP BY p.id, p.name, p.description, p.created_at, p.user_id, u.username, u.role
                ORDER BY p.created_at DESC""",
            (user_id, user_id),
        )
    else:
        cur.execute(
            f"""SELECT p.id, p.name, p.description, p.created_at,
                       COUNT(DISTINCT r.id)  AS resume_count,
                       COUNT(DISTINCT c.id)  AS contact_count
                FROM projects p
                LEFT JOIN resumes r  ON r.project_id = p.id
                LEFT JOIN contacts c ON c.resume_id  = r.id
                WHERE p.user_id = {P}
                GROUP BY p.id, p.name, p.description, p.created_at
                ORDER BY p.created_at DESC""",
            (user_id,),
        )

    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("created_at") and not isinstance(r["created_at"], str):
            r["created_at"] = str(r["created_at"])
    return rows


def get_project_by_id(project_id: int, user_id: int = None, role: str = None):
    conn = get_conn()
    cur = conn.cursor()
    if role == "superadmin":
        cur.execute(
            f"""SELECT p.id, p.name, p.description, p.created_at, p.user_id,
                       u.username AS owner_username, u.role AS owner_role
                FROM projects p
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.id = {P}""",
            (project_id,),
        )
    elif role == "reseller":
        cur.execute(
            f"""SELECT p.id, p.name, p.description, p.created_at, p.user_id,
                       u.username AS owner_username, u.role AS owner_role
                FROM projects p
                LEFT JOIN users u ON p.user_id = u.id
                WHERE p.id = {P}
                  AND (p.user_id = {P} OR p.user_id IN (SELECT id FROM users WHERE reseller_id = {P}))""",
            (project_id, user_id, user_id),
        )
    else:
        cur.execute(
            f"SELECT id, name, description, created_at, user_id FROM projects WHERE id={P} AND user_id={P}",
            (project_id, user_id),
        )
    result = _row(cur)
    conn.close()
    if result and result.get("created_at") and not isinstance(result["created_at"], str):
        result["created_at"] = str(result["created_at"])
    return result


def delete_project(project_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(f"DELETE FROM projects WHERE id={P}", (project_id,))
    conn.commit()
    conn.close()


def get_admin_projects(owner_role: str = None) -> list:
    """Superadmin only: all projects belonging to resellers/customers, optionally filtered by role."""
    conn = get_conn()
    cur = conn.cursor()

    # Default scope: resellers + customers (not superadmin's own projects)
    allowed_roles = ("reseller", "customer")

    if owner_role and owner_role in allowed_roles:
        cur.execute(
            f"""SELECT p.id, p.name, p.description, p.created_at,
                       u.id       AS owner_id,
                       u.username AS owner_username,
                       u.role     AS owner_role,
                       COUNT(DISTINCT r.id)  AS resume_count,
                       COUNT(DISTINCT c.id)  AS contact_count
                FROM projects p
                JOIN  users u    ON p.user_id    = u.id
                LEFT JOIN resumes r  ON r.project_id = p.id
                LEFT JOIN contacts c ON c.resume_id  = r.id
                WHERE u.role = {P}
                GROUP BY p.id, p.name, p.description, p.created_at,
                         u.id, u.username, u.role
                ORDER BY u.username ASC, p.name ASC""",
            (owner_role,),
        )
    else:
        cur.execute(
            """SELECT p.id, p.name, p.description, p.created_at,
                      u.id       AS owner_id,
                      u.username AS owner_username,
                      u.role     AS owner_role,
                      COUNT(DISTINCT r.id)  AS resume_count,
                      COUNT(DISTINCT c.id)  AS contact_count
               FROM projects p
               JOIN  users u    ON p.user_id    = u.id
               LEFT JOIN resumes r  ON r.project_id = p.id
               LEFT JOIN contacts c ON c.resume_id  = r.id
               WHERE u.role IN ('reseller','customer')
               GROUP BY p.id, p.name, p.description, p.created_at,
                        u.id, u.username, u.role
               ORDER BY u.role ASC, u.username ASC, p.name ASC"""
        )

    rows = _rows(cur)
    conn.close()
    for r in rows:
        if r.get("created_at") and not isinstance(r["created_at"], str):
            r["created_at"] = str(r["created_at"])
    return rows


def _process_contact_rows(rows: list) -> list:
    """Shared post-processing for contact query results."""
    result = []
    for d in rows:
        try:
            d["skills"] = json.loads(d["skills"]) if d["skills"] else []
        except (json.JSONDecodeError, TypeError):
            d["skills"] = []
        for key in ("extracted_at", "upload_date"):
            if d.get(key) and not isinstance(d[key], str):
                d[key] = str(d[key])
        result.append(d)
    return result


def get_project_contacts(project_id: int, user_id: int = None, role: str = None) -> list:
    conn = get_conn()
    cur = conn.cursor()

    if role == "superadmin":
        cur.execute(
            f"""SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                       c.location, c.job_title, c.company, c.skills, c.other_details,
                       c.extracted_at,
                       r.original_filename, r.upload_date, r.status, r.project_id,
                       r.user_id          AS uploaded_by_user_id,
                       u.username         AS uploaded_by_username,
                       u.role             AS uploaded_by_role
                FROM contacts c
                JOIN resumes r ON c.resume_id = r.id
                LEFT JOIN users u ON r.user_id = u.id
                WHERE r.project_id = {P}
                ORDER BY c.extracted_at DESC""",
            (project_id,),
        )
    elif role == "reseller":
        cur.execute(
            f"""SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                       c.location, c.job_title, c.company, c.skills, c.other_details,
                       c.extracted_at,
                       r.original_filename, r.upload_date, r.status, r.project_id,
                       r.user_id          AS uploaded_by_user_id,
                       u.username         AS uploaded_by_username,
                       u.role             AS uploaded_by_role
                FROM contacts c
                JOIN resumes r ON c.resume_id = r.id
                JOIN users u ON r.user_id = u.id
                WHERE r.project_id = {P}
                  AND (r.user_id = {P} OR r.user_id IN (SELECT id FROM users WHERE reseller_id = {P}))
                ORDER BY c.extracted_at DESC""",
            (project_id, user_id, user_id),
        )
    else:
        cur.execute(
            f"""SELECT c.id, c.resume_id, c.name, c.email, c.phone, c.linkedin,
                       c.location, c.job_title, c.company, c.skills, c.other_details,
                       c.extracted_at,
                       r.original_filename, r.upload_date, r.status, r.project_id
                FROM contacts c
                JOIN resumes r ON c.resume_id = r.id
                WHERE r.project_id = {P} AND r.user_id = {P}
                ORDER BY c.extracted_at DESC""",
            (project_id, user_id),
        )

    rows = _rows(cur)
    conn.close()
    return _process_contact_rows(rows)

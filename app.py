import os
import io
import uuid
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, request, jsonify, render_template, send_file
from dotenv import load_dotenv
import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment

import database
import extractor

load_dotenv(Path(__file__).parent / ".env", override=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

executor = ThreadPoolExecutor(max_workers=3)

# Initialize database at startup (runs with both gunicorn and direct python)
database.init_db()


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() == "pdf"


# ── Page Routes ───────────────────────────────────────────────────────────────

@app.route("/")
def dashboard():
    return render_template("dashboard.html")


@app.route("/upload")
def upload_page():
    return render_template("upload.html")


# ── API Routes ────────────────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "files" not in request.files:
        return jsonify({"error": "No files in request"}), 400

    if not ANTHROPIC_API_KEY:
        return jsonify({"error": "ANTHROPIC_API_KEY not configured on server"}), 500

    files = request.files.getlist("files")
    uploaded, skipped, resume_ids = 0, 0, []

    for f in files:
        if not f.filename or not allowed_file(f.filename):
            skipped += 1
            continue

        pdf_bytes = f.read()
        resume_id = database.insert_resume(f.filename, pdf_bytes)
        resume_ids.append(resume_id)

        executor.submit(extractor.process_resume, resume_id, ANTHROPIC_API_KEY, database)
        uploaded += 1

    return jsonify({"uploaded": uploaded, "skipped": skipped, "ids": resume_ids})


@app.route("/api/contacts", methods=["GET"])
def api_contacts():
    contacts = database.get_all_contacts()
    search = request.args.get("search", "").lower().strip()

    if search:
        def matches(c):
            return any(search in (c.get(f) or "").lower() for f in
                       ["name", "email", "company", "location", "job_title"]) or \
                   search in " ".join(c.get("skills") or []).lower()
        contacts = [c for c in contacts if matches(c)]

    return jsonify(contacts)


@app.route("/api/status", methods=["GET"])
def api_status():
    return jsonify(database.get_processing_status())


@app.route("/api/export", methods=["GET"])
def api_export():
    contacts = database.get_all_contacts()
    if not contacts:
        return jsonify({"error": "No contacts to export yet"}), 404

    rows = []
    for c in contacts:
        skills_list = c.get("skills") or []
        if isinstance(skills_list, str):
            try:
                skills_list = json.loads(skills_list)
            except Exception:
                skills_list = []

        other = {}
        try:
            raw_other = c.get("other_details") or "{}"
            other = json.loads(raw_other) if isinstance(raw_other, str) else (raw_other or {})
        except Exception:
            pass

        rows.append({
            "Name":             c.get("name") or "",
            "Email":            c.get("email") or "",
            "Phone":            c.get("phone") or "",
            "LinkedIn":         c.get("linkedin") or "",
            "Location":         c.get("location") or "",
            "Job Title":        c.get("job_title") or "",
            "Company":          c.get("company") or "",
            "Skills":           ", ".join(skills_list),
            "GitHub":           other.get("github") or "",
            "Portfolio":        other.get("portfolio") or "",
            "Education":        other.get("education") or "",
            "Years Experience": other.get("years_experience") or "",
            "Source File":      c.get("original_filename") or "",
            "Upload Date":      str(c.get("upload_date") or ""),
            "Extracted At":     str(c.get("extracted_at") or ""),
        })

    df = pd.DataFrame(rows)
    output = io.BytesIO()

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="Contacts", index=False)
        ws = writer.sheets["Contacts"]

        header_fill = PatternFill("solid", fgColor="1F4E79")
        header_font = Font(bold=True, color="FFFFFF")
        for cell in ws[1]:
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center")

        for col_cells in ws.columns:
            max_len = max((len(str(cell.value or "")) for cell in col_cells), default=10)
            ws.column_dimensions[col_cells[0].column_letter].width = min(max_len + 4, 60)

    output.seek(0)
    return send_file(
        output,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="resume_contacts.xlsx",
    )


@app.route("/api/resumes/failed", methods=["GET"])
def api_failed():
    return jsonify(database.get_failed_resumes())


@app.route("/api/resumes/<int:resume_id>", methods=["DELETE"])
def api_delete_resume(resume_id):
    resume = database.get_resume_by_id(resume_id)
    if not resume:
        return jsonify({"error": "Not found"}), 404
    database.delete_resume(resume_id)
    return jsonify({"deleted": resume_id})


@app.route("/uploads/<int:resume_id>")
def serve_pdf(resume_id):
    """Serve PDF directly from the database."""
    resume = database.get_resume_by_id(resume_id)
    if not resume:
        return "Not found", 404
    pdf_bytes = database.get_pdf_bytes(resume_id)
    if not pdf_bytes:
        return "PDF not found", 404
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=False,
        download_name=resume.get("original_filename", "resume.pdf"),
    )


# ── Startup ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    database.init_db()
    if not ANTHROPIC_API_KEY:
        print("\nWARNING: ANTHROPIC_API_KEY not set.\n")
    print("Starting Resume Extractor at http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000, use_reloader=False)

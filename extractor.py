import io
import pdfplumber
import anthropic
import json
import re

CLAUDE_MODEL = "claude-haiku-4-5-20251001"
MAX_TEXT_CHARS = 8000

EXTRACTION_PROMPT = """You are a precise data extraction assistant. Extract contact and professional information from the resume text below.

Return ONLY a valid JSON object with exactly these fields. Use null for any field not found. Do not add any text before or after the JSON.

Required JSON structure:
{{
  "name": "Full name of the person",
  "email": "email address or null",
  "phone": "phone number including country code if present, or null",
  "linkedin": "full LinkedIn URL or LinkedIn username, or null",
  "location": "city, state/country as listed, or null",
  "job_title": "current or most recent job title, or null",
  "company": "current or most recent company name, or null",
  "skills": ["skill1", "skill2", "skill3"],
  "other_details": {{
    "github": "GitHub URL if present, else null",
    "portfolio": "portfolio/website URL if present, else null",
    "education": "highest degree and institution, else null",
    "years_experience": "estimated years of experience if determinable, else null"
  }}
}}

Rules:
- skills must be a JSON array. Use [] if none found.
- other_details must always be present as a JSON object.
- Do not hallucinate information not present in the resume.
- For phone, preserve formatting exactly as it appears.

Resume text:
---
{resume_text}
---

JSON output:"""


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> tuple:
    """Returns (raw_text, error_or_warning)."""
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages_text = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    pages_text.append(text)
            full_text = "\n".join(pages_text).strip()
            if len(full_text) < 50:
                return full_text, "low_text_warning: likely scanned or image-based PDF"
            return full_text, None
    except Exception as e:
        return "", str(e)


def extract_contact_with_claude(raw_text: str, api_key: str) -> tuple:
    """Returns (contact_dict, error)."""
    client = anthropic.Anthropic(api_key=api_key)
    prompt = EXTRACTION_PROMPT.format(resume_text=raw_text[:MAX_TEXT_CHARS])

    try:
        message = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_response = message.content[0].text.strip()

        json_match = re.search(r"\{.*\}", raw_response, re.DOTALL)
        if not json_match:
            return None, f"No JSON found in response: {raw_response[:300]}"

        data = json.loads(json_match.group())
        if not isinstance(data.get("skills"), list):
            data["skills"] = []

        contact = {
            "name":          data.get("name"),
            "email":         data.get("email"),
            "phone":         data.get("phone"),
            "linkedin":      data.get("linkedin"),
            "location":      data.get("location"),
            "job_title":     data.get("job_title"),
            "company":       data.get("company"),
            "skills":        json.dumps(data.get("skills", [])),
            "other_details": json.dumps(data.get("other_details") or {}),
        }
        return contact, None

    except json.JSONDecodeError as e:
        return None, f"JSON parse error: {e}"
    except anthropic.APIError as e:
        return None, f"Claude API error: {e}"
    except Exception as e:
        return None, f"Unexpected error: {e}"


def process_resume(resume_id: int, api_key: str, db):
    """Full pipeline for one resume. Runs in a background thread."""
    db.update_resume_status(resume_id, "processing")

    pdf_bytes = db.get_pdf_bytes(resume_id)
    if not pdf_bytes:
        db.update_resume_status(resume_id, "failed", error_message="PDF data not found in database")
        return

    raw_text, text_error = extract_text_from_pdf_bytes(pdf_bytes)

    if not raw_text:
        db.update_resume_status(resume_id, "failed",
                                error_message=text_error or "Empty text extracted from PDF")
        return

    contact, api_error = extract_contact_with_claude(raw_text, api_key)

    if api_error:
        db.update_resume_status(resume_id, "failed", raw_text=raw_text, error_message=api_error)
        return

    db.insert_contact(resume_id, contact)
    db.update_resume_status(resume_id, "done", raw_text=raw_text)

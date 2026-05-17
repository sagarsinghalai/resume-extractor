/* dashboard.js — contacts table, live stats polling, search, export */

const POLL_MS = 2500;
let pollTimer = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trunc(str, n) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function parseSkills(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return []; }
}

// ── Stats ──────────────────────────────────────────────────────────────────

async function fetchStats() {
  try {
    const res = await fetch('/api/status');
    const d = await res.json();
    document.getElementById('stat-done').textContent       = d.done       ?? 0;
    document.getElementById('stat-processing').textContent = d.processing ?? 0;
    document.getElementById('stat-failed').textContent     = d.failed     ?? 0;
    document.getElementById('stat-total').textContent      = d.total      ?? 0;

    const dot = document.getElementById('live-dot');
    dot.classList.toggle('bg-success');
    dot.classList.toggle('bg-secondary');

    if ((d.pending ?? 0) + (d.processing ?? 0) > 0) {
      fetchContacts(); // refresh table while queue is active
    }

    if ((d.failed ?? 0) > 0) {
      fetchFailed();
    }
  } catch (e) {
    console.warn('Stats error', e);
  }
}

// ── Failed Resumes ─────────────────────────────────────────────────────────

async function fetchFailed() {
  try {
    const res = await fetch('/api/resumes/failed');
    const data = await res.json();
    if (!data.length) return;

    document.getElementById('failed-section').classList.remove('d-none');
    const tbody = document.getElementById('failed-tbody');
    tbody.innerHTML = data.map(r => `
      <tr>
        <td class="ps-3">${esc(r.original_filename)}</td>
        <td class="text-muted small">${esc(r.upload_date)}</td>
        <td class="text-danger small">${esc(r.error_message)}</td>
      </tr>`).join('');
  } catch (e) { /* ignore */ }
}

// ── Contacts Table ─────────────────────────────────────────────────────────

async function fetchContacts() {
  const search = document.getElementById('search-input').value.trim();
  const url = search
    ? `/api/contacts?search=${encodeURIComponent(search)}`
    : '/api/contacts';

  try {
    const res = await fetch(url);
    const contacts = await res.json();
    renderTable(contacts);
  } catch (e) {
    console.warn('Contacts error', e);
  }
}

function renderTable(contacts) {
  const tbody = document.getElementById('contacts-tbody');
  const footer = document.getElementById('table-footer');

  if (!contacts.length) {
    tbody.innerHTML = `
      <tr><td colspan="11" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-3 d-block mb-2"></i>No contacts found.
        <a href="/upload" class="btn btn-sm btn-primary mt-2">Upload Resumes</a>
      </td></tr>`;
    footer.textContent = '';
    return;
  }

  footer.textContent = `Showing ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = contacts.map((c, i) => {
    const skills = parseSkills(c.skills);
    const skillHtml = skills.length
      ? skills.slice(0, 4).map(s => `<span class="skill-badge me-1">${esc(s)}</span>`).join('')
        + (skills.length > 4 ? `<span class="skill-badge bg-secondary text-white border-0">+${skills.length - 4}</span>` : '')
      : '<span class="text-muted">—</span>';

    const linkedinBtn = c.linkedin
      ? `<a href="${esc(c.linkedin)}" target="_blank" class="btn btn-sm btn-outline-primary py-0 px-2" title="LinkedIn">
           <i class="bi bi-linkedin"></i></a>`
      : '';

    const pdfBtn = c.resume_id
      ? `<a href="/uploads/${c.resume_id}" target="_blank"
            class="btn btn-sm btn-outline-secondary py-0 px-2" title="View PDF">
           <i class="bi bi-file-pdf"></i></a>`
      : '';

    const emailHtml = c.email
      ? `<a href="mailto:${esc(c.email)}" class="text-decoration-none">${esc(c.email)}</a>`
      : '—';

    return `<tr>
      <td class="ps-3 text-muted small">${i + 1}</td>
      <td class="fw-semibold">${esc(c.name) || '—'}</td>
      <td>${emailHtml}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${esc(c.location) || '—'}</td>
      <td>${esc(c.job_title) || '—'}</td>
      <td>${esc(c.company) || '—'}</td>
      <td class="wrap">${skillHtml}</td>
      <td>
        <div class="d-flex gap-1">
          ${linkedinBtn}
          ${pdfBtn}
        </div>
      </td>
      <td class="text-muted small" title="${esc(c.original_filename)}">${trunc(c.original_filename, 22)}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger py-0 px-2"
                onclick="deleteResume(${c.resume_id}, this)" title="Delete">
          <i class="bi bi-trash3"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

// ── Delete ─────────────────────────────────────────────────────────────────

async function deleteResume(resumeId, btn) {
  if (!confirm('Delete this resume and its extracted contact? This cannot be undone.')) return;
  try {
    btn.disabled = true;
    await fetch(`/api/resumes/${resumeId}`, { method: 'DELETE' });
    await Promise.all([fetchContacts(), fetchStats()]);
  } catch (e) {
    alert('Delete failed: ' + e.message);
    btn.disabled = false;
  }
}

// ── Export ─────────────────────────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', async () => {
  const btn = document.getElementById('export-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Exporting…';
  try {
    const res = await fetch('/api/export');
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume_contacts.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Export Excel';
  }
});

// ── Search ─────────────────────────────────────────────────────────────────

let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(fetchContacts, 300);
});

// ── Init ───────────────────────────────────────────────────────────────────

fetchContacts();
fetchStats();
pollTimer = setInterval(fetchStats, POLL_MS);

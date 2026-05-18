/* project_detail.js — contacts table filtered to a single project */

const SHOW_UPLOADER = window.IS_SUPERADMIN || window.IS_RESELLER;
const COL_SPAN      = SHOW_UPLOADER ? 12 : 11;
const PID           = window.PROJECT_ID;

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

function roleBadge(role) {
  if (role === 'superadmin') return '<span class="badge bg-danger ms-1" style="font-size:0.65rem">admin</span>';
  if (role === 'reseller')   return '<span class="badge bg-warning text-dark ms-1" style="font-size:0.65rem">reseller</span>';
  return '<span class="badge bg-info text-dark ms-1" style="font-size:0.65rem">customer</span>';
}

function populateSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`
    + values.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

// ── Filter Options ─────────────────────────────────────────────────────────

async function fetchFilterOptions() {
  try {
    const res = await fetch(`/api/projects/${PID}/filter-options`);
    const { locations, job_titles, skills } = await res.json();
    populateSelect('filter-skill',     skills,     'All Skills');
    populateSelect('filter-job-title', job_titles, 'All Job Titles');
    populateSelect('filter-location',  locations,  'All Locations');
    // Role dropdown is static HTML — no JS re-render needed
  } catch (e) { console.warn('Filter options error', e); }
}

// ── Contacts Table ─────────────────────────────────────────────────────────

async function fetchContacts() {
  const search       = document.getElementById('search-input').value.trim();
  const uploaderRole = document.getElementById('filter-uploader-role')?.value || '';
  const skill        = document.getElementById('filter-skill').value;
  const jobTitle     = document.getElementById('filter-job-title').value;
  const location     = document.getElementById('filter-location').value;

  const params = new URLSearchParams();
  if (search)       params.set('search',       search);
  if (uploaderRole) params.set('uploader_role', uploaderRole);
  if (skill)        params.set('skill',         skill);
  if (jobTitle)     params.set('job_title',     jobTitle);
  if (location)     params.set('location',      location);

  const anyActive = !!(search || uploaderRole || skill || jobTitle || location);
  document.getElementById('clear-filters-btn').classList.toggle('d-none', !anyActive);

  try {
    const res = await fetch(`/api/projects/${PID}/contacts?` + params.toString());
    const contacts = await res.json();
    renderTable(contacts);
  } catch (e) { console.warn('Contacts error', e); }
}

function renderTable(contacts) {
  const tbody  = document.getElementById('contacts-tbody');
  const footer = document.getElementById('table-footer');

  if (!contacts.length) {
    tbody.innerHTML = `
      <tr><td colspan="${COL_SPAN}" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-3 d-block mb-2"></i>No contacts in this project yet.
        <a href="/upload?project_id=${PID}" class="btn btn-sm btn-primary mt-2">Upload Resumes</a>
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
      ? `<a href="${esc(c.linkedin)}" target="_blank"
            class="btn btn-sm btn-outline-primary py-0 px-2" title="${esc(c.linkedin)}">
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

    const uploadedByCell = SHOW_UPLOADER
      ? `<td class="small">${c.uploaded_by_username
          ? esc(c.uploaded_by_username) + roleBadge(c.uploaded_by_role)
          : '—'}</td>`
      : '';

    return `<tr>
      <td class="ps-3 text-muted small">${i + 1}</td>
      <td class="fw-semibold">${esc(c.name) || '—'}</td>
      <td>${emailHtml}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${esc(c.location) || '—'}</td>
      <td>${esc(c.job_title) || '—'}</td>
      <td>${esc(c.company) || '—'}</td>
      <td class="wrap">${skillHtml}</td>
      <td><div class="d-flex gap-1">${linkedinBtn}${pdfBtn}</div></td>
      <td class="text-muted small" title="${esc(c.original_filename)}">${trunc(c.original_filename, 22)}</td>
      ${uploadedByCell}
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
    fetchContacts();
    fetchFilterOptions();
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
    const res = await fetch(`/api/projects/${PID}/export`);
    if (!res.ok) { alert((await res.json()).error || 'Export failed'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `project_${PID}_contacts.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Export Excel';
  }
});

// ── Cascade Event Listeners ────────────────────────────────────────────────

// Search — no cascade
let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(fetchContacts, 300);
});

// Role (superadmin/reseller) → resets Skills / Job Titles / Locations
const roleEl = document.getElementById('filter-uploader-role');
if (roleEl) {
  roleEl.addEventListener('change', async () => {
    document.getElementById('filter-skill').value     = '';
    document.getElementById('filter-job-title').value = '';
    document.getElementById('filter-location').value  = '';
    await fetchFilterOptions();
    fetchContacts();
  });
}

// Skill → resets Job Title and Location
document.getElementById('filter-skill').addEventListener('change', () => {
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-location').value  = '';
  fetchContacts();
});

// Job Title → resets Location
document.getElementById('filter-job-title').addEventListener('change', () => {
  document.getElementById('filter-location').value = '';
  fetchContacts();
});

// Location — terminal filter, just fetch
document.getElementById('filter-location').addEventListener('change', fetchContacts);

// Clear all filters
document.getElementById('clear-filters-btn').addEventListener('click', async () => {
  document.getElementById('search-input').value     = '';
  if (roleEl) roleEl.value = '';
  document.getElementById('filter-skill').value     = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-location').value  = '';
  await fetchFilterOptions();
  fetchContacts();
});

// ── Init ───────────────────────────────────────────────────────────────────

fetchContacts();
fetchFilterOptions();

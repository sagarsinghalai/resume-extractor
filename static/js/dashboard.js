/* dashboard.js — contacts table, live stats polling, search, filters, export */

const POLL_MS = 2500;
let pollTimer = null;
const COL_SPAN = window.IS_SUPERADMIN ? 12 : 11;

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

function roleBadge(role) {
  if (role === 'superadmin') return '<span class="badge bg-danger ms-1" style="font-size:0.65rem">admin</span>';
  if (role === 'reseller')   return '<span class="badge bg-warning text-dark ms-1" style="font-size:0.65rem">reseller</span>';
  return '<span class="badge bg-info text-dark ms-1" style="font-size:0.65rem">customer</span>';
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
      fetchContacts();
      fetchFilterOptions();
    }
    if ((d.failed ?? 0) > 0) fetchFailed();
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
    document.getElementById('failed-tbody').innerHTML = data.map(r => `
      <tr>
        <td class="ps-3">${esc(r.original_filename)}</td>
        <td class="text-muted small">${esc(r.upload_date)}</td>
        <td class="text-danger small">${esc(r.error_message)}</td>
      </tr>`).join('');
  } catch (e) { /* ignore */ }
}

// ── Filter Options ─────────────────────────────────────────────────────────

async function fetchFilterOptions() {
  try {
    const res = await fetch('/api/filter-options');
    const { locations, job_titles, skills, projects, uploader_roles } = await res.json();
    populateSelect('filter-location',  locations,  'All Locations');
    populateSelect('filter-job-title', job_titles, 'All Job Titles');
    populateSelect('filter-skill',     skills,     'All Skills');

    // Projects — value is numeric id, label is project name
    populateProjectSelect('filter-project', projects);

    // Uploader roles (superadmin only — element may not exist)
    if (uploader_roles && uploader_roles.length) {
      populateRoleSelect('filter-uploader-role', uploader_roles);
    }
  } catch (e) { console.warn('Filter options error', e); }
}

function populateSelect(id, values, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`
    + values.map(v => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function populateProjectSelect(id, projects) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All Projects</option>`
    + projects.map(p =>
        `<option value="${p.id}"${String(p.id) === current ? ' selected' : ''}>${esc(p.name)}</option>`
      ).join('');
}

function populateRoleSelect(id, roles) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  // Only add options that are present in actual data; keep the hardcoded ones in HTML
  // Re-render with what the server says is present
  const labelMap = { reseller: 'Resellers', customer: 'Customers', superadmin: 'Superadmin' };
  sel.innerHTML = `<option value="">All Roles</option>`
    + roles.map(r =>
        `<option value="${esc(r)}"${r === current ? ' selected' : ''}>${labelMap[r] || esc(r)}</option>`
      ).join('');
}

// ── Contacts Table ─────────────────────────────────────────────────────────

async function fetchContacts() {
  const search        = document.getElementById('search-input').value.trim();
  const location      = document.getElementById('filter-location').value;
  const jobTitle      = document.getElementById('filter-job-title').value;
  const skill         = document.getElementById('filter-skill').value;
  const project       = document.getElementById('filter-project').value;
  const uploaderRole  = document.getElementById('filter-uploader-role')?.value || '';

  const params = new URLSearchParams();
  if (search)       params.set('search',        search);
  if (location)     params.set('location',       location);
  if (jobTitle)     params.set('job_title',      jobTitle);
  if (skill)        params.set('skill',          skill);
  if (project)      params.set('project_id',     project);
  if (uploaderRole) params.set('uploader_role',  uploaderRole);

  const anyActive = !!(search || location || jobTitle || skill || project || uploaderRole);
  document.getElementById('clear-filters-btn').classList.toggle('d-none', !anyActive);

  try {
    const res = await fetch('/api/contacts?' + params.toString());
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

    // Superadmin-only "Uploaded By" column
    const uploadedByCell = window.IS_SUPERADMIN
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
    await Promise.all([fetchContacts(), fetchStats(), fetchFilterOptions()]);
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
    if (!res.ok) { alert((await res.json()).error || 'Export failed'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'resume_contacts.xlsx'; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Export Excel';
  }
});

// ── Search & Filters ───────────────────────────────────────────────────────

let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(fetchContacts, 300);
});

['filter-location', 'filter-job-title', 'filter-skill',
 'filter-project', 'filter-uploader-role'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', fetchContacts);
});

document.getElementById('clear-filters-btn').addEventListener('click', () => {
  document.getElementById('search-input').value         = '';
  document.getElementById('filter-location').value      = '';
  document.getElementById('filter-job-title').value     = '';
  document.getElementById('filter-skill').value         = '';
  document.getElementById('filter-project').value       = '';
  const roleEl = document.getElementById('filter-uploader-role');
  if (roleEl) roleEl.value = '';
  fetchContacts();
});

// ── Init ───────────────────────────────────────────────────────────────────

fetchContacts();
fetchStats();
fetchFilterOptions();
pollTimer = setInterval(fetchStats, POLL_MS);

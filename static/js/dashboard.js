/* dashboard.js — contacts table, live stats polling, search, filters, export */

const POLL_MS = 2500;
let pollTimer = null;
const SHOW_UPLOADER = window.IS_SUPERADMIN || window.IS_RESELLER;
const COL_SPAN = SHOW_UPLOADER ? 12 : 11;

// ── Cascade state ──────────────────────────────────────────────────────────
let allProjects  = [];  // full project list (with owner_id / owner_role)
let allSkills    = [];
let allJobTitles = [];
let allLocations = [];

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
    const res  = await fetch('/api/filter-options');
    const data = await res.json();
    const { locations, job_titles, skills, projects, customers } = data;

    // Store full lists for cascade resets
    allProjects  = projects   || [];
    allSkills    = skills     || [];
    allJobTitles = job_titles || [];
    allLocations = locations  || [];

    // Customers dropdown (reseller only)
    if (customers && customers.length) {
      populateCustomerSelect('filter-customer', customers);
    }

    // Only repopulate projects if no role/customer filter is active
    const roleEl = document.getElementById('filter-uploader-role');
    const custEl = document.getElementById('filter-customer');
    if (!roleEl?.value && !custEl?.value) {
      populateProjectSelect('filter-project', allProjects);
    }

    // Only repopulate skill/job/location if no project is selected
    const projEl = document.getElementById('filter-project');
    if (!projEl?.value) {
      populateSelect('filter-skill',     allSkills,    'All Skills');
      populateSelect('filter-job-title', allJobTitles, 'All Job Titles');
      populateSelect('filter-location',  allLocations, 'All Locations');
    }
  } catch (e) { console.warn('Filter options error', e); }
}

async function fetchProjectFilterOptions(pid) {
  if (!pid) {
    populateSelect('filter-skill',     allSkills,    'All Skills');
    populateSelect('filter-job-title', allJobTitles, 'All Job Titles');
    populateSelect('filter-location',  allLocations, 'All Locations');
    return;
  }
  try {
    const res = await fetch(`/api/projects/${pid}/filter-options`);
    const { skills, job_titles, locations } = await res.json();
    populateSelect('filter-skill',     skills,     'All Skills');
    populateSelect('filter-job-title', job_titles, 'All Job Titles');
    populateSelect('filter-location',  locations,  'All Locations');
  } catch (e) { /* fall back silently */ }
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

function populateCustomerSelect(id, customers) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">All Customers</option>`
    + customers.map(c =>
        `<option value="${c.id}"${String(c.id) === current ? ' selected' : ''}>${esc(c.username)}</option>`
      ).join('');
}

// ── Contacts Table ─────────────────────────────────────────────────────────

function showSelectProjectMessage() {
  const tbody = document.getElementById('contacts-tbody');
  const footer = document.getElementById('table-footer');
  tbody.innerHTML = `
    <tr><td colspan="${COL_SPAN}" class="text-center py-5 text-muted">
      <i class="bi bi-funnel fs-3 d-block mb-2"></i>
      <div class="fw-semibold mb-1">Project required</div>
      <div class="small">Select a project from the filter above to view contacts.</div>
    </td></tr>`;
  footer.textContent = '';
  document.getElementById('clear-filters-btn').classList.remove('d-none');
}

async function fetchContacts() {
  const search        = document.getElementById('search-input').value.trim();
  const uploaderRole  = document.getElementById('filter-uploader-role')?.value || '';
  const customerId    = document.getElementById('filter-customer')?.value || '';
  const project       = document.getElementById('filter-project').value;
  const skill         = document.getElementById('filter-skill').value;
  const jobTitle      = document.getElementById('filter-job-title').value;
  const location      = document.getElementById('filter-location').value;

  // When a role or customer is selected, require a project before showing data
  // Customers must always select a project first
  if ((uploaderRole || customerId || window.IS_CUSTOMER) && !project) {
    showSelectProjectMessage();
    return;
  }

  const params = new URLSearchParams();
  if (search)       params.set('search',        search);
  if (uploaderRole) params.set('uploader_role',  uploaderRole);
  if (customerId)   params.set('customer_id',    customerId);
  if (project)      params.set('project_id',     project);
  if (skill)        params.set('skill',          skill);
  if (jobTitle)     params.set('job_title',      jobTitle);
  if (location)     params.set('location',       location);

  const anyActive = !!(search || uploaderRole || customerId || project || skill || jobTitle || location);
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

// ── Cascade Event Listeners ────────────────────────────────────────────────

// Search — no cascade, just fetch
let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(fetchContacts, 300);
});

// Role filter (superadmin only) → narrows Projects, resets downstream
const roleEl = document.getElementById('filter-uploader-role');
if (roleEl) {
  roleEl.addEventListener('change', () => {
    const role    = roleEl.value;
    const filtered = role
      ? allProjects.filter(p => p.owner_role === role)
      : allProjects;
    populateProjectSelect('filter-project', filtered);
    // Reset project + downstream values
    document.getElementById('filter-project').value  = '';
    document.getElementById('filter-skill').value     = '';
    document.getElementById('filter-job-title').value = '';
    document.getElementById('filter-location').value  = '';
    populateSelect('filter-skill',     allSkills,    'All Skills');
    populateSelect('filter-job-title', allJobTitles, 'All Job Titles');
    populateSelect('filter-location',  allLocations, 'All Locations');
    fetchContacts();
  });
}

// Customer filter (reseller only) → narrows Projects, resets downstream
const custEl = document.getElementById('filter-customer');
if (custEl) {
  custEl.addEventListener('change', () => {
    const custId  = custEl.value ? parseInt(custEl.value, 10) : null;
    const filtered = custId
      ? allProjects.filter(p => p.owner_id === custId)
      : allProjects;
    populateProjectSelect('filter-project', filtered);
    document.getElementById('filter-project').value  = '';
    document.getElementById('filter-skill').value     = '';
    document.getElementById('filter-job-title').value = '';
    document.getElementById('filter-location').value  = '';
    populateSelect('filter-skill',     allSkills,    'All Skills');
    populateSelect('filter-job-title', allJobTitles, 'All Job Titles');
    populateSelect('filter-location',  allLocations, 'All Locations');
    fetchContacts();
  });
}

// Project filter → narrows Skills/Job Titles/Locations
const projEl = document.getElementById('filter-project');
if (projEl) {
  projEl.addEventListener('change', async () => {
    const pid = projEl.value;
    // Reset downstream values
    document.getElementById('filter-skill').value     = '';
    document.getElementById('filter-job-title').value = '';
    document.getElementById('filter-location').value  = '';
    // Fetch project-specific options or restore full lists
    await fetchProjectFilterOptions(pid || null);
    fetchContacts();
  });
}

// Skill → Job Title → Location: just fetch contacts
['filter-skill', 'filter-job-title', 'filter-location'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', fetchContacts);
});

// Clear all filters
document.getElementById('clear-filters-btn').addEventListener('click', () => {
  document.getElementById('search-input').value     = '';
  const roleEl = document.getElementById('filter-uploader-role');
  const custEl = document.getElementById('filter-customer');
  if (roleEl) roleEl.value = '';
  if (custEl)  custEl.value = '';
  document.getElementById('filter-project').value  = '';
  document.getElementById('filter-skill').value     = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-location').value  = '';
  // Restore full project + skill/job/location lists
  populateProjectSelect('filter-project', allProjects);
  populateSelect('filter-skill',     allSkills,    'All Skills');
  populateSelect('filter-job-title', allJobTitles, 'All Job Titles');
  populateSelect('filter-location',  allLocations, 'All Locations');
  fetchContacts();
});

// ── Init ───────────────────────────────────────────────────────────────────

fetchContacts();
fetchStats();
fetchFilterOptions();
pollTimer = setInterval(fetchStats, POLL_MS);

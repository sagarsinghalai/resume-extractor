/* admin_data.js — superadmin role→project→contacts filter & export */

// ── State ──────────────────────────────────────────────────────────────────

let allContacts  = [];   // raw contacts for the selected project
let allProjects  = [];   // projects for the selected role
let selectedPID  = null; // currently selected project id

// ── Helpers ────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`
    + values.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

// ── Step 1 — Role filter ───────────────────────────────────────────────────

document.getElementById('role-filter').addEventListener('change', async function () {
  const role = this.value;
  const projSel  = document.getElementById('project-filter');
  const projHint = document.getElementById('project-hint');

  // Reset downstream
  projSel.innerHTML = '<option value="">Loading projects…</option>';
  projSel.disabled  = true;
  hideResults();

  try {
    const params = role ? `?role=${encodeURIComponent(role)}` : '';
    const res    = await fetch('/api/admin/projects' + params);
    allProjects  = await res.json();

    if (!allProjects.length) {
      projSel.innerHTML = '<option value="">No projects found for this role</option>';
      projHint.textContent = 'Create projects from the Projects page and upload resumes to them.';
      return;
    }

    // Build grouped options: group by owner when "all roles" selected
    const groupByOwner = !role;
    let html = '<option value="">— Select a project —</option>';

    if (groupByOwner) {
      // Group by role then owner
      const byRole = { reseller: [], customer: [] };
      allProjects.forEach(p => { (byRole[p.owner_role] || byRole.customer).push(p); });

      ['reseller', 'customer'].forEach(r => {
        if (!byRole[r].length) return;
        const label = r === 'reseller' ? 'Resellers' : 'Customers';
        html += `<optgroup label="── ${label} ──">`;
        byRole[r].forEach(p => {
          html += `<option value="${p.id}">${esc(p.owner_username)} › ${esc(p.name)}`
               +  ` (${p.contact_count} contacts)</option>`;
        });
        html += '</optgroup>';
      });
    } else {
      allProjects.forEach(p => {
        html += `<option value="${p.id}">${esc(p.owner_username)} › ${esc(p.name)}`
             +  ` (${p.contact_count} contacts)</option>`;
      });
    }

    projSel.innerHTML = html;
    projSel.disabled  = false;
    projHint.textContent = `${allProjects.length} project${allProjects.length !== 1 ? 's' : ''} found.`;
  } catch (e) {
    projSel.innerHTML = '<option value="">Error loading projects</option>';
    projHint.textContent = 'Could not load projects: ' + e.message;
  }
});

// ── Step 2 — Project filter ────────────────────────────────────────────────

document.getElementById('project-filter').addEventListener('change', async function () {
  const pid = this.value;
  if (!pid) { hideResults(); return; }

  selectedPID = parseInt(pid, 10);
  const proj  = allProjects.find(p => p.id === selectedPID);

  showResultsSection(proj);
  await loadContacts();
  await loadFilterOptions();
});

// ── Load contacts ──────────────────────────────────────────────────────────

async function loadContacts() {
  if (!selectedPID) return;

  const search   = document.getElementById('search-input').value.trim();
  const location = document.getElementById('filter-location').value;
  const jobTitle = document.getElementById('filter-job-title').value;
  const skill    = document.getElementById('filter-skill').value;

  const params = new URLSearchParams();
  if (search)   params.set('search',    search);
  if (location) params.set('location',  location);
  if (jobTitle) params.set('job_title', jobTitle);
  if (skill)    params.set('skill',     skill);

  document.getElementById('clear-filters-btn')
    .classList.toggle('d-none', !(search || location || jobTitle || skill));

  try {
    const res      = await fetch(`/api/projects/${selectedPID}/contacts?` + params.toString());
    allContacts    = await res.json();
    renderTable(allContacts);
  } catch (e) {
    document.getElementById('contacts-tbody').innerHTML =
      `<tr><td colspan="11" class="text-center text-danger py-3">Error: ${esc(e.message)}</td></tr>`;
  }
}

// ── Load filter options ────────────────────────────────────────────────────

async function loadFilterOptions() {
  if (!selectedPID) return;
  try {
    const res = await fetch(`/api/projects/${selectedPID}/filter-options`);
    const { locations, job_titles, skills } = await res.json();
    populateSelect('filter-location',  locations,  'All Locations');
    populateSelect('filter-job-title', job_titles, 'All Job Titles');
    populateSelect('filter-skill',     skills,     'All Skills');
  } catch { /* silently ignore */ }
}

// ── Render table ───────────────────────────────────────────────────────────

function renderTable(contacts) {
  const tbody  = document.getElementById('contacts-tbody');
  const footer = document.getElementById('table-footer');

  document.getElementById('results-meta').textContent =
    `${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;

  if (!contacts.length) {
    tbody.innerHTML = `
      <tr><td colspan="11" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-3 d-block mb-2"></i>No contacts in this project.
      </td></tr>`;
    footer.textContent = '';
    document.getElementById('export-btn').disabled = true;
    return;
  }

  footer.textContent = `Showing ${contacts.length} contact${contacts.length !== 1 ? 's' : ''}`;
  document.getElementById('export-btn').disabled = false;

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

    const uploaderHtml = c.uploaded_by_username
      ? esc(c.uploaded_by_username) + roleBadge(c.uploaded_by_role)
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
      <td><div class="d-flex gap-1">${linkedinBtn}${pdfBtn}</div></td>
      <td class="small">${uploaderHtml}</td>
      <td class="text-muted small" title="${esc(c.original_filename)}">${trunc(c.original_filename, 22)}</td>
    </tr>`;
  }).join('');
}

// ── Export ─────────────────────────────────────────────────────────────────

document.getElementById('export-btn').addEventListener('click', async () => {
  if (!selectedPID) return;
  const btn = document.getElementById('export-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Exporting…';
  try {
    const res = await fetch(`/api/projects/${selectedPID}/export`);
    if (!res.ok) { alert((await res.json()).error || 'Export failed'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    const proj = allProjects.find(p => p.id === selectedPID);
    a.download = proj ? `${proj.owner_username}_${proj.name}_contacts.xlsx` : `project_${selectedPID}_contacts.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Download Excel';
  }
});

// ── Search & Filters ───────────────────────────────────────────────────────

let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadContacts, 300);
});

['filter-location', 'filter-job-title', 'filter-skill'].forEach(id =>
  document.getElementById(id).addEventListener('change', loadContacts)
);

document.getElementById('clear-filters-btn').addEventListener('click', () => {
  document.getElementById('search-input').value     = '';
  document.getElementById('filter-location').value  = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-skill').value     = '';
  loadContacts();
});

// ── UI helpers ─────────────────────────────────────────────────────────────

function showResultsSection(proj) {
  document.getElementById('results-section').classList.remove('d-none');
  document.getElementById('export-btn').disabled = false;

  const ownerBadge = proj
    ? `<span class="badge ms-2 ${proj.owner_role === 'reseller' ? 'bg-warning text-dark' : 'bg-info text-dark'}"
             style="font-size:0.7rem">${esc(proj.owner_role)}</span>`
    : '';
  document.getElementById('results-title').innerHTML = proj
    ? `<i class="bi bi-folder-fill text-warning me-2"></i>${esc(proj.name)}
       <span class="text-muted fw-normal fs-6 ms-2">by ${esc(proj.owner_username)}${ownerBadge}</span>`
    : '';

  // Reset filters
  document.getElementById('search-input').value     = '';
  document.getElementById('filter-location').value  = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-skill').value     = '';
  document.getElementById('clear-filters-btn').classList.add('d-none');
  document.getElementById('table-footer').textContent = '';
}

function hideResults() {
  selectedPID = null;
  document.getElementById('results-section').classList.add('d-none');
  document.getElementById('export-btn').disabled = true;
}

// ── Init: trigger role dropdown to load all projects on page load ───────────
document.getElementById('role-filter').dispatchEvent(new Event('change'));

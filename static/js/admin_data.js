/* admin_data.js — superadmin role → user → project → contacts cascade */

// ── State ──────────────────────────────────────────────────────────────────

let allContacts = [];   // raw contacts for the selected project
let allProjects = [];   // full project list (fetched on role change)
let allUsers    = [];   // users for the selected role
let selectedPID = null; // currently selected project id

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
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`
    + values.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function populateProjectDropdown(projects) {
  const projSel  = document.getElementById('project-filter');
  const projHint = document.getElementById('project-hint');

  if (!projects.length) {
    projSel.innerHTML = '<option value="">No projects found</option>';
    projSel.disabled  = true;
    projHint.textContent = '';
    return;
  }

  projSel.innerHTML = '<option value="">— Select a project —</option>'
    + projects.map(p =>
        `<option value="${p.id}">${esc(p.owner_username)} › ${esc(p.name)} (${p.contact_count ?? 0} contacts)</option>`
      ).join('');
  projSel.disabled  = false;
  projHint.textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''} found.`;
}

// ── Step 1 — Role ──────────────────────────────────────────────────────────

document.getElementById('role-filter').addEventListener('change', async function () {
  const role     = this.value;
  const userSel  = document.getElementById('user-filter');
  const userHint = document.getElementById('user-hint');
  const projSel  = document.getElementById('project-filter');
  const projHint = document.getElementById('project-hint');

  // Reset all downstream
  userSel.innerHTML = '<option value="">Loading…</option>';
  userSel.disabled  = true;
  projSel.innerHTML = '<option value="">— Select a project —</option>';
  projSel.disabled  = true;
  projHint.textContent = '';
  hideResults();

  // Fetch all projects for this role
  try {
    const params = role ? `?role=${encodeURIComponent(role)}` : '';
    const res    = await fetch('/api/admin/projects' + params);
    allProjects  = await res.json();
  } catch (e) {
    allProjects = [];
  }

  // Fetch users for this role (or build from project owners if "All Roles")
  if (role) {
    try {
      const res = await fetch(`/api/admin/users-by-role?role=${encodeURIComponent(role)}`);
      allUsers  = await res.json();
    } catch (e) {
      allUsers = [];
    }
  } else {
    // Derive unique users from all projects
    const map = {};
    allProjects.forEach(p => {
      if (p.owner_id && !map[p.owner_id]) {
        map[p.owner_id] = { id: p.owner_id, username: p.owner_username, role: p.owner_role };
      }
    });
    allUsers = Object.values(map).sort((a, b) => a.username.localeCompare(b.username));
  }

  if (!allUsers.length) {
    userSel.innerHTML = `<option value="">No users found for this role</option>`;
    userHint.textContent = '';
    return;
  }

  const roleLabel = role || 'user';
  userSel.innerHTML = `<option value="">— All ${roleLabel}s —</option>`
    + allUsers.map(u =>
        `<option value="${u.id}">${esc(u.username)}${roleBadge(u.role)}</option>`
      ).join('');
  userSel.disabled  = false;
  userHint.textContent = `${allUsers.length} user${allUsers.length !== 1 ? 's' : ''} found.`;

  // Populate projects for all users of this role (no specific user yet)
  populateProjectDropdown(allProjects);
});

// ── Step 2 — User ──────────────────────────────────────────────────────────

document.getElementById('user-filter').addEventListener('change', function () {
  const userId  = this.value ? parseInt(this.value, 10) : null;
  const filtered = userId
    ? allProjects.filter(p => p.owner_id === userId)
    : allProjects;

  // Reset project selection and hide results
  document.getElementById('project-filter').value = '';
  hideResults();
  populateProjectDropdown(filtered);
});

// ── Step 3 — Project ───────────────────────────────────────────────────────

document.getElementById('project-filter').addEventListener('change', async function () {
  const pid = this.value;
  if (!pid) { hideResults(); return; }

  selectedPID = parseInt(pid, 10);
  const proj  = allProjects.find(p => p.id === selectedPID);

  // Reset inner filters
  document.getElementById('search-input').value     = '';
  document.getElementById('filter-skill').value     = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-location').value  = '';
  document.getElementById('clear-filters-btn').classList.add('d-none');

  showResultsSection(proj);
  await Promise.all([loadContacts(), loadFilterOptions()]);
});

// ── Load contacts ──────────────────────────────────────────────────────────

async function loadContacts() {
  if (!selectedPID) return;

  const search   = document.getElementById('search-input').value.trim();
  const skill    = document.getElementById('filter-skill').value;
  const jobTitle = document.getElementById('filter-job-title').value;
  const location = document.getElementById('filter-location').value;

  const params = new URLSearchParams();
  if (search)   params.set('search',    search);
  if (skill)    params.set('skill',     skill);
  if (jobTitle) params.set('job_title', jobTitle);
  if (location) params.set('location',  location);

  document.getElementById('clear-filters-btn')
    .classList.toggle('d-none', !(search || skill || jobTitle || location));

  try {
    const res   = await fetch(`/api/projects/${selectedPID}/contacts?` + params.toString());
    allContacts = await res.json();
    renderTable(allContacts);
  } catch (e) {
    document.getElementById('contacts-tbody').innerHTML =
      `<tr><td colspan="11" class="text-center text-danger py-3">Error: ${esc(e.message)}</td></tr>`;
  }
}

// ── Load filter options (Skills → Job Titles → Locations) ─────────────────

async function loadFilterOptions() {
  if (!selectedPID) return;
  try {
    const res = await fetch(`/api/projects/${selectedPID}/filter-options`);
    const { skills, job_titles, locations } = await res.json();
    populateSelect('filter-skill',     skills,     'All Skills');
    populateSelect('filter-job-title', job_titles, 'All Job Titles');
    populateSelect('filter-location',  locations,  'All Locations');
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
        <i class="bi bi-inbox fs-3 d-block mb-2"></i>No contacts match the current filters.
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
    a.download = proj
      ? `${proj.owner_username}_${proj.name}_contacts.xlsx`
      : `project_${selectedPID}_contacts.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Export error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-file-earmark-excel me-1"></i>Download Excel';
  }
});

// ── Search & inner filters ─────────────────────────────────────────────────

let searchDebounce;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadContacts, 300);
});

['filter-skill', 'filter-job-title', 'filter-location'].forEach(id =>
  document.getElementById(id).addEventListener('change', loadContacts)
);

document.getElementById('clear-filters-btn').addEventListener('click', () => {
  document.getElementById('search-input').value     = '';
  document.getElementById('filter-skill').value     = '';
  document.getElementById('filter-job-title').value = '';
  document.getElementById('filter-location').value  = '';
  loadContacts();
});

// ── UI helpers ─────────────────────────────────────────────────────────────

function showResultsSection(proj) {
  document.getElementById('results-section').classList.remove('d-none');
  document.getElementById('export-btn').disabled = false;
  document.getElementById('table-footer').textContent = '';

  const ownerBadge = proj
    ? `<span class="badge ms-2 ${proj.owner_role === 'reseller' ? 'bg-warning text-dark' : proj.owner_role === 'superadmin' ? 'bg-danger' : 'bg-info text-dark'}"
             style="font-size:0.7rem">${esc(proj.owner_role)}</span>`
    : '';
  document.getElementById('results-title').innerHTML = proj
    ? `<i class="bi bi-folder-fill text-warning me-2"></i>${esc(proj.name)}
       <span class="text-muted fw-normal fs-6 ms-2">by ${esc(proj.owner_username)}${ownerBadge}</span>`
    : '';
}

function hideResults() {
  selectedPID = null;
  document.getElementById('results-section').classList.add('d-none');
  document.getElementById('export-btn').disabled = true;
}

// ── Init: load all projects on page load ───────────────────────────────────

(async function init() {
  try {
    const res   = await fetch('/api/admin/projects');
    allProjects = await res.json();

    // Derive all users from project owners
    const map = {};
    allProjects.forEach(p => {
      if (p.owner_id && !map[p.owner_id]) {
        map[p.owner_id] = { id: p.owner_id, username: p.owner_username, role: p.owner_role };
      }
    });
    allUsers = Object.values(map).sort((a, b) => a.username.localeCompare(b.username));

    const userSel  = document.getElementById('user-filter');
    const userHint = document.getElementById('user-hint');
    if (allUsers.length) {
      userSel.innerHTML = `<option value="">— All Users —</option>`
        + allUsers.map(u =>
            `<option value="${u.id}">${esc(u.username)}${roleBadge(u.role)}</option>`
          ).join('');
      userSel.disabled = false;
      userHint.textContent = `${allUsers.length} user${allUsers.length !== 1 ? 's' : ''} found.`;
    } else {
      userSel.innerHTML = '<option value="">No users found</option>';
    }

    populateProjectDropdown(allProjects);
  } catch (e) {
    console.warn('Admin data init error', e);
  }
})();

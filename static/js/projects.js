/* projects.js — project card grid, create, delete */

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function roleBadge(role) {
  if (role === 'superadmin') return '<span class="badge bg-danger ms-1" style="font-size:0.65rem">admin</span>';
  if (role === 'reseller')   return '<span class="badge bg-warning text-dark ms-1" style="font-size:0.65rem">reseller</span>';
  return '<span class="badge bg-info text-dark ms-1" style="font-size:0.65rem">customer</span>';
}

function formatDate(str) {
  if (!str) return '—';
  return str.slice(0, 16).replace('T', ' ');
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderProjects(projects) {
  const grid = document.getElementById('projects-grid');

  if (!projects.length) {
    grid.innerHTML = `
      <div class="col-12 text-center py-5 text-muted">
        <i class="bi bi-folder2 display-4 d-block mb-3 opacity-50"></i>
        <div class="fw-semibold mb-1">No projects yet</div>
        <div class="small mb-3">Create a project to organise your resume uploads</div>
        <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#newProjectModal">
          <i class="bi bi-plus-lg me-1"></i>Create First Project
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = projects.map(p => {
    const ownerHtml = window.IS_SUPERADMIN && p.owner_username
      ? `<div class="small text-muted mt-1">${esc(p.owner_username)}${roleBadge(p.owner_role)}</div>`
      : '';

    const desc = p.description
      ? `<p class="card-text text-muted small mb-2" style="min-height:2.5em">${esc(p.description.slice(0, 100))}${p.description.length > 100 ? '…' : ''}</p>`
      : `<p class="card-text text-muted small mb-2" style="min-height:2.5em"><em>No description</em></p>`;

    return `
      <div class="col-sm-6 col-lg-4" id="proj-card-${p.id}">
        <div class="card border-0 shadow-sm h-100">
          <div class="card-body d-flex flex-column">
            <div class="d-flex align-items-start mb-2">
              <div class="flex-grow-1">
                <h6 class="fw-bold mb-0">
                  <i class="bi bi-folder-fill text-warning me-2"></i>${esc(p.name)}
                </h6>
                ${ownerHtml}
              </div>
              <button class="btn btn-sm btn-outline-danger py-0 px-2 ms-2 flex-shrink-0"
                      onclick="deleteProject(${p.id}, '${esc(p.name)}')" title="Delete project">
                <i class="bi bi-trash3"></i>
              </button>
            </div>
            ${desc}
            <div class="d-flex gap-2 mt-auto mb-3 flex-wrap">
              <span class="badge bg-light text-dark border">
                <i class="bi bi-file-earmark-pdf text-danger me-1"></i>${p.resume_count} resume${p.resume_count !== 1 ? 's' : ''}
              </span>
              <span class="badge bg-light text-dark border">
                <i class="bi bi-person-lines-fill text-primary me-1"></i>${p.contact_count} contact${p.contact_count !== 1 ? 's' : ''}
              </span>
            </div>
            <div class="text-muted small mb-3">
              <i class="bi bi-clock me-1"></i>Created ${formatDate(p.created_at)}
            </div>
            <a href="/projects/${p.id}" class="btn btn-outline-primary btn-sm mt-auto">
              <i class="bi bi-arrow-right-circle me-1"></i>View Contacts
            </a>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Fetch ──────────────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    document.getElementById('projects-loading')?.remove();
    renderProjects(projects);
  } catch (e) {
    document.getElementById('projects-loading').textContent = 'Failed to load projects.';
  }
}

// ── Create ─────────────────────────────────────────────────────────────────

document.getElementById('create-project-btn').addEventListener('click', async () => {
  const nameEl = document.getElementById('project-name');
  const descEl = document.getElementById('project-desc');
  const errEl  = document.getElementById('modal-error');
  const btn    = document.getElementById('create-project-btn');

  const name = nameEl.value.trim();
  if (!name) {
    errEl.textContent = 'Project name is required.';
    errEl.classList.remove('d-none');
    nameEl.focus();
    return;
  }

  errEl.classList.add('d-none');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Creating…';

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: descEl.value.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to create project.';
      errEl.classList.remove('d-none');
    } else {
      // Close modal, reset, reload
      bootstrap.Modal.getInstance(document.getElementById('newProjectModal')).hide();
      nameEl.value = '';
      descEl.value = '';
      loadProjects();
    }
  } catch (e) {
    errEl.textContent = 'Network error: ' + e.message;
    errEl.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-plus-lg me-1"></i>Create Project';
  }
});

// Reset modal error on close
document.getElementById('newProjectModal').addEventListener('hidden.bs.modal', () => {
  document.getElementById('modal-error').classList.add('d-none');
});

// Allow Enter key in name field to submit
document.getElementById('project-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('create-project-btn').click();
});

// ── Delete ─────────────────────────────────────────────────────────────────

async function deleteProject(id, name) {
  if (!confirm(`Delete project "${name}"?\n\nResumes in this project will NOT be deleted — they will just be unassigned from the project.`)) return;
  try {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    document.getElementById(`proj-card-${id}`)?.remove();
    // If grid is empty, reload to show empty state
    if (!document.querySelector('#projects-grid .col-sm-6')) loadProjects();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────

loadProjects();

/* upload.js — drag & drop, file preview, upload, queue polling */

const dropZone    = document.getElementById('drop-zone');
const fileInput   = document.getElementById('file-input');
const fileList    = document.getElementById('file-list');
const uploadBtn   = document.getElementById('upload-btn');
const uploadCount = document.getElementById('upload-count');
const progressArea = document.getElementById('progress-area');
const progressBar  = document.getElementById('progress-bar');
const progressMsg  = document.getElementById('progress-msg');
const resultAlert  = document.getElementById('result-alert');
const queueStatus  = document.getElementById('queue-status');
const projectSel  = document.getElementById('project-select');

// ── Load Projects ──────────────────────────────────────────────────────────

async function loadProjectOptions() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    if (!projects.length) return;
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      projectSel.appendChild(opt);
    });
    // Pre-select if ?project_id= is in URL
    const urlParam = new URLSearchParams(window.location.search).get('project_id');
    if (urlParam) projectSel.value = urlParam;
  } catch (e) { /* ignore — project selector is optional */ }
}

loadProjectOptions();

let selectedFiles = [];

// ── Drop Zone ──────────────────────────────────────────────────────────────

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

['dragleave', 'dragend'].forEach(evt =>
  dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'))
);

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles(Array.from(e.dataTransfer.files));
});

fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';  // reset so same file can be re-added if removed
});

function addFiles(files) {
  const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
  const existing = new Set(selectedFiles.map(f => f.name));
  pdfs.forEach(f => { if (!existing.has(f.name)) selectedFiles.push(f); });
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderFileList() {
  uploadCount.textContent = selectedFiles.length;
  uploadBtn.disabled = selectedFiles.length === 0;

  fileList.innerHTML = selectedFiles.map((f, i) => `
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <span>
        <i class="bi bi-file-earmark-pdf text-danger me-2"></i>
        <span class="fw-medium">${esc(f.name)}</span>
        <span class="text-muted ms-2 small">${formatSize(f.size)}</span>
      </span>
      <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="removeFile(${i})" title="Remove">
        <i class="bi bi-x-lg"></i>
      </button>
    </li>`).join('');
}

// ── Upload ─────────────────────────────────────────────────────────────────

uploadBtn.addEventListener('click', async () => {
  if (!selectedFiles.length) return;

  setUploading(true);

  const formData = new FormData();
  selectedFiles.forEach(f => formData.append('files', f));
  if (projectSel.value) formData.append('project_id', projectSel.value);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    progressBar.style.width = '100%';
    progressBar.classList.remove('progress-bar-animated');

    if (data.error) {
      showAlert('danger', `Upload failed: ${data.error}`);
    } else {
      const msg = `Successfully uploaded ${data.uploaded} file(s).`
        + (data.skipped ? ` ${data.skipped} file(s) skipped (not PDF).` : '')
        + ' Extraction is running in the background.';
      showAlert('success', msg);
      selectedFiles = [];
      renderFileList();
      startPolling();
    }
  } catch (e) {
    showAlert('danger', `Network error: ${e.message}`);
  }

  setUploading(false);
});

function setUploading(active) {
  uploadBtn.disabled = active;
  progressArea.classList.toggle('d-none', !active);
  if (active) {
    progressBar.style.width = '40%';
    progressBar.classList.add('progress-bar-animated');
    progressMsg.textContent = `Uploading ${selectedFiles.length} file(s)...`;
  }
}

// ── Post-upload Polling ────────────────────────────────────────────────────

let pollTimer = null;

function startPolling() {
  queueStatus.classList.remove('d-none');
  document.getElementById('queue-spinner').classList.remove('d-none');
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollQueue, 2000);
  pollQueue();
}

async function pollQueue() {
  try {
    const res = await fetch('/api/status');
    const d = await res.json();

    document.getElementById('queue-badges').innerHTML = `
      <span class="badge bg-success fs-6 px-3">Done: ${d.done}</span>
      <span class="badge bg-warning text-dark fs-6 px-3">Processing: ${d.processing}</span>
      <span class="badge bg-secondary fs-6 px-3">Pending: ${d.pending}</span>
      ${d.failed ? `<span class="badge bg-danger fs-6 px-3">Failed: ${d.failed}</span>` : ''}
    `;

    const busy = (d.pending + d.processing) > 0;
    document.getElementById('queue-note').textContent = busy
      ? 'Extracting contact data — updating every 2 seconds...'
      : 'All files processed. View results on the Dashboard.';
    document.getElementById('queue-spinner').classList.toggle('d-none', !busy);

    if (!busy) clearInterval(pollTimer);
  } catch { /* ignore poll errors */ }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function showAlert(type, msg) {
  resultAlert.className = `alert alert-${type} mt-3 rounded-3`;
  resultAlert.textContent = msg;
  resultAlert.classList.remove('d-none');
}

// Basic setup of variables and all

let processes = [];
let resources = [];
let allocations = [];
let requests = [];
let deadlockedProcesses = new Set();
let deadlockedResources = new Set();
let preventionEnabled = false;
let selectedProcess = null;
let pendingAdd = null;
let previewEl = null;
let draggedNode = null;
let contextTarget = null;

// Select the imp element using element selector
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const contextMenu = document.getElementById('context-menu');
const deleteNodeBtn = document.getElementById('delete-node');
const deleteEdgeBtn = document.getElementById('delete-edge');
const explanationModal = document.getElementById('explanation-modal');
const explanationText = document.getElementById('explanation-text');

const CANVAS_WIDTH = 850;
const CANVAS_HEIGHT = 500;

//Fucntion for updating the system analysis panel
function updateAnalysisPanel() {
    document.getElementById('stat-processes').textContent = processes.length;
    document.getElementById('stat-resources').textContent = resources.length;
    document.getElementById('stat-allocs').textContent = allocations.length;
    document.getElementById('stat-requests').textContent = requests.length;

    //System state
    const badge = document.getElementById('system-state-badge');
    if (deadlockedProcesses.size > 0) {
        badge.textContent = '💀 Deadlock';
        badge.className = 'state-badge danger';
    } else if (requests.length > 0) {
        badge.textContent = '⏳ Waiting';
        badge.className = 'state-badge warning';
    } else {
        badge.textContent = '✅ Safe';
        badge.className = 'state-badge';
    }

    // Resource utilization
    const utilList = document.getElementById('resource-util-list');
    if (resources.length === 0) {
        utilList.innerHTML = '<div class="no-data-msg">No resources yet</div>';
    } else {
        utilList.innerHTML = resources.map(r => {
            const used = allocations.filter(a => a.rId === r.id).length;
            const pct = r.instances > 0 ? Math.round((used / r.instances) * 100) : 0;
            const fillClass = pct === 100 ? 'full' : pct > 0 ? 'partial' : '';
            return `
                <div class="util-row">
                    <div class="util-label">
                        <span>${r.id}</span>
                        <span>${used}/${r.instances} (${pct}%)</span>
                    </div>
                    <div class="util-bar-bg">
                        <div class="util-bar-fill ${fillClass}" style="width:${pct}%"></div>
                    </div>
                </div>`;
        }).join('');
    }

    // Process status
    const procList = document.getElementById('process-status-list');
    if (processes.length === 0) {
        procList.innerHTML = '<div class="no-data-msg">No processes yet</div>';
    } else {
        procList.innerHTML = processes.map(p => {
            let status = 'safe';
            let label = 'Running';
            if (deadlockedProcesses.has(p.id)) {
                status = 'deadlocked'; label = 'Deadlocked';
            } else if (requests.some(r => r.pId === p.id)) {
                status = 'waiting'; label = 'Waiting';
            }
            const held = allocations.filter(a => a.pId === p.id).map(a => a.rId).join(', ') || '—';
            return `
                <div class="proc-row">
                    <div>
                        <span class="proc-id">${p.id}</span>
                        <div style="font-size:0.68rem;color:#5a7a99;margin-top:1px;">Holds: ${held}</div>
                    </div>
                    <span class="proc-pill ${status}">${label}</span>
                </div>`;
        }).join('');
    }
}

// Some small small utility function
function getId(prefix) {
    return `${prefix}${prefix === 'P' ? procCounter++ : resCounter++}`;
}

function getResource(rId) {
    return resources.find(r => r.id === rId);
}

function isAvailable(rId) {
    const r = getResource(rId);
    const allocated = allocations.filter(a => a.rId === rId).length;
    return r && allocated < r.instances;
}

function updateStatus(msg) {
    statusEl.textContent = msg;
}

// Function for deleting the process
function deleteProcess(pId) {
    processes = processes.filter(p => p.id !== pId);
    allocations = allocations.filter(a => a.pId !== pId);
    requests = requests.filter(r => r.pId !== pId);
    if (selectedProcess === pId) selectedProcess = null;
    updateStatus(`🗑️ Deleted process ${pId}`);
    render();
    setTimeout(() => checkForDeadlock(false), 300);
}

// Function for deleting the resource
function deleteResource(rId) {
    resources = resources.filter(r => r.id !== rId);
    allocations = allocations.filter(a => a.rId !== rId);
    requests = requests.filter(r => r.rId !== rId);
    updateStatus(`🗑️ Deleted resource ${rId}`);
    render();
    setTimeout(() => checkForDeadlock(false), 300);
}

// Function for deleting the connection
function deleteConnection(pId, rId) {
    allocations = allocations.filter(a => !(a.pId === pId && a.rId === rId));
    requests = requests.filter(r => !(r.pId === pId && r.rId === rId));
    updateStatus(`🗑️ Deleted connection: ${pId} ↔ ${rId}`);
    render();
    setTimeout(() => checkForDeadlock(false), 300);
}

// Function for showing the context menu
function showContextMenu(x, y, type, data) {
    contextTarget = { type, data };
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    
    if (type === 'node') {
        deleteNodeBtn.style.display = 'block';
        deleteEdgeBtn.style.display = 'none';
    } else if (type === 'edge') {
        deleteNodeBtn.style.display = 'none';
        deleteEdgeBtn.style.display = 'block';
    }
    
    contextMenu.style.display = 'flex';
    
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu);
    }, 100);
}

// Function for hhiding the context menu
function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextTarget = null;
    document.removeEventListener('click', hideContextMenu);
}
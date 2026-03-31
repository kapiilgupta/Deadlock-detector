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

// Function for hiding the context menu
function hideContextMenu() {
    contextMenu.style.display = 'none';
    contextTarget = null;
    document.removeEventListener('click', hideContextMenu);
}

// Add listener for click event on delete node btn
deleteNodeBtn.onclick = () => {
    if (contextTarget?.type === 'node') {
        if (contextTarget.data.type === 'process') {
            deleteProcess(contextTarget.data.id);
        } else {
            deleteResource(contextTarget.data.id);
        }
    }
    hideContextMenu();
};

// Add listener for click event on delete edge btn
deleteEdgeBtn.onclick = () => {
    if (contextTarget?.type === 'edge') {
        deleteConnection(contextTarget.data.pId, contextTarget.data.rId);
    }
    hideContextMenu();
};

// Function for managing the node and connection
function enterPlacementMode(type) {
    pendingAdd = type;
    canvas.style.cursor = 'crosshair';
    updateStatus(`Click on canvas to place a new ${type}.`);
    canvas.addEventListener('mousemove', showPreview);
    canvas.addEventListener('click', placeNode);
}

//Function for showing the preview
function showPreview(e) {
    const rect = canvas.getBoundingClientRect();
    const size = pendingAdd === 'resource' ? 27 : 30;
    const x = e.clientX - rect.left - size;
    const y = e.clientY - rect.top - size;
    if (previewEl) previewEl.remove();
    previewEl = document.createElement('div');
    previewEl.className = 'preview';
    previewEl.style.left = `${x}px`;
    previewEl.style.top = `${y}px`;
    if (pendingAdd === 'resource') {
        previewEl.style.width = '55px';
        previewEl.style.height = '55px';
        previewEl.style.border = '2px dashed #ff6b6b';
    }
    canvas.appendChild(previewEl);
}

//Function for placing the nodes in canvas
function placeNode(e) {
    if (!pendingAdd) return;
    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    x = Math.max(30, Math.min(CANVAS_WIDTH - 30, x));
    y = Math.max(30, Math.min(CANVAS_HEIGHT - 30, y));

    if (pendingAdd === 'process') {
        const id = getId('P');
        processes.push({ id, x, y });
        updateStatus(`✅ Placed ${id}`);
    } else {
        const id = getId('R');
        resources.push({ id, x, y, instances: 1 });
        updateStatus(`✅ Placed ${id}`);
    }
    exitPlacementMode();
    render();
}


function exitPlacementMode() {
    pendingAdd = null;
    canvas.style.cursor = 'default';
    if (previewEl) previewEl.remove();
    previewEl = null;
    canvas.removeEventListener('mousemove', showPreview);
    canvas.removeEventListener('click', placeNode);
}

function makeDraggable(el, node, isProcess) {
    el.addEventListener('mousedown', (e) => {
        if (e.button === 2) return;
        if (pendingAdd) return;
        e.stopPropagation();
        draggedNode = { el, node, isProcess };
        const rect = el.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        canvas.style.cursor = 'grabbing';
        el.style.zIndex = '10';
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup', dragEnd);
    });

    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(
            e.clientX,
            e.clientY,
            'node',
            { id: node.id, type: isProcess ? 'process' : 'resource' }
        );
    });
}

function dragMove(e) {
    if (!draggedNode) return;
    const canvasRect = canvas.getBoundingClientRect();
    let x = e.clientX - canvasRect.left - dragOffsetX;
    let y = e.clientY - canvasRect.top - dragOffsetY;
    x = Math.max(30, Math.min(CANVAS_WIDTH - 30, x));
    y = Math.max(30, Math.min(CANVAS_HEIGHT - 30, y));
    draggedNode.node.x = x;
    draggedNode.node.y = y;
    render();
}

function dragEnd() {
    if (draggedNode) {
        draggedNode.el.style.zIndex = '';
        draggedNode = null;
        canvas.style.cursor = 'default';
    }
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
}
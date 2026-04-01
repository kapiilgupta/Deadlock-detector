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

//Function for creating the edge 
function createEdge(pId, rId, isRequest = false) {
    if (preventionEnabled && isRequest) {
        const orderedRes = [...resources].sort((a, b) => a.id.localeCompare(b.id)).map(r => r.id);
        const held = allocations.filter(a => a.pId === pId).map(a => a.rId);
        const maxHeldIndex = held.length > 0 ? Math.max(...held.map(id => orderedRes.indexOf(id))) : -1;
        const newResIndex = orderedRes.indexOf(rId);
        if (newResIndex <= maxHeldIndex) {
            updateStatus(`🛡️ Prevention blocked: ${pId} can't request ${rId}.`);
            return false;
        }
    }

    if (isRequest) {
        if (!requests.some(req => req.pId === pId && req.rId === rId)) {
            requests.push({ pId, rId });
            updateStatus(`⏳ ${pId} → REQUEST → ${rId}`);
        }
    } else {
        if (isAvailable(rId)) {
            allocations.push({ pId, rId });
            updateStatus(`✅ ${pId} → ALLOCATED → ${rId}`);
        } else {
            if (!requests.some(req => req.pId === pId && req.rId === rId)) {
                requests.push({ pId, rId });
            }
            updateStatus(`⚠️ ${rId} busy → request queued.`);
        }
    }
    render();
    return true;
}

//Function for detecting the deadlock
function checkForDeadlock(showToast = true) {
    deadlockedProcesses = new Set();
    deadlockedResources = new Set();

    const wfGraph = {};
    const heldBy = {};
    const waitingFor = {};

    processes.forEach(p => {
        wfGraph[p.id] = new Set();
        waitingFor[p.id] = [];
    });

    allocations.forEach(a => {
        heldBy[a.rId] = a.pId;
    });

    requests.forEach(req => {
        waitingFor[req.pId].push(req.rId);
        const holder = heldBy[req.rId];
        if (holder && holder !== req.pId) {
            wfGraph[req.pId].add(holder);
        }
    });

    const visited = new Set();
    const recStack = new Set();
    const inCycle = new Set();

    function dfs(node) {
        visited.add(node);
        recStack.add(node);
        for (const neighbor of wfGraph[node] || []) {
            if (!visited.has(neighbor)) {
                if (dfs(neighbor)) {
                    inCycle.add(node);
                    return true;
                }
            } else if (recStack.has(neighbor)) {
                inCycle.add(node);
                inCycle.add(neighbor);
                return true;
            }
        }
        recStack.delete(node);
        return false;
    }

    for (const p of processes) {
        if (!visited.has(p.id)) dfs(p.id);
    }

    deadlockedProcesses = inCycle;

    if (deadlockedProcesses.size === 0) {
        if (showToast) updateStatus("✅ No deadlock detected.");
        render();
        updateAnalysisPanel();
        return false;
    }

    deadlockedProcesses.forEach(pId => {
        allocations.filter(a => a.pId === pId).forEach(a => deadlockedResources.add(a.rId));
        (waitingFor[pId] || []).forEach(rId => deadlockedResources.add(rId));
    });

    const cycle = Array.from(deadlockedProcesses);
    let msg = "🔴 DEADLOCK:\n";
    cycle.forEach(p => {
        const held = allocations.filter(a => a.pId === p).map(a => a.rId).join(', ') || 'none';
        const waits = waitingFor[p].join(', ') || 'none';
        msg += `\n• ${p} holds [${held}], waits for [${waits}]`;
    });
    msg += "\n\n💡 Circular wait detected!";
    explanationText.textContent = msg;
    explanationModal.style.display = 'flex';
    render();
    updateAnalysisPanel();
    return true;
}

//Function for recover the deadlock
function recover() {
    if (deadlockedProcesses.size === 0) return;
    const victim = Array.from(deadlockedProcesses)[0];
    allocations = allocations.filter(a => a.pId !== victim);
    requests = requests.filter(r => r.pId !== victim);
    deadlockedProcesses = new Set();
    deadlockedResources = new Set();
    render();
    for (let i = requests.length - 1; i >= 0; i--) {
        const req = requests[i];
        if (isAvailable(req.rId)) {
            allocations.push({ pId: req.pId, rId: req.rId });
            requests.splice(i, 1);
        }
    }
    setTimeout(() => {
        updateStatus(`✅ Recovered by terminating ${victim}.`);
        checkForDeadlock(false);
        updateAnalysisPanel();
    }, 600);
}

// Function for rendering
function render() {
    canvas.innerHTML = '';
    if (previewEl) canvas.appendChild(previewEl);

    [...allocations, ...requests].forEach(link => {
        const p = processes.find(pr => pr.id === link.pId);
        const r = resources.find(rs => rs.id === link.rId);
        if (!p || !r) return;

        const dx = r.x - p.x;
        const dy = r.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        const edge = document.createElement('div');
        edge.className = 'edge';
        if (requests.some(req => req.pId === link.pId && req.rId === link.rId)) {
            edge.classList.add('request-edge');
        }
        if (deadlockedProcesses.has(link.pId) && deadlockedResources.has(link.rId)) {
            edge.classList.add('deadlock-edge');
        }
        edge.style.width = `${len}px`;
        edge.style.left = `${p.x}px`;
        edge.style.top = `${p.y}px`;
        edge.style.transform = `rotate(${angle}deg)`;

        edge.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, 'edge', { pId: link.pId, rId: link.rId });
        });

        canvas.appendChild(edge);
    });

    resources.forEach(res => {
        const el = document.createElement('div');
        el.className = 'node resource';
        const used = allocations.filter(a => a.rId === res.id).length;
        el.innerHTML = `${res.id}<br>(${used}/${res.instances})`;
        el.style.left = `${res.x - 27}px`;
        el.style.top = `${res.y - 27}px`;
        if (deadlockedResources.has(res.id)) {
            el.classList.add('deadlocked-resource');
        }
        el.addEventListener('click', (e) => {
            if (selectedProcess && !draggedNode) {
                createEdge(selectedProcess, res.id, e.shiftKey);
                selectedProcess = null;
                render();
            }
        });
        makeDraggable(el, res, false);
        canvas.appendChild(el);
    });

    processes.forEach(proc => {
        const el = document.createElement('div');
        el.className = 'node process';
        el.textContent = proc.id;
        el.style.left = `${proc.x - 30}px`;
        el.style.top = `${proc.y - 30}px`;
        if (deadlockedProcesses.has(proc.id)) {
            el.classList.add('deadlocked-process');
        }
        if (selectedProcess === proc.id && !deadlockedProcesses.has(proc.id)) {
            el.style.boxShadow = '0 0 0 3px #ffff00';
        }
        el.addEventListener('click', (e) => {
            if (draggedNode) return;
            e.stopPropagation();
            selectedProcess = proc.id;
            render();
            updateStatus(`Selected ${proc.id}. Click resource. Hold SHIFT for REQUEST.`);
        });
        makeDraggable(el, proc, true);
        canvas.appendChild(el);
    });

    const handleBgClick = (e) => {
        if (e.target === canvas && !pendingAdd && !draggedNode) {
            selectedProcess = null;
            render();
            updateStatus("Click a process, then a resource. Hold Shift for request.");
        }
        canvas.removeEventListener('click', handleBgClick);
    };
    if (!pendingAdd && !draggedNode) {
        canvas.addEventListener('click', handleBgClick);
    }

    updateAnalysisPanel();
}

//Basic listeners of buttons
document.getElementById('addProcBtn').addEventListener('click', () => {
    exitPlacementMode();
    enterPlacementMode('process');
});

document.getElementById('addResBtn').addEventListener('click', () => {
    exitPlacementMode();
    enterPlacementMode('resource');
});

document.getElementById('detectBtn').addEventListener('click', () => {
    checkForDeadlock(true);
});

const connModal = document.getElementById('conn-modal');
const connProcSelect = document.getElementById('conn-proc-select');
const connResSelect = document.getElementById('conn-res-select');
const typeAllocBtn = document.getElementById('typeAllocBtn');
const typeReqBtn = document.getElementById('typeReqBtn');
let connIsRequest = false;

typeAllocBtn.addEventListener('click', () => {
    connIsRequest = false;
    typeAllocBtn.className = 'conn-type-btn allocate active-alloc';
    typeReqBtn.className = 'conn-type-btn request';
});

typeReqBtn.addEventListener('click', () => {
    connIsRequest = true;
    typeReqBtn.className = 'conn-type-btn request active-req';
    typeAllocBtn.className = 'conn-type-btn allocate';
});

document.getElementById('addConnBtn').addEventListener('click', () => {
    if (processes.length === 0 || resources.length === 0) {
        updateStatus("⚠️ Add at least one process and one resource first.");
        return;
    }
    
    connProcSelect.innerHTML = processes.map(p => `<option value="${p.id}">${p.id}</option>`).join('');
    connResSelect.innerHTML = resources.map(r => `<option value="${r.id}">${r.id} (${allocations.filter(a => a.rId === r.id).length}/${r.instances})</option>`).join('');
    
    connIsRequest = false;
    typeAllocBtn.className = 'conn-type-btn allocate active-alloc';
    typeReqBtn.className = 'conn-type-btn request';
    connModal.style.display = 'flex';
});

document.getElementById('connCancelBtn').addEventListener('click', () => {
    connModal.style.display = 'none';
});

document.getElementById('connSubmitBtn').addEventListener('click', () => {
    const pId = connProcSelect.value;
    const rId = connResSelect.value;
    if (!pId || !rId) {
        updateStatus("⚠️ Select both a process and a resource.");
        return;
    }
    connModal.style.display = 'none';
    createEdge(pId, rId, connIsRequest);
});

document.getElementById('resetBtn').addEventListener('click', () => {
    exitPlacementMode();
    draggedNode = null;
    processes = [];
    resources = [];
    allocations = [];
    requests = [];
    deadlockedProcesses = new Set();
    deadlockedResources = new Set();
    preventionEnabled = false;
    selectedProcess = null;
    procCounter = 0;
    resCounter = 0;
    document.getElementById('togglePreventBtn').textContent = "🛡️ Prevention: OFF";
    explanationModal.style.display = 'none';
    updateStatus("✅ Simulation cleared.");
    render();
});

document.getElementById('togglePreventBtn').addEventListener('click', () => {
    preventionEnabled = !preventionEnabled;
    document.getElementById('togglePreventBtn').textContent =
        `🛡️ Prevention: ${preventionEnabled ? 'ON' : 'OFF'}`;
    updateStatus(`Prevention ${preventionEnabled ? 'enabled' : 'disabled'}.`);
    updateAnalysisPanel();
});

document.getElementById('closeModal').addEventListener('click', () => {
    explanationModal.style.display = 'none';
    recover();
});

//Basic Deadlock example (Initial state)
processes = [
    { id: 'P0', x: 250, y: 150 },
    { id: 'P1', x: 550, y: 150 }
];
resources = [
    { id: 'R0', x: 320, y: 380, instances: 1 },
    { id: 'R1', x: 480, y: 380, instances: 1 }
];
allocations = [
    { pId: 'P0', rId: 'R0' }, 
    { pId: 'P1', rId: 'R1' }
];
requests = [
    { pId: 'P0', rId: 'R1' }, 
    { pId: 'P1', rId: 'R0' }
];

procCounter = 2;
resCounter = 2;
updateStatus("✅ Ready! Right-click on any element to delete it.");
render();
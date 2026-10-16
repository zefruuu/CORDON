const MAP_CENTER = [50.4501, 30.5234];
const MAP_ZOOM = 18;
const DEFAULT_RADIUS = 7;

const DEFAULT_NODES = {
    1: { name: "SENSOR-01", coords: [50.45025, 30.52315], radius: 7 },
    2: { name: "SENSOR-02", coords: [50.45010, 30.52340], radius: 7 },
    3: { name: "SENSOR-03", coords: [50.44995, 30.52365], radius: 7 }
};

let NODES_CONFIG = loadNodesFromStorage();

const FLAG_SEISMIC = 1 << 0;
const FLAG_RADAR   = 1 << 1;
const FLAG_METAL   = 1 << 2;
const FLAG_TAMPER  = 1 << 3;

const MSG_HEARTBEAT = 1;
const MSG_ALARM     = 2;
const MSG_TAMPER    = 3;

const map = L.map('map', {
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    zoomControl: false
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

L.tileLayer('static/tiles/{z}/{x}/{y}.png', {
    maxZoom: 19,
    minZoom: 12,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}).addTo(map);

const nodeMarkers = {};
let isPlacementMode = false;

const statusBadge     = document.getElementById('system-status');
const eventDesc       = document.getElementById('event-desc');
const eventLog        = document.getElementById('event-log');
const btnAddSensor    = document.getElementById('btn-add-sensor');
const btnDeployCoords = document.getElementById('btn-deploy-coords');
const btnClearNodes   = document.getElementById('btn-clear-sensors');
const inputLat        = document.getElementById('input-lat');
const inputLng        = document.getElementById('input-lng');
const inputRad        = document.getElementById('input-rad');
const mapContainer    = document.getElementById('map');

inputLat.value = MAP_CENTER[0].toFixed(5);
inputLng.value = MAP_CENTER[1].toFixed(5);

function loadNodesFromStorage() {
    try {
        const saved = localStorage.getItem('cordon_nodes_v2');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULT_NODES));
}

function saveNodesToStorage() {
    try {
        localStorage.setItem('cordon_nodes_v2', JSON.stringify(NODES_CONFIG));
    } catch (e) {}
}

function getNextSensorId() {
    let id = 1;
    while (NODES_CONFIG[id]) {
        id++;
    }
    return id;
}

function getValidatedRadius() {
    let r = parseFloat(inputRad.value);
    if (isNaN(r)) r = DEFAULT_RADIUS;
    if (r < 5) r = 5;
    if (r > 10) r = 10;
    inputRad.value = r;
    return r;
}

function renderSensorNode(id, node) {
    if (nodeMarkers[id]) {
        map.removeLayer(nodeMarkers[id].zone);
        map.removeLayer(nodeMarkers[id].dot);
    }

    const radius = node.radius || DEFAULT_RADIUS;

    const zoneCircle = L.circle(node.coords, {
        color: '#00ff66',
        fillColor: '#00ff66',
        fillOpacity: 0.18,
        weight: 1.5,
        radius: radius
    }).addTo(map);

    const centerDot = L.circleMarker(node.coords, {
        radius: 5,
        color: '#ffffff',
        fillColor: '#00ff66',
        fillOpacity: 1,
        weight: 2
    }).addTo(map);

    centerDot.bindPopup(`
        <div style="font-family: monospace; font-size: 12px;">
            <b>${node.name}</b><br>
            ID: #${id} | Radius: ${radius}m<br>
            Coords: ${node.coords[0].toFixed(5)}, ${node.coords[1].toFixed(5)}<br>
            Status: <span id="popup-status-${id}">STANDBY</span><br>
            BAT: <span id="popup-bat-${id}">--</span> V<br>
            <span style="color:#8899a6; font-size:10px;">(Right-click dot to remove)</span>
        </div>
    `);

    centerDot.on('contextmenu', () => {
        removeSensorNode(id);
    });

    nodeMarkers[id] = {
        zone: zoneCircle,
        dot: centerDot,
        resetTimer: null
    };
}

function createSensorAt(lat, lng) {
    const newId = getNextSensorId();
    const paddedId = String(newId).padStart(2, '0');
    const radius = getValidatedRadius();
    const coords = [lat, lng];

    const newNode = {
        name: `SENSOR-${paddedId}`,
        coords: coords,
        radius: radius
    };

    NODES_CONFIG[newId] = newNode;
    saveNodesToStorage();
    renderSensorNode(newId, newNode);

    addLogEntry(
        `Deployed ${newNode.name} (R=${radius}m) at [${lat.toFixed(5)}, ${lng.toFixed(5)}]`,
        '#00ff66'
    );
}

function removeSensorNode(id) {
    const markerObj = nodeMarkers[id];
    if (markerObj) {
        if (markerObj.resetTimer) {
            clearTimeout(markerObj.resetTimer);
        }
        map.removeLayer(markerObj.zone);
        map.removeLayer(markerObj.dot);
        delete nodeMarkers[id];
    }
    const name = NODES_CONFIG[id] ? NODES_CONFIG[id].name : `NODE-${id}`;
    delete NODES_CONFIG[id];
    saveNodesToStorage();
    addLogEntry(`${name} removed from map`, '#8899a6');
}

function renderAllNodes() {
    for (const [id, node] of Object.entries(NODES_CONFIG)) {
        renderSensorNode(Number(id), node);
    }
}

renderAllNodes();

function setPlacementMode(active) {
    isPlacementMode = active;
    if (isPlacementMode) {
        const nextId = getNextSensorId();
        btnAddSensor.classList.add('active');
        btnAddSensor.textContent = `CLICK MAP (#${nextId})`;
        mapContainer.classList.add('placing-cursor');
    } else {
        btnAddSensor.classList.remove('active');
        btnAddSensor.textContent = '+ MAP CLICK [N]';
        mapContainer.classList.remove('placing-cursor');
    }
}

btnAddSensor.addEventListener('click', () => {
    setPlacementMode(!isPlacementMode);
});

btnDeployCoords.addEventListener('click', () => {
    const lat = parseFloat(inputLat.value);
    const lng = parseFloat(inputLng.value);
    if (isNaN(lat) || isNaN(lng)) {
        addLogEntry('Invalid coordinates input', '#ff3333');
        return;
    }
    createSensorAt(lat, lng);
    map.panTo([lat, lng], { animate: true, duration: 0.4 });
});

[inputLat, inputLng, inputRad].forEach((inputEl) => {
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            btnDeployCoords.click();
        }
    });
});

document.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'n' || e.key === 'N') {
        setPlacementMode(!isPlacementMode);
    } else if (e.key === 'Escape' && isPlacementMode) {
        setPlacementMode(false);
    }
});

btnClearNodes.addEventListener('click', () => {
    if (Object.keys(NODES_CONFIG).length === 0) {
        addLogEntry('No sensor nodes on map to clear', '#8899a6');
        return;
    }

    const numA = Math.floor(Math.random() * 90) + 10;
    const numB = Math.floor(Math.random() * 90) + 10;
    const expectedSum = numA + numB;

    const userInput = window.prompt(
        `SECURITY CONFIRMATION: Clear all sensor nodes?\nEnter the sum to confirm: ${numA} + ${numB} = ?`
    );

    if (userInput === null) {
        addLogEntry('Clear operation cancelled', '#8899a6');
        return;
    }

    if (parseInt(userInput.trim(), 10) !== expectedSum) {
        addLogEntry('Clear aborted: incorrect verification sum!', '#ff3333');
        playTacticalBeep(300, 250, 'sawtooth');
        return;
    }

    for (const id of Object.keys(nodeMarkers)) {
        if (nodeMarkers[id].resetTimer) {
            clearTimeout(nodeMarkers[id].resetTimer);
        }
        map.removeLayer(nodeMarkers[id].zone);
        map.removeLayer(nodeMarkers[id].dot);
        delete nodeMarkers[id];
    }
    NODES_CONFIG = {};
    saveNodesToStorage();
    addLogEntry('All sensor nodes cleared', '#ffcc00');
    if (isPlacementMode) {
        setPlacementMode(true);
    }
});

map.on('click', (e) => {
    inputLat.value = e.latlng.lat.toFixed(5);
    inputLng.value = e.latlng.lng.toFixed(5);

    if (!isPlacementMode) return;

    createSensorAt(e.latlng.lat, e.latlng.lng);
    setPlacementMode(false);
});

let audioCtx = null;

function playTacticalBeep(frequency = 880, durationMs = 180, type = 'sawtooth') {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + durationMs / 1000);
    } catch (e) {
        console.warn("Audio blocked until user interaction.");
    }
}

function triggerAlarmSound(isArmedIntruder) {
    if (isArmedIntruder) {
        playTacticalBeep(1200, 160, 'sawtooth');
        setTimeout(() => playTacticalBeep(1600, 250, 'sawtooth'), 200);
    } else {
        playTacticalBeep(750, 200, 'square');
    }
}

function addLogEntry(text, color = '#8899a6') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const entry = document.createElement('div');
    entry.style.color = color;
    entry.style.marginBottom = '4px';
    entry.style.borderBottom = '1px solid #141a24';
    entry.style.paddingBottom = '2px';
    entry.innerHTML = `<span style="color:#4a90e2">[${timeStr}]</span> ${text}`;

    eventLog.prepend(entry);
}

function handleGatewayPacket(data) {
    const nodeId = data.id;
    const nodeInfo = NODES_CONFIG[nodeId] || { name: `NODE-${nodeId}`, coords: MAP_CENTER };
    const flags = data.flags || 0;

    const hasPir    = Boolean(flags & FLAG_SEISMIC);
    const hasRadar  = Boolean(flags & FLAG_RADAR) || Boolean(data.radar);
    const hasMetal  = Boolean(flags & FLAG_METAL) || Boolean(data.metal);
    const hasTamper = Boolean(flags & FLAG_TAMPER) || (data.type === MSG_TAMPER);

    if (data.type === MSG_HEARTBEAT) {
        addLogEntry(
            `${nodeInfo.name}: OK (BAT: ${data.bat}V, Hops: ${data.hops})`,
            '#00ff66'
        );
        return;
    }

    let threatColor = '#ffcc00';
    let threatTitle = 'THERMAL CONTACT (PIR)';
    let isCritical  = false;

    if (hasTamper) {
        threatColor = '#ff00ff';
        threatTitle = 'TAMPER / ENCLOSURE BREACH!';
        isCritical  = true;
    } else if (hasRadar && hasMetal) {
        threatColor = '#ff3333';
        threatTitle = 'ARMED INTRUDER / VEHICLE (PIR+RADAR+METAL)';
        isCritical  = true;
    } else if (hasRadar) {
        threatColor = '#ff8800';
        threatTitle = 'BIO-TARGET MOTION (PIR+RADAR)';
        isCritical  = false;
    }

    statusBadge.textContent = isCritical ? 'ALARM // BREACH' : 'WARNING';
    statusBadge.classList.add('status-alarm');

    const routeInfo = data.hops > 0 ? `via repeater (${data.hops} hop)` : 'direct link';
    eventDesc.innerHTML = `
        <b style="color:${threatColor}">${nodeInfo.name}</b><br>
        ${threatTitle}<br>
        <span style="color:#6c7a89">Link: ${routeInfo} | BAT: ${data.bat}V</span>
    `;

    addLogEntry(`${nodeInfo.name} -> ${threatTitle} [bat:${data.bat}V, hops:${data.hops}]`, threatColor);
    triggerAlarmSound(isCritical);

    const markerObj = nodeMarkers[nodeId];
    if (markerObj) {
        markerObj.zone.setStyle({
            color: threatColor,
            fillColor: threatColor,
            fillOpacity: 0.45
        });
        markerObj.dot.setStyle({
            fillColor: threatColor
        });

        map.panTo(nodeInfo.coords, { animate: true, duration: 0.6 });

        if (markerObj.resetTimer) {
            clearTimeout(markerObj.resetTimer);
        }

        markerObj.resetTimer = setTimeout(() => {
            markerObj.zone.setStyle({
                color: '#00ff66',
                fillColor: '#00ff66',
                fillOpacity: 0.18
            });
            markerObj.dot.setStyle({
                fillColor: '#00ff66'
            });
            statusBadge.textContent = 'MONITORING';
            statusBadge.classList.remove('status-alarm');
        }, 8000);
    }
}

function connectWebSocket() {
    const ws = new WebSocket('ws://localhost:8765');

    ws.onopen = () => {
        addLogEntry('Gateway link (WebSocket :8765) established', '#00ff66');
        statusBadge.textContent = 'MONITORING';
        statusBadge.classList.remove('status-alarm');
    };

    ws.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            handleGatewayPacket(packet);
        } catch (err) {
            console.error('JSON parse error:', err, event.data);
        }
    };

    ws.onclose = () => {
        addLogEntry('Gateway link lost. Reconnecting in 3s...', '#ffcc00');
        statusBadge.textContent = 'OFFLINE';
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        ws.close();
    };
}

connectWebSocket();

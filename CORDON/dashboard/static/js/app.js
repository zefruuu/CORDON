const MAP_CENTER = [50.4501, 30.5234];
const MAP_ZOOM = 16;

const NODES_CONFIG = {
    1: { name: "SENSOR-01 (North)", coords: [50.4520, 30.5210], radius: 60 },
    2: { name: "SENSOR-02 (Trail)", coords: [50.4495, 30.5255], radius: 60 },
    3: { name: "SENSOR-03 (South)", coords: [50.4478, 30.5220], radius: 60 }
};

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
    maxZoom: 18,
    minZoom: 12,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
}).addTo(map);

const nodeMarkers = {};

for (const [id, node] of Object.entries(NODES_CONFIG)) {
    const zoneCircle = L.circle(node.coords, {
        color: '#00ff66',
        fillColor: '#00ff66',
        fillOpacity: 0.12,
        weight: 1.5,
        radius: node.radius
    }).addTo(map);

    const centerDot = L.circleMarker(node.coords, {
        radius: 6,
        color: '#ffffff',
        fillColor: '#00ff66',
        fillOpacity: 1,
        weight: 2
    }).addTo(map);

    centerDot.bindPopup(`
        <div style="font-family: monospace; font-size: 12px;">
            <b>${node.name}</b><br>
            ID: #${id}<br>
            Status: <span id="popup-status-${id}">STANDBY</span><br>
            BAT: <span id="popup-bat-${id}">--</span> V
        </div>
    `);

    nodeMarkers[id] = {
        zone: zoneCircle,
        dot: centerDot,
        resetTimer: null
    };
}

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

const statusBadge = document.getElementById('system-status');
const eventDesc   = document.getElementById('event-desc');
const eventLog    = document.getElementById('event-log');

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
                fillOpacity: 0.12
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

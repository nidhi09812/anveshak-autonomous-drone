import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, Polygon } from 'react-leaflet';
import L from 'leaflet';
import { Activity, Battery, AlertTriangle, Crosshair, MapPin, MousePointer2, Home, ShieldAlert, UploadCloud } from 'lucide-react';
import { detectImage } from '../api.js';

// Icons/order for the per-class detection tally, matching Laptop 1's
// upload-page class legend so both screens read the same way.
const CLASS_TALLY = [
  { key: 'person', label: 'Person', icon: '👤' },
  { key: 'fire', label: 'Fire', icon: '🔥' },
  { key: 'flood', label: 'Flood', icon: '🌊' },
  { key: 'vehicle', label: 'Vehicle', icon: '🚗' },
];

// Fixed Rescue Command "Home Base" — also where the drone launches from.
const HOME_BASE = [23.0330, 72.5466];

// How close (in map degrees) an earlier hazard has to be to the straight
// home -> target line before the Safe Path bends around it.
// ~0.0009 deg is roughly 100m at this latitude — good enough for a
// prototype visualization, not a survey-grade distance calc.
const HAZARD_CLEARANCE_DEG = 0.0009;

const droneIcon = L.divIcon({
  className: 'custom-icon',
  html: `<div style="background-color: #06b6d4; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px #06b6d4;"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const homeBaseIcon = L.divIcon({
  className: 'custom-home-icon',
  html: `<div style="background-color: #10b981; width: 26px; height: 26px; border-radius: 6px; border: 2px solid white; display:flex; align-items:center; justify-content:center; box-shadow: 0 0 10px #10b981; font-size: 14px;">🏠</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13]
});

const createTargetIcon = (num) => L.divIcon({
  className: 'custom-target-icon',
  html: `<div style="background-color: #ef4444; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px; box-shadow: 0 0 8px #ef4444;">${num}</div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Marker colors follow the survivor/hazard/critical rule: a pure hazard
// (fire or flood, no person) is orange, a pure survivor is red (see
// createTargetIcon), and a survivor co-located with a hazard is a
// distinct dark red/brown "critical" marker so the operator can spot a
// person trapped in danger at a glance.
const HAZARD_ICON = { fire: '🔥', flood: '🌊' };
const HAZARD_COLOR = '#f97316';
const CRITICAL_COLOR = '#7c2d12';

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Tailwind classes for the Target Event Log entries, keyed by category —
// mirrors the marker colors (survivor red, hazard orange, critical dark
// red/brown) so the log and map read as one system.
const LOG_STYLE = {
  survivor: { border: 'border-red-500', text: 'text-red-400', badge: 'bg-red-500' },
  hazard: { border: 'border-orange-500', text: 'text-orange-400', badge: 'bg-orange-500' },
  critical: { border: 'border-[#7c2d12]', text: 'text-[#c2410c]', badge: 'bg-[#7c2d12]' },
  vehicle: { border: 'border-slate-500', text: 'text-slate-300', badge: 'bg-slate-500' },
};

const createHazardMarkerIcon = (hazardTypes) => {
  const icon = hazardTypes.length === 1 ? (HAZARD_ICON[hazardTypes[0]] || '⚠') : '⚠';
  return L.divIcon({
    className: 'custom-hazard-icon',
    html: `<div style="background-color: ${HAZARD_COLOR}; width: 24px; height: 24px; border-radius: 6px; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-size: 12px; box-shadow: 0 0 8px ${HAZARD_COLOR};">${icon}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
};

const createCriticalIcon = (num) => L.divIcon({
  className: 'custom-critical-icon',
  html: `<div style="background-color: ${CRITICAL_COLOR}; width: 26px; height: 26px; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 11px; box-shadow: 0 0 10px ${CRITICAL_COLOR};">${num}</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13]
});

const vehicleIcon = L.divIcon({
  className: 'custom-vehicle-icon',
  html: `<div style="background-color: #64748b; width: 22px; height: 22px; border-radius: 6px; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-size: 11px; box-shadow: 0 0 6px #64748b;">🚗</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

function markerIconFor(target) {
  if (target.category === 'critical') return createCriticalIcon(target.id);
  if (target.category === 'survivor') return createTargetIcon(target.id);
  if (target.category === 'vehicle') return vehicleIcon;
  return createHazardMarkerIcon(target.hazardTypes);
}

function MapClickCatch({ onMapClick, isActive }) {
  useMapEvents({
    click(e) {
      if (isActive) onMapClick([e.latlng.lat, e.latlng.lng]);
    }
  });
  return null;
}

// --- Safe-Path geometry helpers -------------------------------------
// All of this operates directly on [lat, lng] pairs as if they were flat
// (x, y) coordinates. That's not geodesically correct, but at the scale
// of a single mission zone the error is invisible on a Leaflet map, and
// this is explicitly a decision-support *simulation*, not a real flight
// planner — see the disclaimer rendered in the UI.

function distanceToSegment(point, segStart, segEnd) {
  const [px, py] = point;
  const [ax, ay] = segStart;
  const [bx, by] = segEnd;

  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;

  let t = lenSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closest = [ax + t * abx, ay + t * aby];
  const dx = px - closest[0];
  const dy = py - closest[1];

  return { distance: Math.sqrt(dx * dx + dy * dy), closest };
}

// Builds a Safe Path from home to the target. If an earlier hazard
// marker sits close to the straight line, insert one perpendicular-offset
// waypoint so the path visibly curves around it instead of through it.
function buildSafePath(home, target, hazards) {
  const straight = [home, target];

  let nearestHazard = null;
  let nearestInfo = null;

  for (const hazard of hazards) {
    const info = distanceToSegment([hazard.lat, hazard.lng], home, target);
    if (info.distance < HAZARD_CLEARANCE_DEG) {
      if (!nearestInfo || info.distance < nearestInfo.distance) {
        nearestHazard = hazard;
        nearestInfo = info;
      }
    }
  }

  if (!nearestHazard) return { path: straight, bent: false };

  const [ax, ay] = home;
  const [bx, by] = target;
  const segDx = bx - ax;
  const segDy = by - ay;
  const segLen = Math.sqrt(segDx * segDx + segDy * segDy) || 1;

  // Unit vector perpendicular to the home->target segment.
  const perpX = -segDy / segLen;
  const perpY = segDx / segLen;

  // Push the waypoint away from the hazard, not toward it: compare which
  // side of the line the hazard sits on and offset to the opposite side.
  const hazardSide =
    (nearestHazard.lat - ax) * segDy - (nearestHazard.lng - ay) * segDx;
  const sign = hazardSide > 0 ? -1 : 1;

  const offset = HAZARD_CLEARANCE_DEG * 1.6;
  const bendPoint = [
    nearestInfo.closest[0] + sign * perpX * offset,
    nearestInfo.closest[1] + sign * perpY * offset,
  ];

  return { path: [home, bendPoint, target], bent: true, avoided: nearestHazard };
}

export default function Dashboard() {
  const [sysState, setSysState] = useState('OFF');
  const [zonePoints, setZonePoints] = useState([]);
  const [patrolPath, setPatrolPath] = useState([]);
  const [targets, setTargets] = useState([]);
  const [dronePos, setDronePos] = useState(HOME_BASE);
  const [battery, setBattery] = useState(100);
  const [altitude, setAltitude] = useState(0.0);
  const [wsConnected, setWsConnected] = useState(false);
  const [latestDetection, setLatestDetection] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const currentPosRef = useRef(HOME_BASE);
  const wsRef = useRef(null);
  const nextTargetId = useRef(1);

  const handleMapClick = (coords) => {
    if (zonePoints.length < 4) setZonePoints([...zonePoints, coords]);
  };

  const generateGridPath = (points) => {
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const waypoints = [];
    const numSweeps = 6;
    const latStep = (maxLat - minLat) / numSweeps;

    let movingRight = true;
    for (let i = 0; i <= numSweeps; i++) {
      const currentLat = maxLat - (i * latStep);
      if (movingRight) {
        waypoints.push([currentLat, minLng]);
        waypoints.push([currentLat, maxLng]);
      } else {
        waypoints.push([currentLat, maxLng]);
        waypoints.push([currentLat, minLng]);
      }
      movingRight = !movingRight;
    }
    return waypoints;
  };

  const startMission = () => {
    if (zonePoints.length === 4) {
      const grid = generateGridPath(zonePoints);
      setPatrolPath(grid);
      setSysState('ACTIVE');
      setDronePos(grid[0]);
      currentPosRef.current = grid[0];
      setBattery(98);
    }
  };

  // Upload a field image straight from this dashboard: it's sent to the
  // LAPTOP1 field backend's /detect, which runs YOLO and then forwards the
  // result back here over the relay's WebSocket (handled below) — so we
  // don't need to touch `targets`/`latestDetection` directly on success.
  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await detectImage(file);
    } catch (error) {
      setUploadError(error.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (sysState !== 'ACTIVE' || patrolPath.length === 0) return;

    let currentWaypointIdx = 0;

    const flightInterval = setInterval(() => {
      setAltitude((Math.random() * (8.5 - 7.5) + 7.5).toFixed(1));

      const targetWp = patrolPath[currentWaypointIdx];
      const current = currentPosRef.current;

      const step = 0.012;
      const newLat = current[0] + (targetWp[0] - current[0]) * step;
      const newLng = current[1] + (targetWp[1] - current[1]) * step;

      if (Math.abs(targetWp[0] - newLat) < 0.00005 && Math.abs(targetWp[1] - newLng) < 0.00005) {
        currentWaypointIdx++;
        if (currentWaypointIdx >= patrolPath.length) {
          currentWaypointIdx = 0;
        }
      }

      currentPosRef.current = [newLat, newLng];
      setDronePos([newLat, newLng]);
    }, 100);

    const batteryInterval = setInterval(() => setBattery(p => Math.max(0, p - 1)), 60000);

    return () => { clearInterval(flightInterval); clearInterval(batteryInterval); };
  }, [sysState, patrolPath]);

  // Real detections from Laptop 1, relayed through the FastAPI /ws bridge.
  useEffect(() => {
    if (sysState !== 'ACTIVE') return;

    wsRef.current = new WebSocket(import.meta.env.VITE_RELAY_WS_URL || 'ws://localhost:8000/ws');
    wsRef.current.onopen = () => setWsConnected(true);

    wsRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'detection_update' || !data.detections?.length) return;

        setLatestDetection(data);

        const alertLocation = currentPosRef.current;
        const timestamp = new Date(data.timestamp || Date.now())
          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // One marker per detection *event*, not per individual box — its
        // color/log line is decided by what the event contains as a
        // whole: survivor(s) alone, hazard(s) alone, or both together.
        const counts = data.counts || {};
        const personCount = counts.person || 0;
        const vehicleCount = counts.vehicle || 0;
        const hazardTypes = ['fire', 'flood'].filter((k) => (counts[k] || 0) > 0);
        const hasSurvivor = personCount > 0;
        const hasHazard = hazardTypes.length > 0;

        let category;
        let label;

        if (hasSurvivor && hasHazard) {
          category = 'critical';
          label = `CRITICAL: ${personCount} Person${personCount === 1 ? '' : 's'} stuck in ${hazardTypes.map(capitalize).join(', ')}`;
        } else if (hasSurvivor) {
          category = 'survivor';
          label = `Survivor Detected: ${personCount} Person${personCount === 1 ? '' : 's'}`;
        } else if (hasHazard) {
          category = 'hazard';
          label = `Hazard: ${hazardTypes.map(capitalize).join(', ')}`;
        } else if (vehicleCount > 0) {
          category = 'vehicle';
          label = `Vehicle Detected: ${vehicleCount}`;
        } else {
          return;
        }

        const newTarget = {
          id: nextTargetId.current++,
          category,
          hazardTypes,
          personCount,
          label,
          confidence: data.max_confidence ?? 0,
          lat: alertLocation[0] + (Math.random() - 0.5) * 0.0006,
          lng: alertLocation[1] + (Math.random() - 0.5) * 0.0006,
          timestamp,
        };

        setTargets((prev) => [newTarget, ...prev]);
      } catch (error) {
        console.error('Failed to parse incoming telemetry data.', error);
      }
    };

    wsRef.current.onclose = () => setWsConnected(false);
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [sysState]);

  // --- Safe Path Simulation --------------------------------------
  // Prototype decision-support visualization only — see disclaimer in
  // the sidebar and on the path's popup. Not a certified or
  // physics-checked autonomous flight route.
  const newestTarget = targets[0] || null;
  const earlierHazards = newestTarget
    ? targets.filter((t) => t.category === 'hazard' && t.id !== newestTarget.id)
    : [];

  const safePath = newestTarget
    ? buildSafePath(HOME_BASE, [newestTarget.lat, newestTarget.lng], earlierHazards)
    : null;

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <div className="w-[24%] border-r border-slate-700 bg-slate-800/50 flex flex-col p-4 shadow-2xl z-10 relative">
        <div className="mb-6 border-b border-slate-700 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Activity className={sysState === 'ACTIVE' ? "text-emerald-400" : "text-slate-500"} size={24} />
            Project Anveshak
          </h1>
          <div className="flex items-center gap-2 mt-4">
            <div className={`w-3 h-3 rounded-full ${sysState === 'ACTIVE' ? (wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-yellow-500') : 'bg-red-500'}`}></div>
            <span className={`text-sm font-semibold tracking-wide ${sysState === 'ACTIVE' ? 'text-emerald-400' : 'text-red-400'}`}>
              {sysState === 'ACTIVE' ? (wsConnected ? 'SYSTEM ACTIVE' : 'DRONE FLYING (NO DATA LINK)') : 'SYSTEM OFFLINE'}
            </span>
          </div>
        </div>

        {sysState !== 'ACTIVE' && (
          <div className="flex-1 flex flex-col gap-4">
            <div className="bg-slate-900 p-4 rounded-lg border border-slate-700">
              <h3 className="text-sm font-bold text-slate-300 mb-4 uppercase tracking-wider">Initialize Mission Zone</h3>
              {sysState === 'OFF' && (
                <button onClick={() => setSysState('SELECTING_MAP')} className="w-full bg-slate-700 hover:bg-slate-600 text-white p-3 rounded text-sm flex items-center justify-center gap-2 transition-colors">
                  <MousePointer2 size={16}/> Select Region on Map
                </button>
              )}
              {sysState === 'SELECTING_MAP' && (
                <div className="text-center">
                  <p className="text-emerald-400 font-mono mb-3">Waypoints captured: {zonePoints.length} / 4</p>
                  {zonePoints.length === 4 ? (
                    <button onClick={startMission} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded font-bold shadow-lg transition-colors">Deploy UAV Mission</button>
                  ) : (
                    <button onClick={() => {setZonePoints([]); setSysState('OFF');}} className="w-full bg-slate-700 text-slate-300 py-2 rounded text-sm mt-2 transition-colors">Abort Setup</button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {sysState === 'ACTIVE' && (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 shadow-inner">
                <div className="flex items-center gap-2 text-slate-400 text-xs uppercase mb-1 font-semibold">
                  <Battery size={14} className={battery < 20 ? 'text-red-400' : 'text-emerald-400'} /> Battery Level
                </div>
                <div className="text-2xl font-mono">{battery}%</div>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 border border-slate-700 shadow-inner">
                <div className="flex items-center gap-2 text-slate-400 text-xs uppercase mb-1 font-semibold">
                  <Crosshair size={14} className="text-cyan-400" /> Current Altitude
                </div>
                <div className="text-2xl font-mono">{altitude} <span className="text-sm text-slate-500">m</span></div>
              </div>
            </div>

            {/* Safe Path status + prototype disclaimer */}
            <div className="bg-slate-900 rounded-lg p-3 border border-amber-700/50 shadow-inner mb-4">
              <div className="flex items-center gap-2 text-amber-400 text-xs uppercase mb-1 font-semibold">
                <ShieldAlert size={14} /> Safe Path Simulation
              </div>
              {newestTarget ? (
                <div className="text-xs text-slate-300">
                  Home Base → Target #{newestTarget.id}
                  {safePath?.bent && (
                    <span className="text-amber-400"> (bent around hazard)</span>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic">No target yet — path will appear here.</div>
              )}
              <div className="text-[10px] text-slate-500 mt-2 leading-snug">
                ⚠ Prototype visualization / decision-support simulation only —
                not a certified or physics-checked flight route.
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> Target Event Log
              </h2>
              <div className="flex-1 overflow-y-auto bg-slate-900 rounded-lg border border-slate-700 p-2 shadow-inner">
                {targets.length === 0 ? (
                  <div className="text-slate-600 text-sm p-4 text-center mt-4 italic">Patrolling designated zone...<br/>Awaiting NPU detections.</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {targets.map((target) => {
                      const style = LOG_STYLE[target.category] || LOG_STYLE.survivor;
                      return (
                        <div
                          key={target.id}
                          className={`bg-slate-800 p-3 rounded border-l-2 text-sm shadow ${style.border}`}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className={`font-bold flex items-center gap-2 ${style.text}`}>
                              <span
                                className={`text-white w-5 h-5 flex items-center justify-center rounded-full text-xs shadow-sm ${style.badge}`}
                              >
                                {target.id}
                              </span>
                              {target.label}
                            </span>
                            <span className="text-slate-400 text-xs font-mono">{target.timestamp}</span>
                          </div>
                          <div className="text-slate-300 ml-7 text-xs">Model Confidence: <span className="font-mono text-white">{target.confidence}%</span></div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-slate-400 mb-3 px-1">
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block"/> Drone</div>
              <div className="flex items-center gap-1.5"><Home size={10} className="text-emerald-400"/> Home Base</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"/> Survivor</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-orange-500 inline-block"/> Hazard</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#7c2d12] inline-block"/> Critical (survivor + hazard)</div>
              <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-slate-500 inline-block"/> Vehicle</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block"/> Safe Path</div>
            </div>

            <button
              onClick={() => {
                setTargets([]);
                setZonePoints([]);
                setPatrolPath([]);
                setLatestDetection(null);
                setSysState('OFF');
              }}
              className="w-full mt-2 bg-slate-700 hover:bg-red-600 text-white py-3 rounded text-xs uppercase tracking-wider font-bold transition-colors border border-slate-600 shadow"
            >
              🛑 Clear & Reset Mission
            </button>
          </>
        )}
      </div>

      <div className="w-[46%] relative bg-black">
        {sysState === 'ACTIVE' && (
          <div className="absolute top-4 left-4 z-[1000] bg-slate-900/80 backdrop-blur border border-slate-700 rounded-lg p-3 shadow-lg pointer-events-none">
            <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Live Global Telemetry</div>
            <div className="text-sm font-mono flex items-center gap-2">
              <MapPin size={14} className="text-cyan-400" />
              {dronePos[0].toFixed(6)}, {dronePos[1].toFixed(6)}
            </div>
          </div>
        )}

        <MapContainer center={HOME_BASE} zoom={16} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" className="dark-map-tiles" />
          <MapClickCatch onMapClick={handleMapClick} isActive={sysState === 'SELECTING_MAP'} />

          {zonePoints.length > 0 && (
            <Polygon positions={zonePoints} color="#22c55e" fillOpacity={0.05} weight={2} />
          )}

          {sysState === 'ACTIVE' && (
            <Polyline positions={patrolPath} color="#06b6d4" weight={1} dashArray="4, 6" opacity={0.4} />
          )}

          {sysState === 'SELECTING_MAP' && zonePoints.map((p, i) => (
            <Marker key={i} position={p} icon={createTargetIcon(i+1)} />
          ))}

          {sysState === 'ACTIVE' && (
            <Marker position={HOME_BASE} icon={homeBaseIcon}>
              <Popup>
                <strong>Rescue Command — Home Base</strong><br />
                <span className="text-xs">Fixed launch / return point</span>
              </Popup>
            </Marker>
          )}

          {sysState === 'ACTIVE' && (
            <Marker position={dronePos} icon={droneIcon}>
              <Popup className="bg-slate-800 text-white border-none rounded shadow-lg"><strong>Autonomous UAV Patrolling</strong></Popup>
            </Marker>
          )}

          {sysState === 'ACTIVE' && safePath && (
            <Polyline positions={safePath.path} color="#f59e0b" weight={2} dashArray="6, 6" opacity={0.8}>
              <Popup>
                <div className="text-xs">
                  <strong>Safe Path (simulated)</strong><br />
                  {safePath.bent
                    ? 'Bent around a nearby hazard marker.'
                    : 'Direct line — no hazard nearby.'}
                  <br />
                  <span className="text-slate-500">
                    Prototype decision-support visualization only — not a
                    certified or physics-checked route.
                  </span>
                </div>
              </Popup>
            </Polyline>
          )}

          {targets.map((target) => {
            const popupTitle = {
              hazard: 'Hazard',
              critical: 'CRITICAL',
              vehicle: 'Vehicle',
            }[target.category] || 'Target';
            const popupColor = {
              hazard: '#ea580c',
              critical: '#7c2d12',
              vehicle: '#475569',
            }[target.category] || '#dc2626';
            return (
              <Marker key={target.id} position={[target.lat, target.lng]} icon={markerIconFor(target)}>
                <Popup>
                  <div className="text-sm p-1">
                    <strong style={{ color: popupColor, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      {popupTitle} #{target.id}
                    </strong><br />
                    <span className="text-slate-600">{target.label}</span><br/>
                    <span className="text-slate-500 text-xs">Confidence: {target.confidence}%</span>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* DETECTION RESULTS — the image + class tally + object list that
          used to live on Laptop 1; it now lives here instead. */}
      <div className="w-[30%] border-l border-slate-700 bg-slate-800/50 flex flex-col shadow-2xl z-10 overflow-y-auto">
        <div className="p-4 border-b border-slate-700 sticky top-0 bg-slate-800/95 backdrop-blur z-10">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            🖼️ Detection Result
          </h2>
        </div>

        {sysState === 'ACTIVE' && (
          <div className="p-4 border-b border-slate-700">
            <label
              className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                uploading ? 'border-slate-600 opacity-60 pointer-events-none' : 'border-slate-600 hover:border-cyan-500'
              }`}
            >
              <UploadCloud size={20} className="text-cyan-400" />
              <span className="text-xs text-slate-300">
                {uploading ? 'Detecting…' : 'Upload a field image to run detection'}
              </span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  handleUpload(file);
                  e.target.value = '';
                }}
              />
            </label>
            {uploadError && (
              <div className="text-[11px] text-red-400 mt-2">{uploadError}</div>
            )}
          </div>
        )}

        {!latestDetection ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center text-slate-600 text-sm italic">
            {sysState === 'ACTIVE'
              ? 'Waiting for a detection — upload an image above, or wait for Laptop 1.'
              : 'Deploy a mission to start receiving detections.'}
          </div>
        ) : (
          <div className="p-4 flex flex-col gap-4">
            {latestDetection.using_trained_model === false && (
              <div className="bg-amber-900/30 border border-amber-700/50 text-amber-300 text-[11px] rounded-lg p-2">
                ⚠ Running on a generic model — fire/flood detection isn't available yet.
              </div>
            )}

            {latestDetection.image && (
              <div className="rounded-lg overflow-hidden border border-slate-700 bg-black">
                <img
                  src={`data:image/jpeg;base64,${latestDetection.image}`}
                  alt="Latest AI detection result"
                  className="w-full h-auto block"
                />
              </div>
            )}

            {/* Class tally */}
            <div className="grid grid-cols-2 gap-2">
              {CLASS_TALLY.map(({ key, label, icon }) => (
                <div key={key} className="bg-slate-900 rounded-lg p-3 border border-slate-700 text-center">
                  <div className="text-xl mb-1">{icon}</div>
                  <div className="text-xs text-slate-400 uppercase tracking-wide">{label}</div>
                  <div className="text-lg font-mono font-bold text-white">{latestDetection.counts?.[key] ?? 0}</div>
                </div>
              ))}
            </div>

            {/* Detected objects list */}
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Detected Objects</h3>
              <div className="flex flex-col gap-2">
                {(latestDetection.detections || []).map((d, i) => (
                  <div key={i} className="bg-slate-900 p-3 rounded border-l-2 border-cyan-500 text-sm">
                    <div className="font-bold text-cyan-400 uppercase text-xs tracking-wide">
                      {d.class_name || d.unified_class}
                    </div>
                    <div className="text-slate-300 text-xs mt-1">
                      Confidence: <span className="font-mono text-white">{d.confidence}%</span>
                    </div>
                    {d.bbox?.length === 4 && (
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        Bounding Box: {d.bbox.join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Ambulance, Bed, ChevronRight, Clock, Download, Pause, Play, RotateCcw, Search, ShieldCheck, SkipForward, Stethoscope, UserRound, Users, Zap } from "lucide-react";
import { advanceSimulation, assignSelectedPatientsNow, assignWaitingPatientsNow, formatSimTime, initializeSimulation, injectDisruption, isSimulationComplete } from "../simulation/engine";
import { buildOpsSnapshot } from "../lib/ops-snapshot";
import type { AuditEvent, DisruptionType, LogCategory, LogLevel, Patient, Room, SimulationState, StaffMember } from "../simulation/types";
import OpsCopilotPanel from "./ops-copilot-panel";

const speeds = [1, 5, 10, 30];
const levelStyles: Record<LogLevel, string> = { info: "level-info", notice: "level-notice", warning: "level-warning", critical: "level-critical", success: "level-success" };
const severityStyles = ["", "severity-1", "severity-2", "severity-3", "severity-4", "severity-5"];

function MetricCard({ label, value, meta, icon: Icon, tone = "teal" }: { label: string; value: string | number; meta: string; icon: typeof Activity; tone?: "teal" | "rose" | "blue" | "amber" }) {
  return <div className="metric-card"><div className={`metric-icon tone-${tone}`}><Icon size={17}/></div><div><p>{label}</p><strong>{value}</strong><span>{meta}</span></div></div>;
}

function PatientBadge({ patient, onClick, compact = false }: { patient: Patient; onClick: () => void; compact?: boolean }) {
  return <button onClick={(event) => { event.stopPropagation(); onClick(); }} className={`patient-badge ${compact ? "compact" : ""}`} title={`${patient.name}, priority ${patient.severity}`}>
    <span className={`severity-dot ${severityStyles[patient.severity]}`}>{patient.severity}</span>
    {!compact && <span><b>{patient.name.split(" ")[0]}</b><small>{patient.waitMinutes}m wait</small></span>}
  </button>;
}

function RoomCard({ room, state, onSelect }: { room: Room; state: SimulationState; onSelect: (id: string) => void }) {
  const patient = state.patients.find((item) => item.id === room.patientId);
  const assigned = state.staff.filter((item) => item.roomId === room.id);
  const progress = patient ? Math.round(((patient.treatmentMinutes - patient.remainingMinutes) / patient.treatmentMinutes) * 100) : 0;
  return <div
    className={`room-card room-${room.status}`}
    role="button"
    tabIndex={0}
    onClick={() => onSelect(room.id)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onSelect(room.id);
    }}
  >
    <div className="room-head"><span>{room.label}</span><span className="room-type">{room.type}</span></div>
    <div className="room-status"><i/>{room.status}{room.status === "cleaning" ? ` · ${room.cleaningMinutesRemaining}m` : ""}</div>
    {patient ? <div className="room-patient"><PatientBadge patient={patient} compact onClick={() => onSelect(patient.id)}/><div><b>{patient.name}</b><span>{patient.injury}</span></div></div> : room.reservedForPatientId ? <div className="reserved-card"><ShieldCheck size={16}/><span>Reserved for<br/><b>{room.reservedForPatientId}</b></span></div> : <div className="empty-room"><Bed size={21}/><span>{room.status === "ready" ? "Ready for assignment" : "No active patient"}</span></div>}
    {patient && <><div className="progress-track"><span style={{ width: `${progress}%` }}/></div><div className="room-footer"><span>{patient.remainingMinutes}m remaining</span><span>{assigned.map((member) => member.name.replace("Dr. ", "").replace("Nurse ", "")).join(" · ")}</span></div></>}
  </div>;
}

function EntityInspector({ state, selectedId }: { state: SimulationState; selectedId: string }) {
  const patient = state.patients.find((item) => item.id === selectedId);
  const room = state.rooms.find((item) => item.id === selectedId);
  const staff = state.staff.find((item) => item.id === selectedId);
  const resource = state.resources.find((item) => item.id === selectedId);
  if (!patient && !room && !staff && !resource) return <div className="inspector-empty"><Activity size={24}/><p>Select a patient, room, team member, or resource to inspect its live state.</p></div>;
  if (patient) return <div className="inspector"><div className="inspector-title"><span className={`severity-dot large ${severityStyles[patient.severity]}`}>{patient.severity}</span><div><p>Patient · {patient.id}</p><h3>{patient.name}</h3></div></div><dl><div><dt>Status</dt><dd>{patient.status}</dd></div><div><dt>Condition</dt><dd>{patient.condition}</dd></div><div><dt>Waiting</dt><dd>{patient.waitMinutes} min</dd></div><div><dt>Location</dt><dd>{patient.assignedRoomId ?? (patient.status === "inbound" ? "Ambulance" : "Waiting")}</dd></div><div><dt>Resources</dt><dd>{patient.requiredResources.join(", ") || "None"}</dd></div><div><dt>Specialist</dt><dd>{patient.requiredSpecialty ?? "General"}</dd></div></dl>{patient.blockedReason && <div className="conflict-note"><span>Assignment blocked</span><p>{patient.blockedReason}</p></div>}<div className="clinical-note"><span>Synthetic case profile</span><p>{patient.injury}. This prototype does not provide medical guidance.</p></div></div>;
  if (room) return <div className="inspector"><div className="inspector-title"><span className="entity-icon"><Bed size={20}/></span><div><p>Room · {room.id}</p><h3>{room.label}</h3></div></div><dl><div><dt>Type</dt><dd>{room.type}</dd></div><div><dt>Status</dt><dd>{room.status}</dd></div><div><dt>Patient</dt><dd>{room.patientId ?? "—"}</dd></div><div><dt>Reserved for</dt><dd>{room.reservedForPatientId ?? "—"}</dd></div></dl></div>;
  if (resource) return <div className="inspector"><div className="inspector-title"><span className="entity-icon"><Activity size={20}/></span><div><p>Critical resource · {resource.id}</p><h3>{resource.label}</h3></div></div><dl><div><dt>Status</dt><dd>{resource.status}</dd></div><div><dt>Utilization</dt><dd>{resource.assignedPatientIds.length}/{resource.capacity}</dd></div><div><dt>Patients</dt><dd>{resource.assignedPatientIds.join(", ") || "None"}</dd></div><div><dt>Restore</dt><dd>{resource.offlineUntilMinute ? formatSimTime(resource.offlineUntilMinute) : "—"}</dd></div></dl></div>;
  const member = staff as StaffMember;
  return <div className="inspector"><div className="inspector-title"><span className="entity-icon"><Stethoscope size={20}/></span><div><p>{member.role} · {member.id}</p><h3>{member.name}</h3></div></div><dl><div><dt>Status</dt><dd>{member.status}</dd></div><div><dt>Specialty</dt><dd>{member.specialty}</dd></div><div><dt>Patient</dt><dd>{member.patientId ?? "—"}</dd></div><div><dt>Room</dt><dd>{member.roomId ?? "—"}</dd></div></dl></div>;
}

function EventRow({ event, selected, onClick }: { event: AuditEvent; selected: boolean; onClick: () => void }) {
  return <button className={`event-row ${selected ? "selected" : ""}`} onClick={onClick}><span className="event-time">{formatSimTime(event.simMinute)}</span><span className={`event-level ${levelStyles[event.level]}`}>{event.level}</span><span className="event-main"><b>{event.summary}</b><small>{event.source} · v{event.stateVersion}</small></span><ChevronRight size={15}/></button>;
}

function ResourcePanel({ state, onSelect }: { state: SimulationState; onSelect: (id: string) => void }) {
  return <section className="panel resource-panel"><div className="panel-head compact"><div><span className="eyebrow">Shared bottlenecks</span><h2>Critical resources</h2></div><span className="available-count">{state.metrics.resourcePressure}% pressure</span></div><div className="resource-list">{state.resources.map((resource) => <button key={resource.id} onClick={() => onSelect(resource.id)}><span><i className={resource.status}/><b>{resource.label}</b></span><small>{resource.status === "offline" ? `Offline to ${formatSimTime(resource.offlineUntilMinute ?? state.simMinute)}` : `${resource.assignedPatientIds.length}/${resource.capacity} allocated`}</small></button>)}</div></section>;
}

function IncidentTimeline({ state }: { state: SimulationState }) {
  return <section className="panel incident-panel"><div className="panel-head compact"><div><span className="eyebrow">Deterministic scenario feed</span><h2>Cascading incidents</h2></div><span className="version-chip">{state.incidents.filter((incident) => incident.status === "occurred").length}/{state.incidents.length}</span></div><div className="incident-list">{state.incidents.map((incident) => <div key={incident.id} className={incident.status}><span>{formatSimTime(incident.minute)}</span><i/><p>{incident.title}</p></div>)}</div></section>;
}

export default function DigitalTwinDashboard() {
  const [state, setState] = useState(() => initializeSimulation(42));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [seed, setSeed] = useState(42);
  const [selectedId, setSelectedId] = useState("P-101");
  const [selectedEventId, setSelectedEventId] = useState<string>(state.events.at(-1)?.id ?? "");
  const [category, setCategory] = useState<LogCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [dismissedReportVersion, setDismissedReportVersion] = useState<number | null>(null);
  const stateRef = useRef(state);
  const simulationComplete = isSimulationComplete(state);
  const isRunning = running && !simulationComplete;
  const completionPercent = Math.round((state.metrics.discharged / state.patients.length) * 100);
  const reportOpen = simulationComplete && state.simMinute > 0 && dismissedReportVersion !== state.stateVersion;
  const blockedDecisions = state.events.filter((event) => event.type === "ASSIGNMENT_BLOCKED").length;
  const occurredIncidents = state.incidents.filter((incident) => incident.status === "occurred").length;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    fetch("/api/simulation-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOpsSnapshot(state)),
    }).then((response) => {
      if (!response.ok) throw new Error(`Simulation snapshot publish failed (${response.status})`);
    }).catch((error: unknown) => {
      console.error("Could not publish the live simulation snapshot.", error);
    });
  }, [state]);

  useEffect(() => {
    let active = true;
    let processing = false;

    async function processCommands() {
      if (processing) return;
      processing = true;
      try {
        const response = await fetch("/api/simulation-control", { cache: "no-store" });
        if (!response.ok) throw new Error(`Simulation command poll failed (${response.status})`);
        const payload = await response.json() as {
          commands: Array<{
            id: string;
            action: string;
            runId: string;
            pairings?: Array<{ patientId: string; doctorId: string; roomId: string }>;
          }>;
        };
        for (const command of payload.commands) {
          if (!active) return;
          const current = stateRef.current;
          if (
            (command.action !== "start" && command.action !== "assign_waiting" && command.action !== "assign_selected") ||
            command.runId !== current.runId ||
            (command.action === "assign_selected" && !command.pairings?.length)
          ) {
            const message = "The command does not match the active simulation run or has invalid pairings.";
            const acknowledgement = await fetch("/api/simulation-control", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commandId: command.id, status: "rejected", message }),
            });
            if (!acknowledgement.ok) throw new Error(`Simulation command acknowledgement failed (${acknowledgement.status})`);
            continue;
          }
          if (command.action === "start") {
            if (isSimulationComplete(current)) {
              const acknowledgement = await fetch("/api/simulation-control", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ commandId: command.id, status: "rejected", message: "The simulation run is complete. Reset the twin before starting another run." }),
              });
              if (!acknowledgement.ok) throw new Error(`Simulation command acknowledgement failed (${acknowledgement.status})`);
              continue;
            }
            setRunning(true);
            const acknowledgement = await fetch("/api/simulation-control", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ commandId: command.id, status: "applied", message: "Simulation is running." }),
            });
            if (!acknowledgement.ok) throw new Error(`Simulation command acknowledgement failed (${acknowledgement.status})`);
            continue;
          }
          const selected = command.action === "assign_selected"
            ? assignSelectedPatientsNow(current, command.pairings!)
            : undefined;
          const next = selected?.state ?? assignWaitingPatientsNow(current);
          const assignedCount = next.patients.filter((patient) => patient.status === "treating").length - current.patients.filter((patient) => patient.status === "treating").length;
          stateRef.current = next;
          setState(next);
          const message = selected
            ? selected.results.map((result) => `${result.patientId}: ${result.message}`).join("\n")
            : assignedCount > 0
              ? `Assigned ${assignedCount} waiting patient${assignedCount === 1 ? "" : "s"}.`
              : "No waiting patients could be assigned; current constraints remain in effect.";
          const acknowledgement = await fetch("/api/simulation-control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ commandId: command.id, status: "applied", message, assignedCount }),
          });
          if (!acknowledgement.ok) throw new Error(`Simulation command acknowledgement failed (${acknowledgement.status})`);
        }
      } catch (error: unknown) {
        console.error("Could not process simulation control commands.", error);
      } finally {
        processing = false;
      }
    }

    const timer = window.setInterval(() => { void processCommands(); }, 500);
    void processCommands();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setState((current) => advanceSimulation(current)), Math.max(90, 1000 / speed));
    return () => window.clearInterval(timer);
  }, [isRunning, speed]);

  const filteredEvents = useMemo(() => state.events.filter((event) => (category === "all" || event.category === category) && `${event.summary} ${event.details} ${event.source} ${event.entityIds.join(" ")}`.toLowerCase().includes(query.toLowerCase())).reverse(), [state.events, category, query]);
  const deteriorationAnalysis = useMemo(() => {
    const deteriorationEvents = state.events.filter((event) => event.type === "PATIENT_DETERIORATED" || event.type === "SECONDARY_DETERIORATION");
    const acuityUpdates = state.events.filter((event) => event.type === "ACUITY_UPDATE");
    const sourceLabel = (source: string) => source === "Synthetic deterioration model" ? "Waiting-risk model" : source === "Bedside monitoring feed" ? "Scheduled scenario" : source === "Judge control" ? "Manual injection" : source === "Medic 21 telemetry" ? "Ambulance update" : source;
    const rows = state.patients.map((patient) => {
      const episodes = deteriorationEvents.filter((event) => event.entityIds.includes(patient.id));
      const updates = acuityUpdates.filter((event) => event.entityIds.includes(patient.id));
      const combined = [...episodes, ...updates].sort((a, b) => a.simMinute - b.simMinute);
      return {
        patient,
        episodes: episodes.length,
        acuityUpdates: updates.length,
        firstMinute: combined[0]?.simMinute,
        lastMinute: combined.at(-1)?.simMinute,
        sources: [...new Set(combined.map((event) => sourceLabel(event.source)))],
      };
    }).filter((row) => row.episodes > 0 || row.acuityUpdates > 0).sort((a, b) => b.episodes - a.episodes || a.patient.id.localeCompare(b.patient.id));
    return {
      total: deteriorationEvents.length,
      affectedPatients: new Set(deteriorationEvents.flatMap((event) => event.entityIds.filter((id) => id.startsWith("P-")))).size,
      waitingRisk: deteriorationEvents.filter((event) => event.source === "Synthetic deterioration model").length,
      scheduled: deteriorationEvents.filter((event) => event.source === "Bedside monitoring feed").length,
      manual: deteriorationEvents.filter((event) => event.source === "Judge control").length,
      acuityUpdates: acuityUpdates.length,
      rows,
    };
  }, [state.events, state.patients]);
  const selectedEvent = state.events.find((event) => event.id === selectedEventId) ?? filteredEvents[0];
  const waiting = state.patients.filter((patient) => patient.status === "waiting").sort((a, b) => a.severity - b.severity || b.waitMinutes - a.waitMinutes);
  const inbound = state.ambulances.filter((ambulance) => ambulance.status === "inbound");

  function reset() { const next = initializeSimulation(seed); setState(next); setRunning(false); setSelectedId("P-101"); setSelectedEventId(next.events.at(-1)?.id ?? ""); setDismissedReportVersion(null); }
  function disrupt(type: DisruptionType) { setState((current) => { const next = injectDisruption(current, type); setSelectedEventId(next.events.at(-1)?.id ?? ""); return next; }); }
  function exportLog() {
    const payload = JSON.stringify({ run: { id: state.runId, scenario: state.scenarioId, seed: state.seed }, finalStateVersion: state.stateVersion, metrics: state.metrics, resources: state.resources, incidents: state.incidents, events: state.events }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${state.runId.toLowerCase()}-audit-log.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Activity size={20}/></span><div><b>UNIQ</b><span>Emergency operations twin</span></div></div>
      <div className="run-meta"><span className="live-pill"><i className={isRunning ? "pulse" : ""}/>{isRunning ? "Live simulation" : simulationComplete ? "Run complete" : "Simulation paused"}</span><span>{state.scenarioId}</span><span>Seed {state.seed}</span><span>State v{state.stateVersion}</span></div>
      <div className="header-actions"><button onClick={exportLog}><Download size={15}/>Export audit</button><button className="primary" disabled={simulationComplete} onClick={() => setRunning((current) => !current)}>{isRunning ? <Pause size={15}/> : <Play size={15}/>} {isRunning ? "Pause" : simulationComplete ? "Complete" : "Run twin"}</button></div>
    </header>

    <section className="command-strip">
      <div className="clock-block"><Clock size={18}/><div><span>Simulated time</span><strong>{formatSimTime(state.simMinute)}</strong></div></div>
      <div className="transport"><button aria-label="Play or pause" disabled={simulationComplete} onClick={() => setRunning((current) => !current)}>{isRunning ? <Pause size={17}/> : <Play size={17}/>}</button><button aria-label="Step one minute" disabled={simulationComplete} onClick={() => setState((current) => advanceSimulation(current))}><SkipForward size={17}/></button><button aria-label="Reset" onClick={reset}><RotateCcw size={17}/></button></div>
      <div className="timeline" title={`${completionPercent}% of patients cleared`}><span style={{ width: `${completionPercent}%` }}/></div>
      <div className="speed-control"><span>Playback</span>{speeds.map((item) => <button key={item} onClick={() => setSpeed(item)} className={speed === item ? "active" : ""}>{item}×</button>)}</div>
      <label className="seed-control">Seed<input type="number" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 1)}/></label>
    </section>

    <section className="metrics-row">
      <MetricCard label="Waiting" value={state.metrics.waiting} meta={`${state.metrics.inbound} inbound`} icon={Users} tone="blue"/>
      <MetricCard label="In treatment" value={state.metrics.treating} meta={`${state.metrics.discharged} discharged`} icon={Stethoscope}/>
      <MetricCard label="Critical" value={state.metrics.critical} meta="Synthetic status" icon={Activity} tone="rose"/>
      <MetricCard label="Conflicts" value={state.metrics.activeConflicts} meta={`${state.metrics.offlineResources} resources offline`} icon={AlertTriangle} tone="rose"/>
      <MetricCard label="Room utilization" value={`${state.metrics.roomUtilization}%`} meta={`${state.metrics.occupiedRooms}/${state.rooms.length} occupied`} icon={Bed} tone="amber"/>
      <MetricCard label="Resource pressure" value={`${state.metrics.resourcePressure}%`} meta={`${state.metrics.deteriorationEvents} deteriorations`} icon={Clock}/>
    </section>

    <section className="workspace">
      <div className="twin-panel panel">
        <div className="panel-head"><div><span className="eyebrow">Authoritative environment</span><h1>Mass-casualty operations floor</h1></div><div className="legend"><span><i className="ready"/>Ready</span><span><i className="busy"/>Occupied</span><span><i className="cleaning"/>Turnover</span><span><i className="reserved"/>Reserved</span></div></div>
        <div className="floor-plan">
          <div className="rooms-grid">{state.rooms.map((room) => <RoomCard key={room.id} room={room} state={state} onSelect={setSelectedId}/>)}</div>
          <div className="floor-bottom">
            <div className="waiting-zone"><div className="zone-title"><div><Users size={16}/><span>Waiting area</span></div><b>{waiting.length} patients</b></div><div className="waiting-list">{waiting.length ? waiting.map((patient) => <PatientBadge key={patient.id} patient={patient} onClick={() => setSelectedId(patient.id)}/>) : <p className="zone-empty">No patients waiting</p>}</div></div>
            <div className="ambulance-zone"><div className="zone-title"><div><Ambulance size={17}/><span>Ambulance bay</span></div><b>{inbound.length} inbound</b></div>{inbound.length ? inbound.map((unit) => { const patient = state.patients.find((item) => item.id === unit.patientId)!; return <button key={unit.id} onClick={() => setSelectedId(patient.id)} className="ambulance-card"><span className="eta"><b>{unit.etaMinutes}</b>min</span><span><b>{unit.callSign}</b><small>{patient.name} · P{patient.severity}</small></span><Zap size={16}/></button>; }) : <p className="zone-empty">Bay clear</p>}</div>
          </div>
        </div>
      </div>

      <aside className="side-rail">
        <section className="panel disruption-panel"><div className="panel-head compact"><div><span className="eyebrow">Interactive controls</span><h2>Inject disruption</h2></div><AlertTriangle size={18}/></div><div className="disruption-grid"><button onClick={() => disrupt("NEW_PATIENT")}><UserRound size={16}/>New patient</button><button onClick={() => disrupt("STAFF_UNAVAILABLE")}><Users size={16}/>Staff unavailable</button><button onClick={() => disrupt("AMBULANCE_DELAY")}><Ambulance size={16}/>Delay ambulance</button><button onClick={() => disrupt("ROOM_FAULT")}><Bed size={16}/>Room fault</button><button onClick={() => disrupt("PATIENT_DETERIORATION")}><Activity size={16}/>Deterioration</button></div></section>
        <IncidentTimeline state={state}/>
        <ResourcePanel state={state} onSelect={setSelectedId}/>
        <section className="panel inspector-panel"><div className="panel-head compact"><div><span className="eyebrow">Live entity state</span><h2>Inspector</h2></div><span className="version-chip">v{state.stateVersion}</span></div><EntityInspector state={state} selectedId={selectedId}/></section>
        <section className="panel staffing-panel"><div className="panel-head compact"><div><span className="eyebrow">Resources</span><h2>Clinical team</h2></div><span className="available-count">{state.staff.filter((item) => item.status === "available").length} available</span></div><div className="staff-list">{state.staff.map((member) => <button key={member.id} onClick={() => setSelectedId(member.id)}><span className={`staff-avatar ${member.role}`}>{member.name.split(" ").at(-1)?.slice(0, 2).toUpperCase()}</span><span><b>{member.name}</b><small>{member.specialty}</small></span><i className={member.status}/></button>)}</div></section>
      </aside>
    </section>

    <OpsCopilotPanel state={state} onSelectEntity={setSelectedId} />

    <section className="audit-panel panel">
      <div className="audit-toolbar"><div><span className="eyebrow">Append-only event journal</span><h2>Detailed audit trail</h2></div><div className="audit-filters"><label><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events or entities"/></label><select value={category} onChange={(event) => setCategory(event.target.value as LogCategory | "all")}><option value="all">All categories</option>{["simulation", "patient", "staff", "room", "ambulance", "decision", "validation", "system"].map((item) => <option key={item} value={item}>{item}</option>)}</select><span>{filteredEvents.length} events</span></div></div>
      <div className="audit-body"><div className="event-list">{filteredEvents.map((event) => <EventRow key={event.id} event={event} selected={selectedEvent?.id === event.id} onClick={() => setSelectedEventId(event.id)}/>)}</div><div className="event-detail">{selectedEvent ? <><div className="detail-head"><span className={`event-level ${levelStyles[selectedEvent.level]}`}>{selectedEvent.level}</span><span>{selectedEvent.id}</span><span>{selectedEvent.type}</span></div><h3>{selectedEvent.summary}</h3><p>{selectedEvent.details}</p><dl><div><dt>Time</dt><dd>{formatSimTime(selectedEvent.simMinute)} (+{selectedEvent.simMinute}m)</dd></div><div><dt>Source</dt><dd>{selectedEvent.source}</dd></div><div><dt>State</dt><dd>Version {selectedEvent.stateVersion}</dd></div><div><dt>Correlation</dt><dd>{selectedEvent.correlationId}</dd></div></dl><div className="entity-links"><span>Entities</span>{selectedEvent.entityIds.length ? selectedEvent.entityIds.map((id) => <button key={id} onClick={() => setSelectedId(id)}>{id}</button>) : <small>None</small>}</div>{(selectedEvent.before || selectedEvent.after) && <div className="diff"><div><span>Before</span><pre>{JSON.stringify(selectedEvent.before ?? {}, null, 2)}</pre></div><ChevronRight size={16}/><div><span>After</span><pre>{JSON.stringify(selectedEvent.after ?? {}, null, 2)}</pre></div></div>}</> : <p>Select an event to inspect its complete audit record.</p>}</div></div>
    </section>
    <footer><span><ShieldCheck size={14}/>Synthetic operational simulation · Not medical guidance</span><span>Run {state.runId} · {state.events.length} immutable events · State version {state.stateVersion}</span></footer>
    {reportOpen && <div className="report-backdrop" onMouseDown={() => setDismissedReportVersion(state.stateVersion)}>
      <section className="completion-report" role="dialog" aria-modal="true" aria-labelledby="completion-report-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="report-heading"><span className="report-icon"><ShieldCheck size={23}/></span><div><span className="eyebrow">Simulation outcome report</span><h2 id="completion-report-title">All patients cleared</h2></div><span className="report-time">Finished {formatSimTime(state.simMinute)}</span></div>
        <p className="report-summary">The emergency department resolved every inbound and active patient pathway after {state.simMinute} simulated minutes. The report below summarizes the operational cost of the response.</p>
        <div className="report-metrics">
          <div><span>Patients cleared</span><strong>{state.metrics.discharged}/{state.patients.length}</strong><small>100% throughput</small></div>
          <div><span>Mean wait</span><strong>{state.metrics.meanWait}m</strong><small>Peak queue {state.metrics.peakQueue}</small></div>
          <div><span>Deteriorations</span><strong>{state.metrics.deteriorationEvents}</strong><small>Synthetic events</small></div>
          <div><span>Blocked decisions</span><strong>{blockedDecisions}</strong><small>Constraint changes logged</small></div>
        </div>
        <div className="report-detail-grid">
          <div><span>Scenario</span><b>{state.scenarioId}</b></div><div><span>Seed</span><b>{state.seed}</b></div>
          <div><span>Incidents triggered</span><b>{occurredIncidents}/{state.incidents.length}</b></div><div><span>Audit records</span><b>{state.events.length}</b></div>
          <div><span>Final room utilization</span><b>{state.metrics.roomUtilization}%</b></div><div><span>Unresolved conflicts</span><b>{state.metrics.activeConflicts}</b></div>
        </div>
        <section className="deterioration-report" aria-labelledby="deterioration-report-title">
          <div className="deterioration-heading"><div><span className="eyebrow">Clinical pressure analysis</span><h3 id="deterioration-report-title">Deterioration breakdown</h3></div><span>{deteriorationAnalysis.total} episodes</span></div>
          <p className="deterioration-definition">A deterioration is a worsening patient-state transition recorded while the patient is waiting. Ambulance acuity updates are tracked separately and are not included in the episode total.</p>
          <div className="deterioration-summary">
            <div><strong>{deteriorationAnalysis.affectedPatients}</strong><span>Patients affected</span></div>
            <div><strong>{deteriorationAnalysis.waitingRisk}</strong><span>Waiting-risk model</span></div>
            <div><strong>{deteriorationAnalysis.scheduled}</strong><span>Scheduled escalations</span></div>
            <div><strong>{deteriorationAnalysis.manual}</strong><span>Manual injections</span></div>
          </div>
          <div className="deterioration-table-wrap"><table className="deterioration-table">
            <thead><tr><th>Patient</th><th>Episodes</th><th>Priority change</th><th>First / last</th><th>Drivers</th></tr></thead>
            <tbody>{deteriorationAnalysis.rows.map((row) => <tr key={row.patient.id}>
              <td><b>{row.patient.name}</b><small>{row.patient.id} · {row.patient.injury}</small></td>
              <td><b>{row.episodes}</b>{row.acuityUpdates > 0 && <small>+{row.acuityUpdates} acuity update</small>}</td>
              <td><b>P{row.patient.initialSeverity} → P{row.patient.severity}</b><small>{row.patient.deteriorationEvents} recorded transitions</small></td>
              <td><b>{row.firstMinute === undefined ? "—" : formatSimTime(row.firstMinute)}</b><small>{row.lastMinute === undefined ? "—" : formatSimTime(row.lastMinute)}</small></td>
              <td><span>{row.sources.join(", ")}</span></td>
            </tr>)}</tbody>
          </table></div>
          {deteriorationAnalysis.acuityUpdates > 0 && <p className="acuity-note"><Ambulance size={14}/>{deteriorationAnalysis.acuityUpdates} ambulance acuity update{deteriorationAnalysis.acuityUpdates === 1 ? " was" : "s were"} logged outside the deterioration total.</p>}
        </section>
        <div className="report-callout"><Activity size={17}/><p><b>Operational result:</b> all patients completed treatment, with every assignment, deterioration, equipment failure, and recovery retained in the append-only audit trail.</p></div>
        <div className="report-actions"><button onClick={exportLog}><Download size={15}/>Download full audit</button><button className="primary" onClick={() => setDismissedReportVersion(state.stateVersion)}>Close report</button></div>
      </section>
    </div>}
  </main>;
}

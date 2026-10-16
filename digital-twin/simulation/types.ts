export type Severity = 1 | 2 | 3 | 4 | 5;
export type PatientCondition = "stable" | "worsening" | "critical";
export type PatientStatus = "inbound" | "waiting" | "treating" | "discharged";
export type RoomStatus = "ready" | "reserved" | "occupied" | "dirty" | "cleaning" | "unavailable";
export type StaffStatus = "available" | "busy" | "unavailable";
export type LogLevel = "info" | "notice" | "warning" | "critical" | "success";
export type LogCategory = "simulation" | "patient" | "staff" | "room" | "ambulance" | "decision" | "validation" | "system";
export type ResourceType = "ct" | "ventilator" | "blood" | "isolation";
export type ResourceStatus = "available" | "constrained" | "offline";

export interface Patient {
  id: string;
  name: string;
  age: number;
  injury: string;
  severity: Severity;
  initialSeverity: Severity;
  condition: PatientCondition;
  status: PatientStatus;
  requiredRoomType: Room["type"];
  requiredResources: ResourceType[];
  requiredSpecialty?: string;
  waitMinutes: number;
  treatmentMinutes: number;
  remainingMinutes: number;
  assignedRoomId?: string;
  assignedDoctorId?: string;
  assignedNurseId?: string;
  ambulanceId?: string;
  baseHazard: number;
  deteriorationEvents: number;
  blockedReason?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: "doctor" | "nurse";
  specialty: string;
  status: StaffStatus;
  patientId?: string;
  roomId?: string;
}

export interface Room {
  id: string;
  label: string;
  type: "resus" | "acute" | "exam";
  status: RoomStatus;
  patientId?: string;
  reservedForPatientId?: string;
  cleaningMinutesRemaining: number;
}

export interface AmbulanceUnit {
  id: string;
  callSign: string;
  patientId: string;
  etaMinutes: number;
  status: "inbound" | "arrived";
}

export interface CriticalResource {
  id: string;
  label: string;
  type: ResourceType;
  status: ResourceStatus;
  capacity: number;
  assignedPatientIds: string[];
  offlineUntilMinute?: number;
}

export interface ScenarioIncident {
  id: string;
  minute: number;
  type: "MCI_DECLARED" | "CT_OFFLINE" | "ACUITY_UPDATE" | "STAFF_LOSS" | "ROOM_FAULT" | "SECONDARY_DETERIORATION" | "CT_RESTORED" | "SURGE_TEAM_ARRIVES" | "BLOOD_RESTOCKED";
  title: string;
  status: "scheduled" | "occurred";
  entityIds: string[];
}

export interface AuditEvent {
  id: string;
  correlationId: string;
  simMinute: number;
  stateVersion: number;
  type: string;
  category: LogCategory;
  level: LogLevel;
  source: string;
  summary: string;
  details: string;
  entityIds: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface SimulationMetrics {
  waiting: number;
  treating: number;
  discharged: number;
  critical: number;
  occupiedRooms: number;
  roomUtilization: number;
  meanWait: number;
  peakQueue: number;
  deteriorationEvents: number;
  inbound: number;
  activeConflicts: number;
  offlineResources: number;
  resourcePressure: number;
}

export interface SimulationState {
  runId: string;
  scenarioId: string;
  seed: number;
  rngState: number;
  simMinute: number;
  durationMinutes: number;
  stateVersion: number;
  eventSequence: number;
  patients: Patient[];
  staff: StaffMember[];
  rooms: Room[];
  ambulances: AmbulanceUnit[];
  resources: CriticalResource[];
  incidents: ScenarioIncident[];
  events: AuditEvent[];
  metrics: SimulationMetrics;
}

export type DisruptionType = "NEW_PATIENT" | "STAFF_UNAVAILABLE" | "AMBULANCE_DELAY" | "ROOM_FAULT" | "PATIENT_DETERIORATION";

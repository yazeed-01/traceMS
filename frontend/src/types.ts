export interface PipelineService {
  name: string
  url: string
  icon: string
  description: string
  input_type: string
  output_type: string
}

export interface PipelineResponse {
  services: PipelineService[]
}

export interface PipelineUpdateRequest {
  services: Array<{
    name: string
    url: string
    icon?: string
    description?: string
    input_type?: string | null
    output_type?: string | null
  }>
}

export type ProcessRequestBody =
  | { text: string }
  | { type: string; data: string; metadata?: Record<string, unknown> }

export interface SSEStep {
  service: string
  input?: string
  output?: string
  status?: string
  payload_type?: string
}

export interface SSEDone {
  trace_id: string
  result?: unknown
  steps?: unknown[]
  payload?: Record<string, unknown>
}

export interface RunRecord {
  traceId: string
  timestamp: number
  status: 'ok' | 'error'
  stepsCount: number
  durationMs: number
  errorMessage?: string
}

export const RUN_HISTORY_STORAGE_KEY = 'tracems-run-history'
export const MAX_RUN_HISTORY = 500

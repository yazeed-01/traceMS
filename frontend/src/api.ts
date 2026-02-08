import type { PipelineResponse, PipelineUpdateRequest, ProcessRequestBody } from './types'

const base = '' // same origin when served by Go

export async function getPipeline(): Promise<PipelineResponse> {
  const res = await fetch(`${base}/api/pipeline`)
  if (!res.ok) throw new Error(res.statusText)
  return res.json()
}

export async function putPipeline(
  body: PipelineUpdateRequest
): Promise<{ ok: boolean; saved?: boolean; detail?: string }> {
  const res = await fetch(`${base}/api/pipeline`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export type SSEEvent = 
  | { event: 'started'; data: { trace_id: string; payload: unknown } }
  | { event: 'step'; data: { service: string; input?: string; output?: string; status?: string; payload_type?: string } }
  | { event: 'error'; data: { service: string; error: string } }
  | { event: 'done'; data: { trace_id: string; result?: unknown; steps?: unknown[]; payload?: Record<string, unknown> } }

export async function processStream(
  body: ProcessRequestBody,
  onEvent: (ev: SSEEvent) => void
): Promise<void> {
  const res = await fetch(`${base}/process/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || res.statusText)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No body')
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const block of parts) {
      let event = 'message'
      let data: unknown = null
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) {
          try {
            data = JSON.parse(line.slice(5).trim())
          } catch {
            data = line.slice(5).trim()
          }
        }
      }
      if (data !== null) onEvent({ event, data } as SSEEvent)
    }
  }
  if (buf.trim()) {
    let event = 'message'
    let data: unknown = null
    for (const line of (buf + '\n\n').split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) {
        try {
          data = JSON.parse(line.slice(5).trim())
        } catch {
          data = line.slice(5).trim()
        }
      }
    }
    if (data !== null) onEvent({ event, data } as SSEEvent)
  }
}

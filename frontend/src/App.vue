<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { getPipeline, putPipeline, processStream } from './api'
import type { PipelineService, ProcessRequestBody, SSEEvent } from './api'
import type { PipelineUpdateRequest } from './types'
import { useRunHistory } from './useRunHistory'
import AnalyticsPanel from './components/AnalyticsPanel.vue'

const JAEGER_BASE = 'http://localhost:16686'
const PAYLOAD_TYPES = ['any', 'text', 'json', 'image', 'video', 'binary']
const STATIONS_PER_ROW = 5
const textPlaceholderText = 'e.g. hello world'
const textPlaceholderJson = 'e.g. {"key": "value"}'

const currentServices = ref<PipelineService[]>([])
const configOpen = ref(false)
const configError = ref('')
const configSuccess = ref('')
const editorRows = ref<PipelineService[]>([])

const inputType = ref<'text' | 'json' | 'image' | 'video' | 'file'>('text')
const textInput = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const processError = ref('')
const running = ref(false)

const stationOrder = ref<string[]>(['gateway'])
const stationState = ref<Record<string, { state: string; input: string; output: string }>>({})
const currentTrainIndex = ref(-1)
const railPathD = ref('')
const expandRailPathD = ref('')

const traceId = ref('')
const resultPayload = ref<Record<string, unknown> | null>(null)
const resultSteps = ref<unknown[]>([])
const showResult = ref(false)

const expandOpen = ref(false)
const expandOverlayRef = ref<HTMLElement | null>(null)
const expandPan = ref({ x: 0, y: 0 })
const expandScale = ref(1)
const expandPanning = ref(false)
const expandStart = ref({ x: 0, y: 0, panX: 0, panY: 0 })

const { runHistory, addRun, importData, clearHistory } = useRunHistory()
const runStartTime = ref(0)
const pipelineExportSuccess = ref('')
const pipelineImportError = ref('')
const pipelineImportSuccess = ref('')

const numRows = computed(() =>
  stationOrder.value.length ? Math.ceil(stationOrder.value.length / STATIONS_PER_ROW) : 1
)

function getGridPos(index: number) {
  if (index < 0) return { col: 0, row: 0 }
  const row = Math.floor(index / STATIONS_PER_ROW)
  const col = index % STATIONS_PER_ROW
  return { row, col }
}

const trainStyle = computed(() => {
  const i = currentTrainIndex.value
  if (i < 0) return { left: '', top: '', opacity: 0 }
  const { row, col } = getGridPos(i)
  const leftPct = ((col + 0.5) / STATIONS_PER_ROW) * 100
  const topPct = ((row + 0.5) / numRows.value) * 100
  return {
    left: `calc(${leftPct}% - 14px)`,
    top: `calc(${topPct}% - 14px)`,
    opacity: 1
  }
})

function drawRailPath() {
  const n = stationOrder.value.length
  if (!n) return
  const numRows = Math.ceil(n / STATIONS_PER_ROW)
  const pts: string[] = []
  for (let r = 0; r < numRows; r++) {
    const count = Math.min(STATIONS_PER_ROW, n - r * STATIONS_PER_ROW)
    const cols = Array.from({ length: count }, (_, c) => c)
    if (r % 2 === 1) cols.reverse()
    const y = ((r + 0.5) / numRows) * 100
    for (let i = 0; i < cols.length; i++) {
      const x = ((cols[i] + 0.5) / STATIONS_PER_ROW) * 100
      pts.push(`${x} ${y}`)
    }
    if (r < numRows - 1) {
      const lastX = ((cols[cols.length - 1] + 0.5) / STATIONS_PER_ROW) * 100
      const nextY = ((r + 1.5) / numRows) * 100
      pts.push(`${lastX} ${nextY}`)
    }
  }
  railPathD.value = 'M ' + pts.join(' L ')
  expandRailPathD.value = railPathD.value
}

const expandTrainStyle = computed(() => {
  const i = currentTrainIndex.value
  if (i < 0) return { left: '', top: '', opacity: 0 }
  const { row, col } = getGridPos(i)
  const leftPct = ((col + 0.5) / STATIONS_PER_ROW) * 100
  const topPct = ((row + 0.5) / numRows.value) * 100
  return {
    left: `${leftPct}%`,
    top: `${topPct}%`,
    opacity: 1
  }
})

const expandViewportStyle = computed(() => ({
  transform: `translate(${expandPan.value.x}px, ${expandPan.value.y}px) scale(${expandScale.value})`
}))

function loadPipeline() {
  getPipeline()
    .then((data) => {
      currentServices.value = data.services
      stationOrder.value = ['gateway', ...data.services.map((s) => s.name)]
      editorRows.value = data.services.length
        ? [...data.services]
        : [
            { name: 'validator', url: 'http://validator:8001', icon: '✓', description: '', input_type: 'any', output_type: 'any' },
            { name: 'transformer', url: 'http://transformer:8002', icon: '⇅', description: '', input_type: 'any', output_type: 'any' },
            { name: 'enricher', url: 'http://enricher:8003', icon: '⊕', description: '', input_type: 'any', output_type: 'any' },
            { name: 'persister', url: 'http://persister:8004', icon: '💾', description: '', input_type: 'any', output_type: 'any' }
          ]
      Object.keys(stationState.value).forEach((k) => {
        stationState.value[k] = { state: '', input: '', output: '' }
      })
      drawRailPath()
    })
    .catch(() => {
      stationOrder.value = ['gateway', 'validator', 'transformer', 'enricher', 'persister']
      editorRows.value = [
        { name: 'validator', url: 'http://validator:8001', icon: '✓', description: '', input_type: 'any', output_type: 'any' },
        { name: 'transformer', url: 'http://transformer:8002', icon: '⇅', description: '', input_type: 'any', output_type: 'any' },
        { name: 'enricher', url: 'http://enricher:8003', icon: '⊕', description: '', input_type: 'any', output_type: 'any' },
        { name: 'persister', url: 'http://persister:8004', icon: '💾', description: '', input_type: 'any', output_type: 'any' }
      ]
      drawRailPath()
    })
}

onMounted(loadPipeline)
watch(stationOrder, drawRailPath, { deep: true })

function toggleConfig() {
  configOpen.value = !configOpen.value
  if (configOpen.value) editorRows.value = [...currentServices.value]
}

function addService() {
  editorRows.value.push({
    name: '',
    url: '',
    icon: '•',
    description: '',
    input_type: 'any',
    output_type: 'any'
  })
}

function removeService(idx: number) {
  editorRows.value.splice(idx, 1)
}

function moveService(idx: number, delta: number) {
  const next = idx + delta
  if (next < 0 || next >= editorRows.value.length) return
  ;[editorRows.value[idx], editorRows.value[next]] = [editorRows.value[next], editorRows.value[idx]]
}

function exportPipeline() {
  getPipeline()
    .then((data) => {
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tracems-pipeline-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      pipelineExportSuccess.value = 'Pipeline exported.'
      setTimeout(() => { pipelineExportSuccess.value = '' }, 2000)
    })
    .catch(() => {
      pipelineImportError.value = 'Failed to load pipeline for export.'
    })
}

const pipelineImportInput = ref<HTMLInputElement | null>(null)
function triggerPipelineImport() {
  pipelineImportError.value = ''
  pipelineImportSuccess.value = ''
  pipelineImportInput.value?.click()
}

function onPipelineImport(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const json = JSON.parse(String(reader.result ?? '')) as { services?: PipelineService[] }
      if (!json?.services || !Array.isArray(json.services) || json.services.length === 0) {
        pipelineImportError.value = 'Invalid file: expected { "services": [...] } with at least one service.'
        return
      }
      putPipeline({ services: json.services }).then((res) => {
        if (res.ok) {
          pipelineImportSuccess.value = res.saved ? 'Pipeline imported and saved.' : 'Pipeline imported.'
          loadPipeline()
        } else {
          pipelineImportError.value = res.detail || 'Import failed'
        }
      })
    } catch {
      pipelineImportError.value = 'Invalid JSON file.'
    }
  }
  reader.readAsText(file)
}

function savePipeline() {
  configError.value = ''
  configSuccess.value = ''
  const list = editorRows.value.filter((r) => r.name?.trim())
  if (!list.length) {
    configError.value = 'Add at least one microservice (name and URL required).'
    return
  }
  if (list.some((s) => !s.name.trim() || !s.url.trim())) {
    configError.value = 'Every service must have a name and URL.'
    return
  }
  const body: PipelineUpdateRequest = {
    services: list.map((s) => ({
      name: s.name.trim(),
      url: s.url.trim(),
      icon: s.icon?.trim() || '•',
      description: s.description?.trim() || '',
      input_type: s.input_type?.trim() || null,
      output_type: s.output_type?.trim() || null
    }))
  }
  putPipeline(body).then((res) => {
    if (res.ok) {
      configSuccess.value = res.saved ? 'Pipeline saved. Config persisted to file.' : 'Pipeline saved. (In-memory only; set WRITABLE_PIPELINE_PATH to persist.)'
      currentServices.value = list.map((s) => ({ ...s, name: s.name.trim(), url: s.url.trim() }))
      loadPipeline()
    } else {
      configError.value = res.detail || 'Save failed'
    }
  })
}

function buildRequestBody(): Promise<ProcessRequestBody> | ProcessRequestBody {
  if (inputType.value === 'text') return { text: textInput.value }
  if (inputType.value === 'json') return { type: 'json', data: textInput.value, metadata: {} }
  const file = fileInput.value?.files?.[0]
  if (!file) return { text: '' }
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const result = r.result as string
      const b64 = result.includes(',') ? result.split(',')[1]! : result
      const type = inputType.value === 'file' ? 'binary' : inputType.value
      resolve({
        type,
        data: b64,
        metadata: { filename: file.name, content_type: file.type || 'application/octet-stream' }
      })
    }
    r.onerror = () => reject(new Error('Failed to read file'))
    r.readAsDataURL(file)
  })
}

function resetRun() {
  stationOrder.value.forEach((name) => {
    stationState.value[name] = { state: '', input: '', output: '' }
  })
  currentTrainIndex.value = -1
  traceId.value = ''
  showResult.value = false
}

async function runPipeline() {
  processError.value = ''
  resetRun()
  running.value = true
  try {
    const body = await buildRequestBody()
    if ('text' in body && !body.text && !('data' in body)) {
      processError.value = 'Choose a file for Image/Video/File input.'
      running.value = false
      return
    }
    await processStream(body, (ev: SSEEvent) => {
      if (ev.event === 'started') {
        runStartTime.value = Date.now()
        traceId.value = (ev.data as { trace_id: string }).trace_id
        stationState.value['gateway'] = { state: 'done', input: '', output: 'Sent' }
        currentTrainIndex.value = 1
        const next = stationOrder.value[1]
        if (next) stationState.value[next] = { ...stationState.value[next], state: 'processing', input: '', output: '' }
      } else if (ev.event === 'step') {
        const d = ev.data as { service: string; input?: string; output?: string; payload_type?: string }
        const svc = d.service?.toLowerCase() ?? ''
        stationState.value[svc] = { state: 'done', input: d.input ?? '', output: d.output ?? '' }
        const idx = stationOrder.value.indexOf(svc)
        const nextIdx = idx + 1
        if (nextIdx < stationOrder.value.length) {
          currentTrainIndex.value = nextIdx
          const nextName = stationOrder.value[nextIdx]
          if (nextName) stationState.value[nextName] = { ...stationState.value[nextName], state: 'processing', input: '', output: '' }
        } else {
          currentTrainIndex.value = stationOrder.value.length
        }
      } else if (ev.event === 'error') {
        const d = ev.data as { service: string; error: string }
        stationState.value[d.service?.toLowerCase() ?? ''] = { state: 'error', input: '', output: d.error ?? 'Error' }
        processError.value = (d.service ?? 'Service') + ': ' + (d.error ?? 'error')
        const durationMs = runStartTime.value ? Date.now() - runStartTime.value : 0
        addRun({
          traceId: traceId.value || 'unknown',
          timestamp: Date.now(),
          status: 'error',
          stepsCount: stationOrder.value.length,
          durationMs,
          errorMessage: processError.value
        })
      } else if (ev.event === 'done') {
        currentTrainIndex.value = stationOrder.value.length
        const d = ev.data as { trace_id?: string; result?: unknown; steps?: unknown[]; payload?: Record<string, unknown> }
        if (d.trace_id) traceId.value = d.trace_id
        resultPayload.value = d.payload ?? null
        resultSteps.value = d.steps ?? []
        showResult.value = true
        const durationMs = runStartTime.value ? Date.now() - runStartTime.value : 0
        addRun({
          traceId: traceId.value,
          timestamp: Date.now(),
          status: 'ok',
          stepsCount: (d.steps ?? []).length,
          durationMs
        })
      }
    })
  } catch (e) {
    processError.value = (e as Error).message ?? 'Request failed'
    const durationMs = runStartTime.value ? Date.now() - runStartTime.value : 0
    addRun({
      traceId: traceId.value || 'unknown',
      timestamp: Date.now(),
      status: 'error',
      stepsCount: stationOrder.value.length,
      durationMs,
      errorMessage: processError.value
    })
  } finally {
    running.value = false
  }
}

function getStationDisplay(name: string) {
  if (name === 'gateway') return { icon: '🚉', label: 'Gateway' }
  const s = currentServices.value.find((x) => x.name === name)
  return { icon: s?.icon ?? '•', label: name }
}

function openExpand() {
  expandOpen.value = true
  expandPan.value = { x: 0, y: 0 }
  expandScale.value = 1
  nextTick(() => expandOverlayRef.value?.focus())
}

function closeExpand() {
  expandOpen.value = false
}

function onExpandKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeExpand()
  if (e.key === '+' || e.key === '=') {
    expandScale.value = Math.min(3, expandScale.value + 0.15)
    e.preventDefault()
  }
  if (e.key === '-') {
    expandScale.value = Math.max(0.2, expandScale.value - 0.15)
    e.preventDefault()
  }
  const step = 40
  if (e.key === 'ArrowLeft') {
    expandPan.value = { ...expandPan.value, x: expandPan.value.x + step }
    e.preventDefault()
  }
  if (e.key === 'ArrowRight') {
    expandPan.value = { ...expandPan.value, x: expandPan.value.x - step }
    e.preventDefault()
  }
  if (e.key === 'ArrowUp') {
    expandPan.value = { ...expandPan.value, y: expandPan.value.y + step }
    e.preventDefault()
  }
  if (e.key === 'ArrowDown') {
    expandPan.value = { ...expandPan.value, y: expandPan.value.y - step }
    e.preventDefault()
  }
}

function onExpandWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  expandScale.value = Math.max(0.2, Math.min(3, expandScale.value + delta))
}

function onExpandMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('button')) return
  expandPanning.value = true
  expandStart.value = { x: e.clientX, y: e.clientY, panX: expandPan.value.x, panY: expandPan.value.y }
}

function onExpandMouseMove(e: MouseEvent) {
  if (!expandPanning.value) return
  expandPan.value = {
    x: expandStart.value.panX + (e.clientX - expandStart.value.x),
    y: expandStart.value.panY + (e.clientY - expandStart.value.y)
  }
}

function onExpandMouseUp() {
  expandPanning.value = false
}

function renderResultType() {
  const p = resultPayload.value
  const type = (p?.type as string) ?? 'text'
  const data = p?.data
  if (type === 'image' && typeof data === 'string' && data) return 'image'
  if (type === 'video' && typeof data === 'string' && data) return 'video'
  if (type === 'json') return 'json'
  if (type === 'binary') return 'binary'
  return 'text'
}

function formatResultJson(): string {
  const p = resultPayload.value
  const data = p?.data
  if (typeof data !== 'string') return String(data ?? '')
  try {
    return JSON.stringify(JSON.parse(data), null, 2)
  } catch {
    return data
  }
}

const resultTextDisplay = computed(() => {
  const p = resultPayload.value
  if (p?.data != null) return String(p.data)
  return JSON.stringify({ steps: resultSteps.value }, null, 2)
})

const resultBinaryFilename = computed(() => (resultPayload.value?.metadata as Record<string, string>)?.filename ?? 'file')
const resultBinaryLength = computed(() => (typeof resultPayload.value?.data === 'string' ? resultPayload.value.data.length : 0))
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>TraceMS</h1>
      <p class="tagline">Pipeline dashboard · track any number of microservices · text, JSON, images, video, files</p>
    </header>

    <section class="config-section" :class="{ open: configOpen }">
      <h2 class="config-toggle" @click="toggleConfig">
        Configure microservices <span class="toggle-icon">▼</span>
      </h2>
      <Transition name="config-panel">
      <div v-if="configOpen" class="config-panel">
        <p class="config-hint">
          Each microservice has a <strong>URL</strong> (e.g. <code>http://localhost:8001</code> or
          <code>validator:8001</code>) and optional <strong>input/output types</strong>. Order = execution order.
        </p>
        <div class="config-actions">
          <button type="button" class="btn-secondary" @click="addService">+ Add microservice</button>
          <button type="button" class="btn-primary" @click="savePipeline">Save pipeline</button>
          <button type="button" class="btn-secondary" @click="exportPipeline">Export pipeline</button>
          <input ref="pipelineImportInput" type="file" accept=".json,application/json" class="hidden-input" @change="onPipelineImport" />
          <button type="button" class="btn-secondary" @click="triggerPipelineImport">Import pipeline</button>
        </div>
        <div v-if="configError" class="error">{{ configError }}</div>
        <div v-if="configSuccess" class="success">{{ configSuccess }}</div>
        <div v-if="pipelineExportSuccess" class="success">{{ pipelineExportSuccess }}</div>
        <div v-if="pipelineImportError" class="error">{{ pipelineImportError }}</div>
        <div v-if="pipelineImportSuccess" class="success">{{ pipelineImportSuccess }}</div>
        <div class="services-editor">
          <div v-for="(row, i) in editorRows" :key="i" class="service-row">
            <label class="field-name">Name <input v-model="row.name" type="text" placeholder="e.g. validator" /></label>
            <label class="field-url">URL <input v-model="row.url" type="text" placeholder="http://localhost:8001" /></label>
            <label class="field-icon">Icon <input v-model="row.icon" type="text" placeholder="•" /></label>
            <label class="field-desc">Description <input v-model="row.description" type="text" placeholder="Optional" /></label>
            <label class="field-input-type">Input type <select v-model="row.input_type"><option v-for="t in PAYLOAD_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
            <label class="field-output-type">Output type <select v-model="row.output_type"><option v-for="t in PAYLOAD_TYPES" :key="t" :value="t">{{ t }}</option></select></label>
            <div class="row-actions">
              <button type="button" @click="moveService(i, -1)">↑</button>
              <button type="button" @click="moveService(i, 1)">↓</button>
              <button type="button" class="remove" @click="removeService(i)">✕</button>
            </div>
          </div>
        </div>
      </div>
      </Transition>
    </section>

    <AnalyticsPanel
      :runs="runHistory"
      :on-import-data="importData"
      :on-clear-history="clearHistory"
    />

    <section class="input-section">
      <form class="process-form" @submit.prevent="runPipeline">
        <label>Input type</label>
        <div class="input-type-tabs">
          <label v-for="t in ['text', 'json', 'image', 'video', 'file']" :key="t" class="tab" :class="{ 'has-checked': inputType === t }">
            <input v-model="inputType" type="radio" :value="t" />
            {{ t }}
          </label>
        </div>
        <div v-show="inputType === 'text' || inputType === 'json'" class="input-area">
          <label for="text">Enter text</label>
          <textarea id="text" v-model="textInput" name="text" rows="3" :placeholder="inputType === 'json' ? textPlaceholderJson : textPlaceholderText"></textarea>
        </div>
        <div v-show="inputType === 'image' || inputType === 'video' || inputType === 'file'" class="input-area">
          <label for="file">Choose file</label>
          <input ref="fileInput" id="file" type="file" accept="*" />
          <span class="file-hint">{{ inputType === 'image' ? 'Image (any)' : inputType === 'video' ? 'Video (any)' : 'Any file' }}</span>
        </div>
        <div class="input-row">
          <button type="submit" class="btn-process" :class="{ running }" :disabled="running">
            <span class="btn-text">Run pipeline</span>
            <span class="btn-icon">▶</span>
          </button>
        </div>
        <div v-if="processError" class="error">{{ processError }}</div>
      </form>
      <div v-if="traceId" class="trace-info">
        <span class="trace-label">Trace ID</span>
        <code>{{ traceId }}</code>
        <a :href="`${JAEGER_BASE}/trace/${traceId}`" target="_blank" rel="noopener" class="jaeger-link">View in Jaeger</a>
      </div>
    </section>

    <section class="pipeline-section">
      <div class="pipeline-head">
        <h2 class="pipeline-title">Pipeline</h2>
        <button type="button" class="btn-expand" @click="openExpand">Expand</button>
      </div>
      <div class="track">
        <div class="pipeline-cursor" :class="{ visible: currentTrainIndex >= 0 }" :style="trainStyle" aria-hidden="true" title="Current step">
          <span class="pipeline-cursor-icon" aria-hidden="true"></span>
        </div>
        <svg class="rail-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path :d="railPathD" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        <div class="stations">
          <template v-for="name in stationOrder" :key="name">
            <div class="station" :class="[stationState[name]?.state || '']" :data-service="name">
              <div class="station-icon">{{ getStationDisplay(name).icon }}</div>
              <div class="station-name">{{ getStationDisplay(name).label }}</div>
              <div class="station-detail" :class="[stationState[name]?.state === 'processing' ? 'processing' : '', stationState[name]?.state === 'done' ? 'ok' : '']" data-detail="status">{{ stationState[name]?.state || '—' }}</div>
              <div class="station-detail" data-detail="input">{{ stationState[name]?.input || '—' }}</div>
              <div class="station-detail" data-detail="output">{{ stationState[name]?.output || '—' }}</div>
            </div>
          </template>
        </div>
      </div>
    </section>

    <Transition name="expand-overlay">
    <div
      v-if="expandOpen"
      ref="expandOverlayRef"
      class="expand-overlay"
      tabindex="-1"
      aria-hidden="false"
      @keydown="onExpandKeydown"
    >
      <div class="expand-toolbar">
        <span class="expand-hint">Drag to pan · Scroll to zoom · ↑↓←→ move · +/− zoom · Esc close</span>
        <button type="button" class="btn-expand-close" @click="closeExpand">Collapse</button>
      </div>
      <div
        class="expand-board"
        @mousedown="onExpandMouseDown"
        @mousemove="onExpandMouseMove"
        @mouseup="onExpandMouseUp"
        @mouseleave="onExpandMouseUp"
        @wheel.prevent="onExpandWheel"
      >
        <div class="expand-viewport" :style="expandViewportStyle">
          <div class="expand-track">
            <svg class="expand-rail-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path :d="expandRailPathD" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
            </svg>
            <div class="expand-stations">
              <div v-for="name in stationOrder" :key="'ex-' + name" class="station" :class="[stationState[name]?.state || '']" :data-service="name">
                <div class="station-icon">{{ getStationDisplay(name).icon }}</div>
                <div class="station-name">{{ getStationDisplay(name).label }}</div>
                <div class="station-detail" data-detail="status">{{ stationState[name]?.state || '—' }}</div>
                <div class="station-detail" data-detail="input">{{ stationState[name]?.input || '—' }}</div>
                <div class="station-detail" data-detail="output">{{ stationState[name]?.output || '—' }}</div>
              </div>
            </div>
            <div class="pipeline-cursor expand-cursor" :class="{ visible: currentTrainIndex >= 0 }" :style="expandTrainStyle" aria-hidden="true" title="Current step">
              <span class="pipeline-cursor-icon" aria-hidden="true"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <section v-show="showResult" class="result-section">
      <h2>Result</h2>
      <div class="result-body">
        <template v-if="renderResultType() === 'image' && resultPayload?.data">
          <img :src="`data:${(resultPayload.metadata as Record<string, string>)?.content_type || 'image/png'};base64,${resultPayload.data}`" alt="Result" style="max-width: 100%" />
        </template>
        <template v-else-if="renderResultType() === 'video' && resultPayload?.data">
          <video :src="`data:${(resultPayload.metadata as Record<string, string>)?.content_type || 'video/mp4'};base64,${resultPayload.data}`" controls style="max-width: 100%"></video>
        </template>
        <template v-else-if="renderResultType() === 'json'">
          <pre>{{ formatResultJson() }}</pre>
        </template>
        <template v-else-if="renderResultType() === 'binary'">
          <p>Download: {{ resultBinaryFilename }} ({{ resultBinaryLength }} chars base64)</p>
        </template>
        <template v-else>
          <pre>{{ resultTextDisplay }}</pre>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
</style>

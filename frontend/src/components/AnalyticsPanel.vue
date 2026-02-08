<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { Chart, registerables } from 'chart.js'
import type { RunRecord } from '../types'

Chart.register(...registerables)

const props = defineProps<{
  runs: RunRecord[]
  onImportData: (json: string) => { ok: boolean; message: string; imported: number }
  onClearHistory: () => void
}>()

const runsOverTimeCanvas = ref<HTMLCanvasElement | null>(null)
const successErrorCanvas = ref<HTMLCanvasElement | null>(null)
const chartRuns = ref<Chart | null>(null)
const chartSuccess = ref<Chart | null>(null)

const analyticsOpen = ref(false)
const importError = ref('')
const importSuccess = ref('')

const successCount = computed(() => props.runs.filter((r) => r.status === 'ok').length)
const errorCount = computed(() => props.runs.filter((r) => r.status === 'error').length)
const runsByDay = computed(() => {
  const map = new Map<string, number>()
  props.runs.forEach((r) => {
    const day = new Date(r.timestamp).toLocaleDateString()
    map.set(day, (map.get(day) ?? 0) + 1)
  })
  const entries = [...map.entries()].sort(
    (a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()
  )
  return { labels: entries.map((e) => e[0]), data: entries.map((e) => e[1]) }
})

function buildCharts() {
  if (!runsOverTimeCanvas.value || !successErrorCanvas.value) return
  chartRuns.value?.destroy()
  chartSuccess.value?.destroy()

  chartRuns.value = new Chart(runsOverTimeCanvas.value, {
    type: 'bar',
    data: {
      labels: runsByDay.value.labels,
      datasets: [
        {
          label: 'Runs',
          data: runsByDay.value.data,
          backgroundColor: 'rgba(88, 166, 255, 0.6)',
          borderColor: 'rgba(88, 166, 255, 1)',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { title: { display: true, text: 'Date' } }
      }
    }
  })

  chartSuccess.value = new Chart(successErrorCanvas.value, {
    type: 'doughnut',
    data: {
      labels: ['Success', 'Error'],
      datasets: [
        {
          data: [successCount.value, errorCount.value],
          backgroundColor: ['rgba(63, 185, 80, 0.8)', 'rgba(248, 81, 73, 0.8)'],
          borderColor: ['rgb(63, 185, 80)', 'rgb(248, 81, 73)'],
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  })
}

watch(
  () => [props.runs.length, analyticsOpen.value] as const,
  () => {
    if (analyticsOpen.value) {
      nextTick(() => buildCharts())
    }
  },
  { deep: true }
)

onMounted(() => {
  if (analyticsOpen.value) nextTick(() => buildCharts())
})

onBeforeUnmount(() => {
  chartRuns.value?.destroy()
  chartSuccess.value?.destroy()
})

function exportChartData() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), runs: props.runs }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tracems-runs-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importError.value = ''
  importSuccess.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result ?? '')
    const result = props.onImportData(text)
    if (result.ok) {
      importSuccess.value = result.message
    } else {
      importError.value = result.message
    }
    setTimeout(() => {
      importSuccess.value = ''
      importError.value = ''
    }, 4000)
  }
  reader.onerror = () => {
    importError.value = 'Failed to read file'
  }
  reader.readAsText(file)
}

function triggerImport() {
  const input = document.getElementById('analytics-import-input') as HTMLInputElement
  input?.click()
}

function clearHistory() {
  props.onClearHistory()
}
</script>

<template>
  <section class="analytics-section" :class="{ open: analyticsOpen }">
    <h2 class="analytics-toggle" @click="analyticsOpen = !analyticsOpen">
      Analytics &amp; data
      <span class="toggle-icon">▼</span>
    </h2>
    <Transition name="config-panel">
      <div v-if="analyticsOpen" class="analytics-panel">
        <div class="analytics-stats">
          <div class="stat-card">
            <span class="stat-value">{{ runs.length }}</span>
            <span class="stat-label">Total runs</span>
          </div>
          <div class="stat-card success">
            <span class="stat-value">{{ successCount }}</span>
            <span class="stat-label">Success</span>
          </div>
          <div class="stat-card error">
            <span class="stat-value">{{ errorCount }}</span>
            <span class="stat-label">Errors</span>
          </div>
        </div>
        <div class="charts-row">
          <div class="chart-wrap">
            <h3>Runs over time</h3>
            <div class="chart-container">
              <canvas ref="runsOverTimeCanvas"></canvas>
            </div>
          </div>
          <div class="chart-wrap">
            <h3>Success vs error</h3>
            <div class="chart-container chart-doughnut">
              <canvas ref="successErrorCanvas"></canvas>
            </div>
          </div>
        </div>
        <div class="data-actions">
          <button type="button" class="btn-secondary" @click="exportChartData">Export run data</button>
          <input
            id="analytics-import-input"
            type="file"
            accept=".json,application/json"
            class="hidden-input"
            @change="onImportFile"
          />
          <button type="button" class="btn-secondary" @click="triggerImport">Import run data</button>
          <button type="button" class="btn-secondary danger" @click="clearHistory">Clear history</button>
        </div>
        <div v-if="importError" class="error">{{ importError }}</div>
        <div v-if="importSuccess" class="success">{{ importSuccess }}</div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.analytics-section {
  margin-bottom: 1.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.analytics-toggle {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.analytics-toggle:hover {
  background: var(--surface2);
}

.toggle-icon {
  font-size: 0.8rem;
  color: var(--text-muted);
  transition: transform 0.25s ease;
}

.analytics-section.open .toggle-icon {
  transform: rotate(-90deg);
}

.analytics-panel {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
}

.analytics-stats {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
}

.stat-card {
  flex: 1;
  min-width: 80px;
  padding: 0.75rem 1rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  text-align: center;
}

.stat-card .stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text);
}

.stat-card .stat-label {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.stat-card.success .stat-value { color: var(--success); }
.stat-card.error .stat-value { color: var(--error); }

.charts-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}

@media (max-width: 700px) {
  .charts-row { grid-template-columns: 1fr; }
}

.chart-wrap h3 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-muted);
}

.chart-container {
  height: 200px;
  position: relative;
}

.chart-doughnut {
  max-width: 280px;
  margin: 0 auto;
}

.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.hidden-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.btn-secondary.danger {
  color: var(--error);
}

.btn-secondary.danger:hover {
  background: rgba(248, 81, 73, 0.15);
}
</style>

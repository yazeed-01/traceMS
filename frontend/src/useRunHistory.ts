import { ref, watch } from 'vue'
import type { RunRecord } from './types'
import { RUN_HISTORY_STORAGE_KEY, MAX_RUN_HISTORY } from './types'

function loadFromStorage(): RunRecord[] {
  try {
    const raw = localStorage.getItem(RUN_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RunRecord =>
        r &&
        typeof r === 'object' &&
        typeof (r as RunRecord).traceId === 'string' &&
        typeof (r as RunRecord).timestamp === 'number' &&
        ((r as RunRecord).status === 'ok' || (r as RunRecord).status === 'error') &&
        typeof (r as RunRecord).stepsCount === 'number' &&
        typeof (r as RunRecord).durationMs === 'number'
    )
  } catch {
    return []
  }
}

function saveToStorage(runs: RunRecord[]) {
  try {
    localStorage.setItem(RUN_HISTORY_STORAGE_KEY, JSON.stringify(runs))
  } catch {
    // ignore
  }
}

export function useRunHistory() {
  const runHistory = ref<RunRecord[]>(loadFromStorage())

  watch(
    runHistory,
    (val) => {
      saveToStorage(val)
    },
    { deep: true }
  )

  function addRun(record: RunRecord) {
    const next = [record, ...runHistory.value].slice(0, MAX_RUN_HISTORY)
    runHistory.value = next
  }

  function exportData(): string {
    return JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), runs: runHistory.value },
      null,
      2
    )
  }

  function importData(json: string): { ok: boolean; message: string; imported: number } {
    try {
      const data = JSON.parse(json) as { runs?: unknown[]; version?: number }
      if (!data || !Array.isArray(data.runs)) {
        return { ok: false, message: 'Invalid format: expected { "runs": [...] }', imported: 0 }
      }
      const valid: RunRecord[] = data.runs.filter(
        (r): r is RunRecord =>
          r &&
          typeof r === 'object' &&
          typeof (r as RunRecord).traceId === 'string' &&
          typeof (r as RunRecord).timestamp === 'number' &&
          ((r as RunRecord).status === 'ok' || (r as RunRecord).status === 'error') &&
          typeof (r as RunRecord).stepsCount === 'number' &&
          typeof (r as RunRecord).durationMs === 'number'
      )
      runHistory.value = [...valid, ...runHistory.value].slice(0, MAX_RUN_HISTORY)
      return { ok: true, message: `Imported ${valid.length} run(s).`, imported: valid.length }
    } catch (e) {
      return { ok: false, message: (e as Error).message || 'Invalid JSON', imported: 0 }
    }
  }

  function clearHistory() {
    runHistory.value = []
  }

  return { runHistory, addRun, exportData, importData, clearHistory }
}

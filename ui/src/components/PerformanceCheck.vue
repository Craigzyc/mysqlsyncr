<template>
  <q-card class="q-mb-lg">
    <q-card-section class="bg-primary text-white">
      <div class="row items-center justify-between">
        <div class="row items-center">
          <q-icon name="speed" class="q-mr-sm" />
          <div class="text-h6">Query Performance</div>
          <q-badge v-if="queryCount" color="negative" class="q-ml-sm">{{ queryCount }}</q-badge>
          <q-chip v-if="report" dense color="white" text-color="primary" icon="timer" class="q-ml-md">
            Duration threshold: {{ seconds(report.thresholds.slowMs) }} s
          </q-chip>
        </div>
        <q-space />
        <q-btn flat dense color="white" icon="settings" aria-label="Performance settings" @click="settingsOpen = true">
          <q-tooltip>Performance settings</q-tooltip>
        </q-btn>
        <q-btn flat dense color="white" icon="refresh" aria-label="Check performance" class="q-ml-md" :loading="loading" :disable="!enabled" @click="check">
          <q-tooltip>Check performance</q-tooltip>
        </q-btn>
      </div>
    </q-card-section>

    <q-dialog v-model="settingsOpen">
      <q-card class="query-dialog">
        <q-card-section class="bg-primary text-white row items-center">
          <div class="text-h6">Performance Settings</div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Close performance settings" />
        </q-card-section>
      <q-card-section>
        <div class="text-subtitle1 q-mb-md">Query thresholds</div>
        <div class="row q-col-gutter-md">
          <q-input v-model="schema" class="col-12 col-sm-4" label="Schema (blank = all application schemas)" outlined />
          <q-input v-model.number="slowSeconds" class="col-6 col-sm-4" type="number" min="1" max="86400" step="0.001" label="Duration threshold for all results (seconds, minimum 1)" outlined />
          <q-input v-model.number="options.minExecutions" class="col-6 col-sm-4" type="number" min="1" label="Minimum executions" outlined />
          <q-input v-model.number="options.minRowsExamined" class="col-6 col-sm-4" type="number" min="1" label="Minimum rows examined" outlined />
          <q-input v-model.number="options.scanRatio" class="col-6 col-sm-4" type="number" min="1" label="Scan ratio threshold" outlined />
          <q-input v-model.number="options.limit" class="col-6 col-sm-4" type="number" min="1" max="100" label="Results per category" outlined />
        </div>
        <div class="text-caption text-grey-7 q-mt-md">All times are in seconds. Checks read collected statistics and estimated plans; no indexes or server settings are changed.</div>
        <div class="text-caption text-grey-7">All categories respect this threshold: maximum execution time for cumulative query results, average time for interval results, elapsed time for live queries, and wait time for blocking transactions.</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <q-toggle v-model="aiEnabled" label="Enable optional AI analysis" color="primary" />
        <template v-if="aiEnabled">
        <div class="text-subtitle1 q-mb-md"><q-icon name="psychology" color="primary" class="q-mr-sm" />Local AI settings</div>
        <div class="row items-center q-col-gutter-md">
          <q-input v-model="aiModel" outlined class="col-12 col-sm-8" label="Installed Ollama model" hint="Default: llama3.2:3b" />
          <div class="col-12 col-sm-4"><q-btn outline color="primary" label="Check AI connection" :loading="aiChecking" @click="checkAi" /></div>
        </div>
        <div class="text-caption q-mt-md">On the machine running mysqlsyncr, install and start Ollama, then run: <code>ollama pull llama3.2:3b</code></div>
        <div class="text-caption text-grey-7">AI receives normalized SQL, schema names, columns, indexes, timings and available plans. It does not receive database credentials or table rows. The default AI service runs locally.</div>
        <q-banner v-if="aiConnection" dense class="q-mt-sm bg-blue-1" role="status">{{ aiConnection }}</q-banner>
        </template>
      </q-card-section>
        <q-card-actions align="right"><q-btn v-close-popup flat color="primary" label="Done" /></q-card-actions>
      </q-card>
    </q-dialog>

    <q-card-section v-if="error">
      <q-banner class="bg-red-1 text-negative" role="alert">{{ error }}</q-banner>
    </q-card-section>
    <q-card-section v-if="!report && !error">
      <div class="row items-center text-grey-7">
        <q-icon name="info_outline" color="primary" size="sm" class="q-mr-sm" />
        <span>Check performance to find slow queries and index review candidates.</span>
        <q-btn flat dense color="primary" label="Check performance" :loading="loading" :disable="!enabled" class="q-ml-sm" @click="check" />
      </div>
    </q-card-section>
    <q-card-section v-if="report">
      <div class="text-caption text-grey-7 q-mb-sm">{{ report.database || 'All application schemas' }} | Checked {{ report.checkedAt }} | Times in seconds</div>
      <q-banner v-if="report.interval" dense rounded class="bg-blue-1 q-mb-md">
        {{ report.interval.message }}
        <div v-if="report.interval.available" class="text-caption">{{ report.interval.from }} to {{ report.interval.to }} ({{ formatNumber(report.interval.seconds) }} s)</div>
      </q-banner>
      <div v-if="report.notifications?.length" class="q-mb-md" role="status">
        <div class="text-subtitle1 q-mb-xs">Health summary</div>
        <q-banner v-for="note in report.notifications" :key="note.area" dense rounded :class="['q-mb-xs', noteStyle(note.status).bg]">
          <template #avatar><q-icon :name="noteStyle(note.status).icon" :color="noteStyle(note.status).color" /></template>
          <span class="text-weight-medium">{{ note.area }}:</span> {{ note.message }}
        </q-banner>
      </div>
      <q-banner v-if="report.available && !report.diagnostics" dense class="bg-orange-1 q-mb-md">Restart mysqlsyncr to load the new live, lock, and interval diagnostics.</q-banner>
      <div v-for="(diagnostic, key) in report.diagnostics || {}" :key="key">
        <q-banner v-if="!diagnostic.available" dense class="bg-orange-1 q-mb-sm">{{ key === 'lockWaits' ? 'Blocking transaction' : 'Live query' }} inspection is unavailable. See Collection notes.</q-banner>
      </div>
      <template v-if="report.available">
        <q-tree v-if="performanceTree.length" v-model:expanded="expandedNodes" :nodes="performanceTree" node-key="id" class="database-tree performance-tree">
          <template #default-header="prop">
            <div class="row items-center no-wrap full-width">
              <q-icon :name="prop.node.icon" :color="prop.node.iconColor" size="sm" class="q-mr-sm" />
              <div class="col performance-node">
                <button v-if="prop.node.row" type="button" class="query-trigger" @click.stop="openQuery(prop.node.row)" @keydown.stop>
                  <span class="query-label">{{ prop.node.label }}</span>
                  <span class="text-caption text-grey-7"><template v-if="!prop.node.row.interval">Maximum {{ timeWithUnit(prop.node.row.max_ms) }} | </template>{{ prop.node.row.interval ? 'Interval average' : 'Average' }} {{ timeWithUnit(prop.node.row.avg_ms) }} | Total {{ timeWithUnit(prop.node.row.total_ms) }} | {{ prop.node.row.execution_count }} executions</span>
                  <q-tooltip>View query details and index assessment</q-tooltip>
                </button>
                <div v-else class="row items-center">
                  <span class="text-weight-medium">{{ prop.node.label }}</span>
                  <q-badge v-if="prop.node.count" color="negative" class="q-ml-sm">{{ prop.node.count }}</q-badge>
                </div>
              </div>
              <q-btn v-if="prop.node.row" flat dense size="sm" color="primary" icon="info_outline" class="q-ml-md" aria-label="View query diagnostics" @click.stop="openQuery(prop.node.row)">
                <q-tooltip>View query diagnostics</q-tooltip>
              </q-btn>
            </div>
          </template>
        </q-tree>
        <div v-else class="row items-center text-grey-7 q-py-sm">
          <q-icon name="check_circle_outline" color="positive" size="sm" class="q-mr-sm" />
          No collected application queries matched these thresholds.
        </div>
      </template>
      <q-expansion-item v-if="report.duplicateIndexes?.length" dense icon="content_copy" :label="`Duplicate and redundant indexes (${report.duplicateIndexes.length})`" class="q-mt-md">
        <q-markup-table dense flat bordered class="q-mt-sm">
          <thead><tr><th class="text-left">Table</th><th class="text-left">Index</th><th class="text-left">Issue</th><th class="text-left">Covered by</th><th class="text-left">Suggested fix</th></tr></thead>
          <tbody>
            <tr v-for="dup in report.duplicateIndexes" :key="`${dup.database_name}.${dup.table_name}.${dup.index_name}`">
              <td>{{ dup.database_name }}.{{ dup.table_name }}</td>
              <td>{{ dup.index_name }} ({{ dup.index_columns }})</td>
              <td><q-badge :color="dup.kind === 'duplicate' ? 'negative' : 'orange-9'">{{ dup.kind }}</q-badge></td>
              <td>{{ dup.covered_by }} ({{ dup.covered_by_columns }})</td>
              <td><code v-if="dup.suggested_sql">{{ dup.suggested_sql }}</code><span v-else class="text-grey-7">Review manually</span></td>
            </tr>
          </tbody>
        </q-markup-table>
        <div class="text-caption text-grey-7 q-mt-xs">Verify before dropping: an index may be referenced by an index hint or needed by a foreign key.</div>
      </q-expansion-item>
      <q-expansion-item v-if="report.warnings.length" dense icon="info_outline" :label="`Collection notes (${report.warnings.length})`" class="q-mt-md text-grey-8">
        <q-banner v-for="warning in report.warnings" :key="warning" dense rounded class="bg-amber-1 text-black q-mt-sm">{{ warning }}</q-banner>
      </q-expansion-item>
      <q-banner v-if="!report.available" dense class="bg-orange-1 q-mt-sm">Query statistics are unavailable. Expand Collection notes for the reason.</q-banner>
    </q-card-section>

    <q-dialog v-model="detailsOpen">
      <q-card v-if="selectedRow" class="query-dialog">
        <q-card-section class="bg-primary text-white row items-center">
          <q-icon name="description" class="q-mr-sm" />
          <div class="text-h6">Query details - {{ selectedRow.database_name }}</div>
          <q-space />
          <q-btn v-close-popup flat round dense icon="close" aria-label="Close query details" />
        </q-card-section>
        <q-card-section>
          <pre class="query-text">{{ selectedRow.query_text }}</pre>
          <q-markup-table flat dense wrap-cells>
            <tbody>
              <tr><th class="text-left">Measurement scope</th><td>{{ selectedRow.interval ? 'Since previous check; maximum cannot be calculated for this interval' : 'Cumulative since collection began or was reset' }}</td></tr>
              <tr><th class="text-left">Execution time</th><td>Average {{ timeWithUnit(selectedRow.avg_ms) }} | Maximum {{ timeWithUnit(selectedRow.max_ms) }} | Total {{ timeWithUnit(selectedRow.total_ms) }}</td></tr>
              <tr><th class="text-left">Executions</th><td>{{ countWithUnit(selectedRow.execution_count, 'executions') }}</td></tr>
              <tr><th class="text-left">Rows examined / sent</th><td>{{ countWithUnit(selectedRow.rows_examined, 'rows') }} examined / {{ countWithUnit(selectedRow.rows_sent, 'rows') }} sent</td></tr>
              <tr><th class="text-left">Scan ratio</th><td>{{ countWithUnit(selectedRow.scan_ratio, 'rows examined per row sent') }}</td></tr>
              <tr><th class="text-left">No index / no good index used</th><td>{{ countWithUnit(selectedRow.no_index_used, 'executions') }} / {{ countWithUnit(selectedRow.no_good_index_used, 'executions') }}</td></tr>
              <tr><th class="text-left">Temporary tables / on disk</th><td>{{ countWithUnit(selectedRow.tmp_tables, 'tables') }} total / {{ countWithUnit(selectedRow.disk_tmp_tables, 'tables') }} on disk</td></tr>
              <tr><th class="text-left">Rows sorted / merge passes</th><td>{{ countWithUnit(selectedRow.sort_rows, 'rows') }} / {{ countWithUnit(selectedRow.sort_merge_passes, 'passes') }}</td></tr>
              <tr><th class="text-left">Sort scans / range sorts</th><td>{{ countWithUnit(selectedRow.sort_scans, 'scans') }} / {{ countWithUnit(selectedRow.sort_ranges, 'range sorts') }}</td></tr>
              <tr><th class="text-left">Last seen</th><td>{{ selectedRow.last_seen }}</td></tr>
            </tbody>
          </q-markup-table>
          <div class="text-caption text-grey-7 q-mt-sm">Temporary tables and sorts can be appropriate. Disk temporary-table and merge-pass counters identify work to investigate; they do not prove a missing index. Disk temporary-table counters do not include every TempTable overflow mechanism.</div>
          <q-banner v-if="selectedRow.indexAssessment" rounded class="q-mt-md" :class="assessmentClass(selectedRow.indexAssessment.status)">
            <strong>{{ assessmentLabel(selectedRow.indexAssessment.status) }}</strong>
            <div>{{ selectedRow.indexAssessment.summary }}</div>
            <div v-for="note in selectedRow.indexAssessment.notes || []" :key="note" class="q-mt-sm">{{ note }}</div>
          </q-banner>
          <q-expansion-item v-if="selectedRow.indexAssessment?.tables.length" default-opened label="Execution plan and existing indexes" icon="account_tree" class="q-mt-md">
            <div v-for="table in selectedRow.indexAssessment.tables" :key="`${table.schema}.${table.alias}`" class="q-pa-sm">
              <div class="text-weight-medium">{{ table.schema }}.{{ table.name }} ({{ table.alias }}) - {{ assessmentLabel(table.status) }}</div>
              <div>{{ table.reason }}</div>
              <div>Access: {{ table.accessType }} | Chosen index: {{ table.chosenIndex || 'none' }} | Estimate: {{ countWithUnit(table.estimatedRows, 'rows') }}</div>
              <div>Possible indexes: {{ table.possibleIndexes.join(', ') || 'none' }} | Plan notes: {{ table.extra || 'none' }}</div>
              <div v-if="!table.existingIndexes.length">No visible indexes were found.</div>
              <div v-for="index in table.existingIndexes" :key="index.name">
                {{ index.name }}{{ index.unique ? ' (unique)' : '' }}: {{ index.columns.map(column => column.name ? column.name + (column.prefixLength ? '(' + column.prefixLength + ')' : '') : '[expression]').join(', ') }}
              </div>
            </div>
          </q-expansion-item>
          <div class="text-caption text-grey-7 q-mt-md">Assessments use an estimated plan for a captured SELECT sample. Unsupported queries require manual review. No indexes are created.</div>
          <template v-if="aiEnabled">
          <q-separator class="q-my-md" />
          <div class="row items-center q-gutter-sm">
            <div class="text-subtitle1">AI analysis</div>
            <q-btn outline color="primary" icon="psychology" label="Analyze with AI" :loading="aiLoading" @click="analyzeQuery" />
          </div>
          <div class="text-caption text-grey-7 q-mt-sm">{{ aiModel }} · Suggestions require review and are never applied automatically.</div>
          <q-banner v-if="aiError" class="bg-red-1 text-negative q-mt-md" role="alert">{{ aiError }}</q-banner>
          <template v-if="currentAnalysis">
            <div class="text-caption text-grey-7 q-mt-md">{{ currentAnalysis.model }} · {{ currentAnalysis.analyzedAt }}</div>
            <p class="q-mt-sm ai-text">{{ currentAnalysis.analysis.summary }}</p>
            <q-tree :nodes="aiTree" node-key="id" class="database-tree q-mt-md">
              <template #default-header="prop">
                <div class="row items-center no-wrap full-width">
                  <q-icon v-if="prop.node.icon" :name="prop.node.icon" :color="prop.node.iconColor" size="sm" class="q-mr-sm" />
                  <span class="ai-text" :class="prop.node.children ? 'text-weight-medium' : ''">{{ prop.node.label }}</span>
                  <q-badge v-if="prop.node.count" color="negative" class="q-ml-sm">{{ prop.node.count }}</q-badge>
                </div>
              </template>
            </q-tree>
          </template>
          </template>
        </q-card-section>
        <q-card-actions align="right"><q-btn v-close-popup flat color="primary" label="Close" /></q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { api } from '../boot/axios'

const props = defineProps({ config: { type: Object, required: true }, enabled: Boolean })
const $q = useQuasar()
const schema = ref(props.config.database || '')
const slowSeconds = ref(2)
const options = ref({ minExecutions: 6, minRowsExamined: 1000, scanRatio: 1000, limit: 10 })
const loading = ref(false)
const error = ref('')
const report = ref(null)
const settingsOpen = ref(false)
const expandedNodes = ref([])
const detailsOpen = ref(false)
const selectedRow = ref(null)
const aiModel = ref('llama3.2:3b')
const aiEnabled = ref(false)
const baselineId = ref(null)
const aiChecking = ref(false)
const aiConnection = ref('')
const aiLoading = ref(false)
const aiError = ref('')
const aiResults = ref({})
const aiErrorMessage = err => err.response?.status === 404
  ? 'The running backend does not have the AI endpoint. Restart mysqlsyncr, then refresh this page.'
  : err.response?.data?.message || err.message
const aiSections = [
  { key: 'bottlenecks', label: 'Possible bottlenecks' },
  { key: 'indexSuggestions', label: 'Index suggestions for review' },
  { key: 'querySuggestions', label: 'Query suggestions' },
  { key: 'verification', label: 'How to verify' },
  { key: 'limitations', label: 'Limitations' },
]
const currentAnalysis = computed(() => selectedRow.value ? aiResults.value[queryKey(selectedRow.value)] : null)
const aiTree = computed(() => !currentAnalysis.value ? [] : aiSections
  .filter(section => currentAnalysis.value.analysis[section.key].length)
  .map(section => ({
    id: section.key, label: section.label, icon: 'folder', iconColor: 'primary',
    count: currentAnalysis.value.analysis[section.key].length,
    children: currentAnalysis.value.analysis[section.key].map((label, index) => ({
      id: `${section.key}-${index}`, label, icon: 'description', iconColor: 'grey-7',
    })),
  })))
const sections = [
  { key: 'slowQueries', label: 'Slow queries', icon: 'schedule', color: 'negative' },
  { key: 'indexCandidates', label: 'Index review candidates', icon: 'manage_search', color: 'orange-9' },
  { key: 'highestTotalTime', label: 'Highest total query time', icon: 'timer', color: 'primary' },
  { key: 'tempAndSortQueries', label: 'Temporary tables and sorting', icon: 'sort', color: 'orange-9' },
  { key: 'recentQueries', label: 'Activity since previous check', icon: 'history', color: 'primary' },
]
const noteStyle = status => ({
  critical: { icon: 'error', color: 'negative', bg: 'bg-red-1' },
  warning: { icon: 'warning', color: 'orange-9', bg: 'bg-orange-1' },
  info: { icon: 'info', color: 'primary', bg: 'bg-blue-1' },
  ok: { icon: 'check_circle', color: 'positive', bg: 'bg-green-1' },
}[status] || { icon: 'help_outline', color: 'grey-7', bg: 'bg-grey-2' })
const queryKey = row => JSON.stringify([row.database_name, row.digest])
const sectionRows = key => key === 'recentQueries' ? report.value?.interval?.rows || [] : report.value?.[key] || []
const queryCount = computed(() => new Set(sections.flatMap(section => sectionRows(section.key)).map(queryKey)).size)
const formatNumber = value => value == null ? 'unavailable' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })
const seconds = milliseconds => milliseconds == null ? 'unavailable' : (Number(milliseconds) / 1000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })
const timeWithUnit = milliseconds => milliseconds == null ? 'unavailable' : `${seconds(milliseconds)} s`
const countWithUnit = (value, unit) => value == null ? 'unavailable' : `${formatNumber(value)} ${unit}`
const assessmentLabel = status => ({
  index_may_help: 'Index may help',
  review_existing_indexes: 'Review existing indexes',
  index_used: 'Index already used',
  scan_without_filter: 'Scan without filtering',
  no_index_issue_evident: 'No index issue evident in this plan',
  inconclusive: 'Index assessment inconclusive',
}[status] || status)
const assessmentClass = status => ['index_may_help', 'review_existing_indexes'].includes(status) ? 'bg-orange-1' : 'bg-blue-1'
const performanceTree = computed(() => {
  if (!report.value) return []
  const locks = report.value.diagnostics?.lockWaits?.rows || []
  const live = report.value.diagnostics?.liveQueries?.rows || []
  const databases = new Set([...sections.flatMap(section => sectionRows(section.key)), ...locks, ...live].map(row => row.database_name))
  return [...databases].sort().map(database => {
    const id = JSON.stringify(['database', database])
    const children = sections.map(section => {
      const rows = sectionRows(section.key).filter(row => row.database_name === database)
      return {
        id: JSON.stringify([database, section.key]), label: section.label, icon: section.icon,
        iconColor: section.color, count: rows.length, badgeColor: section.color,
        children: rows.map(row => ({
          id: JSON.stringify([database, section.key, row.digest]), label: row.query_text,
          icon: 'description', iconColor: section.color, row,
        })),
      }
    })
    const count = new Set(children.flatMap(child => child.children.map(node => queryKey(node.row)))).size
    children.push(...[
      { key: 'locks', label: 'Blocking transactions (now)', icon: 'lock_clock', color: 'negative', rows: locks,
        describe: row => `Connection ${row.waiting_pid} waits ${countWithUnit(row.wait_seconds, 's')} for connection ${row.blocking_pid} | ${row.table_name} | Index: ${row.locked_index || 'none'} | Waiting / blocking rows locked: ${countWithUnit(row.waiting_trx_rows_locked, 'rows')} / ${countWithUnit(row.blocking_trx_rows_locked, 'rows')}` },
      { key: 'live', label: 'Live queries (now)', icon: 'play_circle_outline', color: 'primary', rows: live,
        describe: row => `Connection ${row.connection_id} | ${row.elapsed_seconds == null ? 'Timing unavailable' : formatNumber(row.elapsed_seconds) + ' s'} | ${row.state || 'State unavailable'} | ${row.query_text || 'Normalized query unavailable'}` },
    ].map(section => {
      const rows = section.rows.filter(row => row.database_name === database)
      return { id: `${id}-${section.key}`, label: section.label, icon: section.icon, iconColor: section.color, count: rows.length,
        children: rows.map((row, index) => ({ id: `${id}-${section.key}-${index}`, label: section.describe(row), icon: section.icon, iconColor: section.color })) }
    }))
    return { id, label: database, icon: 'storage', iconColor: 'primary', count, children }
  })
})
watch(() => props.config.database, value => { schema.value = value || '' })
function openQuery(row) {
  selectedRow.value = row
  aiError.value = ''
  detailsOpen.value = true
}
async function checkAi() {
  aiChecking.value = true
  aiConnection.value = ''
  try {
    const { data } = await api.post('/api/performance/ai/status', { model: aiModel.value }, { timeout: 125000 })
    aiConnection.value = data.installed ? `Connected. ${data.model} is installed.` : `Connected, but ${data.model} is missing. Run: ollama pull ${data.model}`
  } catch (err) {
    aiConnection.value = aiErrorMessage(err)
  } finally { aiChecking.value = false }
}
async function analyzeQuery() {
  const row = selectedRow.value
  const key = queryKey(row)
  aiLoading.value = true
  aiError.value = ''
  delete aiResults.value[key]
  try {
    const { data } = await api.post('/api/performance/ai', {
      config: props.config, database: row.database_name, digest: row.digest, model: aiModel.value,
    }, { timeout: 150000 })
    aiResults.value[key] = data
  } catch (err) {
    if (selectedRow.value && queryKey(selectedRow.value) === key) aiError.value = aiErrorMessage(err)
  } finally { aiLoading.value = false }
}
async function check() {
  loading.value = true
  error.value = ''
  detailsOpen.value = false
  selectedRow.value = null
  try {
    if (typeof slowSeconds.value !== 'number' || !Number.isFinite(slowSeconds.value) || slowSeconds.value < 1 || slowSeconds.value > 86400) {
      throw new Error('Duration threshold must be a number of seconds between 1 and 86400.')
    }
    const response = await api.post('/api/performance', {
      config: props.config,
      options: { ...options.value, slowMs: slowSeconds.value * 1000, database: schema.value.trim(), baselineId: baselineId.value },
    })
    report.value = response.data
    baselineId.value = response.data.snapshotId || null
    aiResults.value = {}
    expandedNodes.value = []
    const issues = (response.data.notifications || []).filter(note => ['critical', 'warning'].includes(note.status))
    const critical = issues.some(note => note.status === 'critical')
    $q.notify(issues.length
      ? { type: critical ? 'negative' : 'warning', message: `${issues.length} performance issue(s) found`, caption: issues.map(note => note.area).join(', '), position: 'top-right', timeout: 8000 }
      : { type: 'positive', message: 'No performance issues found', position: 'top-right' })
  } catch (err) {
    report.value = null
    error.value = err.response?.data?.message || err.message
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.performance-node { min-width: 0; }
.query-trigger { display: flex; flex-direction: column; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.query-trigger:focus-visible { outline: 2px solid var(--q-primary); outline-offset: 3px; border-radius: 3px; }
.query-label { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.query-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; background: #f5f5f5; border-radius: 4px; padding: 12px; }
.query-dialog { width: 90vw; max-width: 1000px; }
.ai-text { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>

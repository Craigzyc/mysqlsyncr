import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { reactive, ref, computed, watch } from 'vue'
import * as helpers from '../src/workspaceState.js'

const storage = () => {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
}
const componentScript = name => fs.readFileSync(new URL('../src/' + name, import.meta.url), 'utf8')
  .match(/<script(?: setup)?>([\s\S]*?)<\/script>/)[1].replace(/^import .+$/gm, '')

// Exercise the actual Vue options and setup functions with controlled API responses.
// Rendering and template compilation are covered by the production build/browser checks.
function workspace() {
  const local = storage(), session = storage(), notices = [], calls = []
  const component = new Function('FolderBrowser', 'DefinitionDiff', 'PerformanceCheck', 'localStorage', 'sessionStorage', ...Object.keys(helpers), componentScript('pages/MainComponent.vue').replace('export default', 'return'))({}, {}, {}, local, session, ...Object.values(helpers))
  const vm = component.data()
  const progress = { hidden: false, update() {}, hide() { this.hidden = true }, onOk(fn) { queueMicrotask(fn); return this }, onCancel() { return this }, onDismiss() { return this } }
  Object.assign(vm, {
    $q: { notify: notice => notices.push(notice), dialog: () => progress, loading: { show() {}, hide() {} } },
    $api: { post: async (url, body) => { calls.push({ url, body }); return { data: {} } } },
    $refs: {}, $nextTick: async () => {},
  })
  for (const [name, method] of Object.entries(component.methods)) vm[name] = method.bind(vm)
  for (const [name, getter] of Object.entries(component.computed)) Object.defineProperty(vm, name, { get: () => getter.call(vm) })
  return { vm, component, local, session, notices, calls, progress }
}

test('connection settings cancel cannot retarget existing differences or save a folder', () => {
  const { vm, local } = workspace()
  vm.host = 'original'; vm.dbFolder = '/original'; vm.isDbSetup = true; vm.comparisonState = 'ready'
  vm.openSettings()
  vm.settingsDraft.host = 'different-server'
  vm.onFolderSelected('/different-template')
  vm.closeSettings()
  assert.equal(vm.connectionConfig.host, 'original')
  assert.equal(vm.connectionConfig.output, '/original')
  assert.equal(local.getItem('dbConfig'), null)
})

test('saving valid settings normalizes scope, clears stale results and never persists a password', async () => {
  const { vm, local } = workspace()
  vm.settingsDraft = { host: ' 127.0.0.1 ', port: '3357', user: 'root', password: 'secret', database: ' Alerts ', output: ' /template ' }
  vm.differences = { Wrong: [{ type: 'extra_table' }] }
  vm.refreshWorkspace = async () => {}
  await vm.saveSettings()
  assert.equal(vm.connectionConfig.database, 'Alerts')
  assert.equal(vm.port, 3357)
  assert.deepEqual(vm.differences, {})
  assert.equal(JSON.parse(local.getItem('dbConfig')).password, undefined)
  assert.equal(vm.password, 'secret')
})

test('invalid settings do not change the active connection', async () => {
  const { vm } = workspace()
  vm.openSettings(); vm.settingsDraft.port = 0; vm.settingsDraft.output = '/template'
  await vm.saveSettings()
  assert.equal(vm.port, 3306)
  assert.match(vm.settingsError, /Port/)
  assert.equal(vm.isDbSetup, false)
})

test('malformed saved data is safe and legacy passwords are purged without reconnecting', () => {
  const { vm, component, local } = workspace()
  local.setItem('dbConfig', '{broken')
  assert.doesNotThrow(() => component.mounted.call(vm))
  local.setItem('dbConfig', JSON.stringify({ host: 'old', password: 'secret' }))
  component.mounted.call(vm)
  assert.equal(vm.settingsDraft.password, '')
  assert.equal(JSON.parse(local.getItem('dbConfig')).password, undefined)
  assert.equal(vm.isDbSetup, false)
  assert.equal(vm.settingsDialog, true)
})

test('compare request includes selected database and a failed comparison blocks apply', async () => {
  const { vm, calls } = workspace()
  vm.database = 'Alerts'; vm.isDbSetup = true
  await vm.fetchAllDifferences()
  assert.equal(calls[0].body.config.database, 'Alerts')
  vm.differences = { Alerts: [{ type: 'extra_table' }] }
  vm.$api.post = async () => { throw new Error('connection refused') }
  await assert.rejects(vm.fetchAllDifferences(), /connection refused/)
  assert.equal(vm.comparisonState, 'error')
  assert.equal(vm.canApply, false)
  assert.deepEqual(vm.differences, {})
})

test('database names with hyphens remain intact through lazy tree and apply routing', async () => {
  const { vm } = workspace()
  vm.existingDatabases = { 'store-west': { tables: { inventory: { columns: [], indexes: [] } }, procedures: [] } }
  vm.differences = { 'store-west': [{ type: 'missing_field', tableName: 'inventory', field: { Field: 'quantity' } }] }
  await vm.buildDatabaseTree()
  let categories
  vm.onLazyLoad({ node: vm.databaseTree[0], done: nodes => { categories = nodes }, fail: () => assert.fail('lazy load failed') })
  assert.equal(vm.getDbNameFromNode(categories[0]), 'store-west')
  let tables
  vm.onLazyLoad({ node: categories[0], done: nodes => { tables = nodes }, fail: () => assert.fail('table load failed') })
  assert.equal(vm.getDbNameFromNode(tables[0]), 'store-west')
  assert.equal((await vm.collectIssuesForNode(categories[0])).length, 1)
})

test('bulk apply stops on failure and always closes its progress dialog', async () => {
  const { vm, progress } = workspace()
  vm.isDbSetup = true; vm.comparisonState = 'ready'
  vm.differences = { Alerts: [{ type: 'missing_field', tableName: 'AlarmRules' }] }
  let attempts = 0
  vm.$api.post = async url => { assert.equal(url, '/api/applyAll'); attempts++; throw new Error('Apply failed') }
  vm.refreshKeepingExpanded = async () => {}
  await vm.fixAllIssues()
  assert.equal(attempts, 1)
  assert.equal(progress.hidden, true)
  assert.equal(vm.isFixingAll, false)
})

test('apply is blocked while another operation is active', async () => {
  const { vm, calls } = workspace()
  vm.isDbSetup = true; vm.comparisonState = 'ready'; vm.activeOperation = 'export'
  assert.equal(await vm.fixNodeIssues({ id: 'db-Alerts', type: 'database', dbName: 'Alerts' }), false)
  assert.equal(calls.length, 0)
})

test('bulk apply stops when successful requests make no progress', async () => {
  const { vm } = workspace()
  vm.isDbSetup = true; vm.comparisonState = 'ready'
  vm.differences = { Alerts: [{ type: 'missing_field' }] }
  let attempts = 0
  vm.$api.post = async url => { assert.equal(url, '/api/applyAll'); attempts++; return { data: { warnings: [] } } }
  vm.refreshKeepingExpanded = async () => {}
  await vm.fixAllIssues()
  assert.equal(attempts, 1)
})

test('bulk apply sends all visible schemas together for dependency ordering', async () => {
  const { vm, calls } = workspace()
  vm.isDbSetup = true; vm.comparisonState = 'ready'
  const differences = { Alerts: [{ type: 'missing_table' }], IoT: [{ type: 'missing_view' }] }
  vm.differences = differences
  vm.refreshKeepingExpanded = async () => { vm.differences = { Alerts: [], IoT: [] } }
  await vm.fixAllIssues()
  assert.equal(calls[0].url, '/api/applyAll')
  assert.deepEqual(calls[0].body.differences, differences)
})

test('unavailable performance data never produces a clean bill of health', () => {
  assert.equal(helpers.performanceNotice({ available: false }).type, 'warning')
  assert.equal(helpers.performanceNotice({ available: true }).type, 'info')
  assert.equal(helpers.performanceNotice({ available: true, notifications: [{ status: 'unknown' }] }).type, 'warning')
})

test('performance results and pending requests are isolated to their connection and schema', async () => {
  const props = reactive({ config: { host: 'old', port: 3357, database: 'Alerts' }, enabled: true })
  let finish
  const api = { post: () => new Promise(resolve => { finish = resolve }) }
  const notices = []
  const setup = new Function('computed', 'ref', 'watch', 'useQuasar', 'api', 'defineProps', 'performanceNotice', componentScript('components/PerformanceCheck.vue') + '\nreturn { check, report, baselineId, schema, loading }')
  const instance = setup(computed, ref, watch, () => ({ notify: note => notices.push(note) }), api, () => props, helpers.performanceNotice)
  const pending = instance.check()
  props.config = { host: 'new', port: 3380, database: 'IoT' }
  finish({ data: { available: true, snapshotId: 'old-server', notifications: [] } })
  await pending
  assert.equal(instance.report.value, null)
  assert.equal(instance.baselineId.value, null)
  assert.equal(instance.schema.value, 'IoT')
  assert.equal(instance.loading.value, false)
  assert.equal(notices.length, 0)
})

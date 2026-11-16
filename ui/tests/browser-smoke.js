// Shared end-to-end scenario. Every API call is intercepted, so this regression
// test never connects to a database or writes a template.
export default async function browserSmoke(page, { origin = 'http://localhost:3660', artifactDir } = {}) {
  const assert = (condition, message) => { if (!condition) throw new Error(message) }
  const results = []
  const requests = []
  let failCompare = false
  let applyCount = 0
  let applyAllCount = 0
  let pendingPerformance = null
  let delayPerformance = false
  const column = { Field: 'quantity', Type: 'int', NotNull: true, Default: '0' }
  let differences = { 'store-west': [{ type: 'missing_field', tableName: 'Inventory', field: column }], Alerts: [] }
  const databases = {
    'store-west': { tables: { Inventory: { columns: [column], indexes: [], createSQL: 'CREATE TABLE `Inventory` (`quantity` int NOT NULL DEFAULT 0)' } }, procedures: [], views: {} },
    Alerts: { tables: {}, procedures: [], views: {} },
  }
  const report = { available: true, database: null, checkedAt: '2026-11-16T00:00:00Z', thresholds: { slowMs: 2000 }, notifications: [{ area: 'Slow queries', status: 'unknown', message: 'No workload coverage. Performance is not established.' }], warnings: ['No statement digests are available for this scope.'], slowQueries: [], indexCandidates: [], highestTotalTime: [], tempAndSortQueries: [], duplicateIndexes: [], snapshotId: 'test-baseline', diagnostics: { liveQueries: { available: true, rows: [] }, lockWaits: { available: true, rows: [] } } }
  const respond = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
  const handle = async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    requests.push({ path, body })
    if (path === '/api/getDatabasesFromExistingDumps') return respond(route, databases)
    if (path === '/api/compare') return respond(route, failCompare ? { message: 'Test connection unavailable' } : differences, failCompare ? 503 : 200)
    if (path === '/api/versions') return respond(route, { server: '5.7.44', template: { version: '8.0', inferred: true, reason: 'uses MySQL 8 formatting' }, notes: ['Template formatting differs from this server.'] })
    if (path === '/api/templateDrift') return respond(route, [])
    if (path === '/api/performance') {
      if (delayPerformance) { pendingPerformance = route; return }
      return respond(route, report)
    }
    if (path === '/api/apply') {
      assert(body.database === 'store-west', 'Hyphenated database was retargeted')
      assert(body.diffs.length === 1 && body.diffs[0].type === 'missing_field', 'Apply included unexpected changes')
      applyCount++
      differences = { 'store-west': [], Alerts: [] }
      return respond(route, { message: 'Applied 1 of 1.', warnings: [] })
    }
    if (path === '/api/applyAll') {
      assert(body.differences['store-west'].length === 1 && body.differences.Alerts.length === 1, 'Bulk apply lost a database dependency')
      applyAllCount++
      differences = { 'store-west': [], Alerts: [] }
      return respond(route, { message: 'Applied 2 of 2.', attempted: 2, failures: [], warnings: [] })
    }
    return respond(route, { message: 'Unexpected endpoint in browser test: ' + path }, 501)
  }
  await page.route('**/api/**', handle)
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(origin)
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.reload()
    await page.getByRole('button', { name: 'Configure connection', exact: true }).click()
    await page.getByLabel('Database Host', { exact: true }).fill('isolated-test.invalid')
    await page.getByLabel('Database Port', { exact: true }).fill('3357')
    await page.getByLabel('Database User', { exact: true }).fill('root')
    await page.getByLabel('Database password', { exact: true }).fill('browser-test-only')
    await page.getByLabel('Template folder', { exact: true }).fill('C:\\test-template')
    await page.getByRole('button', { name: 'Save and compare', exact: true }).click()
    await page.getByText('1 differences to review', { exact: true }).waitFor()
    assert(!await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('dbConfig')), 'password')), 'Password persisted')
    results.push('Comparison, configuration and password storage')

    await page.getByRole('button', { name: 'Connection settings', exact: true }).click()
    await page.getByLabel('Database Host', { exact: true }).fill('wrong-target.invalid')
    await page.getByLabel('Template folder', { exact: true }).fill('C:\\wrong-template')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Compare now', exact: true }).click()
    await page.getByText('1 differences to review', { exact: true }).waitFor()
    const compared = requests.filter(request => request.path === '/api/compare').at(-1)
    assert(compared.body.config.host === 'isolated-test.invalid' && compared.body.config.output === 'C:\\test-template', 'Cancelled settings changed the connection')
    results.push('Cancel preserves server and template')

    await page.getByText('store-west', { exact: true }).click()
    await page.getByText('Tables', { exact: true }).click()
    await page.getByText('Inventory', { exact: true }).click()
    await page.getByText('Issue Details', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Fix Issue', exact: true }).click()
    await page.getByText('Apply template changes?', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert(applyCount === 0, 'Cancelled apply changed the database')
    await page.getByRole('button', { name: 'Fix Issue', exact: true }).click()
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await page.getByText('No differences found', { exact: true }).waitFor()
    assert(applyCount === 1, 'Apply did not run exactly once')
    results.push('Tree navigation, hyphenated database, review, cancel/apply and recompare')

    differences = { 'store-west': [{ type: 'missing_field', tableName: 'Inventory', field: column }], Alerts: [{ type: 'missing_table', tableName: 'NewTable' }] }
    await page.getByRole('button', { name: 'Compare now', exact: true }).click()
    await page.getByText('2 differences to review', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Ignore differences for Alerts', exact: true }).click()
    await page.getByText('1 differences to review', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Show differences for Alerts', exact: true }).click()
    await page.getByText('2 differences to review', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Apply template changes', exact: true }).first().click()
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await page.getByText('No differences found', { exact: true }).waitFor()
    assert(applyAllCount === 1, 'Bulk apply must use one globally ordered request')
    results.push('Ignore/show differences and global apply across schemas')

    failCompare = true
    await page.getByRole('button', { name: 'Compare now', exact: true }).click()
    await page.getByText('Comparison failed', { exact: true }).waitFor()
    assert(await page.getByText('Test connection unavailable', { exact: true }).first().isVisible(), 'Comparison error is hidden')
    results.push('Comparison failure is visible and stale results are cleared')
    failCompare = false
    await page.getByRole('button', { name: 'Compare now', exact: true }).click()
    await page.getByText('No differences found', { exact: true }).waitFor()

    await page.getByRole('tab', { name: 'Performance', exact: true }).click()
    await page.getByRole('button', { name: 'Check performance', exact: true }).first().click()
    await page.getByText('Health summary', { exact: true }).waitFor()
    await page.getByText('No workload coverage. Performance is not established.', { exact: false }).waitFor()
    assert(await page.getByText('Performance check has incomplete coverage', { exact: true }).isVisible(), 'Incomplete statistics reported as healthy')
    results.push('Performance unknown coverage and diagnostics rendering')

    delayPerformance = true
    const pendingRequest = page.waitForRequest(request => request.url().includes('/api/performance'))
    await page.getByRole('button', { name: 'Check performance', exact: true }).first().click()
    await pendingRequest
    await page.getByRole('button', { name: 'Connection settings', exact: true }).click()
    await page.getByLabel('Database (optional)', { exact: true }).fill('Alerts')
    await page.getByRole('button', { name: 'Save and compare', exact: true }).click()
    await page.getByText('Check performance to find slow queries and index review candidates.', { exact: true }).waitFor()
    if (pendingPerformance) await respond(pendingPerformance, report)
    await page.getByRole('tab', { name: 'Schema sync', exact: true }).click()
    await page.getByText('No differences found', { exact: true }).waitFor()
    assert(!await page.getByText('store-west', { exact: true }).count(), 'Database filter ignored')
    assert(requests.filter(request => request.path === '/api/compare').at(-1).body.config.database === 'Alerts', 'API database scope omitted')
    await page.getByRole('tab', { name: 'Performance', exact: true }).click()
    assert(!await page.getByText('Health summary', { exact: true }).count(), 'Old performance request repopulated new connection')
    results.push('Selected database scope and stale performance response ignored')

    if (artifactDir) await page.screenshot({ path: artifactDir + '/desktop.png', fullPage: true, animations: 'disabled', style: '.q-notifications { visibility: hidden }' })

    await page.getByRole('tab', { name: 'Schema sync', exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Page overflows mobile viewport')
    await page.getByRole('button', { name: 'Connection settings', exact: true }).click()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Settings overflow mobile viewport')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.locator('.q-dialog').waitFor({ state: 'hidden' })
    if (artifactDir) await page.screenshot({ path: artifactDir + '/mobile.png', fullPage: true, animations: 'disabled', style: '.q-notifications { visibility: hidden }' })
    results.push('Mobile workspace and settings layout')
    return { passed: results.length, results }
  } finally {
    if (pendingPerformance) await pendingPerformance.abort().catch(() => {})
    await page.unroute('**/api/**', handle)
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  }
}

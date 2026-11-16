export const defaultConfig = () => ({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: '', output: '' })

export function normalizeConfig(input = {}) {
  const config = { ...defaultConfig(), ...input }
  for (const key of ['host', 'user', 'database', 'output']) config[key] = String(config[key] ?? '').trim()
  config.password = String(config.password ?? '')
  config.port = Number(config.port)
  if (!config.host || !config.user) throw new Error('Enter a database host and user.')
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Port must be a whole number between 1 and 65535.')
  if (!config.output) throw new Error('Select the template folder to compare or export.')
  return config
}

// Remember connection details, but keep the password in memory for this session only.
export function saveConnection(storage, config) {
  const remembered = { ...config }
  delete remembered.password
  storage.setItem('dbConfig', JSON.stringify(remembered))
}

export function loadConnection(storage) {
  try {
    const saved = JSON.parse(storage.getItem('dbConfig'))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null
    const config = { ...defaultConfig(), ...saved, password: '' }
    saveConnection(storage, config) // Remove passwords saved by earlier versions.
    return config
  } catch {
    return null
  }
}

export function databaseForNode(node, databases = []) {
  if (node?.dbName) return node.dbName
  if (!node?.id) return null
  // Longest match supports names such as "store-west" without splitting on hyphens.
  return [...databases].sort((a, b) => b.length - a.length)
    .find(name => node.id === `db-${name}` || node.id.startsWith(`${name}-`)) || null
}

export function performanceNotice(report) {
  const issues = (report.notifications || []).filter(note => ['critical', 'warning'].includes(note.status))
  if (issues.length) return {
    type: issues.some(note => note.status === 'critical') ? 'negative' : 'warning',
    message: `${issues.length} performance finding(s) to review`,
    caption: issues.map(note => note.area).join(', '),
  }
  if (!report.available) return { type: 'warning', message: 'Query statistics unavailable', caption: 'Review the collection notes; performance has not been verified.' }
  if ((report.notifications || []).some(note => note.status === 'unknown')) return { type: 'warning', message: 'Performance check has incomplete coverage', caption: 'Review unavailable checks and collection notes.' }
  return { type: 'info', message: 'Performance check complete', caption: 'No findings at the selected thresholds. Review collection notes and workload coverage.' }
}

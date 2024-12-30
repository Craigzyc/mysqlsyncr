<template>
    <q-page class="q-pa-md">
        <!-- Top Action Bar -->
        <div class="row q-col-gutter-md q-mb-lg">
            <div class="col-auto">
                <q-btn @click="openSettings" icon="settings" label="Settings" color="primary" />
            </div>
            <div class="col-auto">
                <q-btn
                    @click="
                        Object.keys(existingDatabases).length === 0
                            ? createNewDump()
                            : createNewDump(true)
                    "
                    :icon="Object.keys(existingDatabases).length === 0 ? 'download' : 'refresh'"
                    :label="
                        Object.keys(existingDatabases).length === 0 ? 'Get New Dump' : 'Refresh Dump'
                    "
                    color="secondary"
                />
            </div>
        </div>

        <!-- Database Not Set Up Warning -->
        <q-card v-if="!isDbSetup" class="q-mb-lg bg-warning text-white">
            <q-card-section>
                <div class="text-h6">
                    <q-icon name="warning" class="q-mr-sm" />
                    Database Not Set Up
                </div>
                <div class="q-mt-sm">Please configure your database settings to get started.</div>
                <q-btn
                    @click="openSettings"
                    label="Open Settings"
                    color="white"
                    text-color="warning"
                    class="q-mt-sm"
                    unelevated
                />
            </q-card-section>
        </q-card>

        <!-- Database Structure Card -->
        <q-card v-if="Object.keys(existingDatabases).length > 0" class="q-mb-lg">
            <q-card-section class="bg-primary text-white">
                <div class="text-h6">
                    <q-icon name="account_tree" class="q-mr-sm" />
                    Database Structure
                </div>
            </q-card-section>

            <q-card-section>
                <q-tree
                    :nodes="databaseTree"
                    node-key="id"
                    v-model:expanded="expandedNodes"
                    @lazy-load="onLazyLoad"
                    class="database-tree"
                >
                    <template v-slot:default-header="prop">
                        <div class="row items-center full-width">
                            <div
                                class="row items-center flex-grow-1 cursor-pointer"
                                @click.stop="
                                    !['category', 'database', 'subcategory'].includes(
                                        prop.node.type,
                                    ) &&
                                    prop.node.diffCount &&
                                    showIssueDetails(prop.node.issueData, prop.node)
                                "
                            >
                                <q-icon
                                    v-if="prop.node.icon"
                                    :name="prop.node.icon"
                                    :color="prop.node.iconColor"
                                    size="sm"
                                    class="q-mr-sm"
                                />
                                <div class="text-weight-medium">{{ prop.node.label }}</div>
                                <q-badge
                                    v-if="prop.node.diffCount"
                                    color="negative"
                                    class="q-ml-sm"
                                >
                                    {{ prop.node.diffCount }}
                                </q-badge>
                            </div>

                            <q-btn
                                v-if="
                                    ['issue-group', 'issues', 'category', 'database'].includes(
                                        prop.node.type,
                                    ) && prop.node.diffCount
                                "
                                flat
                                dense
                                color="primary"
                                :loading="isNodeFixing[prop.node.id]"
                                @click.stop="fixNodeIssues(prop.node)"
                                icon="build"
                                size="sm"
                                class="q-ml-md"
                            >
                                <q-tooltip>Fix All Issues</q-tooltip>
                            </q-btn>
                        </div>
                    </template>
                </q-tree>
            </q-card-section>
        </q-card>

        <q-dialog v-model="settingsDialog" persistent>
            <q-card style="width: 90vw; max-width: 1200px">
                <q-card-section class="bg-primary text-white">
                    <div class="text-h5">Database Settings</div>
                    <div class="text-subtitle2">Configure your database connection parameters</div>
                </q-card-section>

                <q-card-section class="q-pa-lg col scroll">
                    <div class="row q-col-gutter-lg justify-center">
                        <div class="col-12 col-sm-10">
                            <div class="row q-col-gutter-md">
                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="host"
                                        label="Database Host"
                                        default="127.0.0.1"
                                        filled
                                        class="q-mb-md"
                                        required
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="dns" />
                                        </template>
                                    </q-input>
                                </div>

                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="port"
                                        label="Database Port"
                                        default="3306"
                                        type="number"
                                        filled
                                        class="q-mb-md"
                                        required
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="settings_ethernet" />
                                        </template>
                                    </q-input>
                                </div>

                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="user"
                                        label="Database User"
                                        default="root"
                                        filled
                                        class="q-mb-md"
                                        required
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="person" />
                                        </template>
                                    </q-input>
                                </div>

                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="password"
                                        label="Database Password"
                                        type="password"
                                        filled
                                        class="q-mb-md"
                                        required
                                        autocomplete="off"
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="lock" />
                                        </template>
                                    </q-input>
                                </div>

                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="database"
                                        label="Database Name"
                                        filled
                                        class="q-mb-md"
                                        required
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="database" />
                                        </template>
                                    </q-input>
                                </div>

                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="dbFolder"
                                        label="Database Folder"
                                        default="db-dump"
                                        filled
                                        class="q-mb-md"
                                        required
                                    >
                                        <template v-slot:prepend>
                                            <q-icon name="folder" />
                                        </template>
                                        <template v-slot:append>
                                            <q-btn
                                                flat
                                                dense
                                                icon="folder_open"
                                                @click="showFolderBrowser = true"
                                            >
                                                <q-tooltip>Browse</q-tooltip>
                                            </q-btn>
                                        </template>
                                    </q-input>
                                </div>
                            </div>
                        </div>
                    </div>
                </q-card-section>

                <q-card-actions align="right" class="bg-white q-pa-md">
                    <q-btn
                        @click="closeSettings"
                        label="Cancel"
                        color="grey-7"
                        flat
                        class="q-px-md"
                    />
                    <q-btn
                        @click="saveSettings"
                        label="Save Settings"
                        color="primary"
                        unelevated
                        class="q-px-md q-ml-sm"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Issue Details Dialog -->
        <q-dialog v-model="issueDialog">
            <q-card style="min-width: 800px; width: 90vw; max-width: 1200px">
                <q-card-section>
                    <div class="text-h6">Issue Details</div>
                </q-card-section>

                <!-- Single Issue View -->
                <template v-if="selectedIssues.length === 1">
                    <q-card-section class="q-pt-none">
                        <div class="text-subtitle2 q-mb-sm">
                            Issue Type:
                            <q-badge color="negative">{{
                                selectedIssues[0].type?.replace(/_/g, ' ')
                            }}</q-badge>
                        </div>
                        <div class="text-subtitle2 q-mb-sm">Name: {{ selectedIssues[0].Name }}</div>

                        <div v-if="selectedIssues[0].tableName" class="q-mb-sm">
                            <strong>Table:</strong> {{ selectedIssues[0].tableName }}
                        </div>

                        <div v-if="selectedIssues[0].createSQL" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">SQL Definition:</div>
                            <q-card class="bg-grey-2">
                                <q-card-section class="q-pa-md">
                                    <pre class="sql-code">{{ selectedIssues[0].createSQL }}</pre>
                                </q-card-section>
                            </q-card>
                        </div>

                        <div v-if="selectedIssues[0].Definition" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">Definition:</div>
                            <q-card class="bg-grey-2">
                                <q-card-section class="q-pa-md">
                                    <pre class="sql-code">{{ selectedIssues[0].Definition }}</pre>
                                </q-card-section>
                            </q-card>
                        </div>

                        <div v-if="selectedIssues[0].currentField" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">Field Comparison:</div>
                            <q-markup-table flat bordered>
                                <thead>
                                    <tr>
                                        <th class="text-left">Property</th>
                                        <th class="text-left">Current</th>
                                        <th class="text-left">Expected</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(value, key) in selectedIssues[0].currentField" :key="key">
                                        <td>{{ key }}</td>
                                        <td>{{ value }}</td>
                                        <td :class="{ 'text-negative': value !== selectedIssues[0].field?.[key] }">
                                            {{ selectedIssues[0].field?.[key] }}
                                        </td>
                                    </tr>
                                </tbody>
                            </q-markup-table>
                        </div>

                        <q-btn
                            @click="fixNodeIssues(this.selectedNode)"
                            :loading="isNodeFixing['single-issue']"
                            color="primary"
                            class="q-mt-md"
                            label="Fix Issue"
                        />
                    </q-card-section>
                </template>

                <!-- Multiple Issues View -->
                <template v-else>
                    <q-card-section class="q-pt-none">
                        <q-table
                            :rows="selectedIssues"
                            :columns="[
                                {
                                    name: 'type',
                                    label: 'Type',
                                    field: (row) => row.type?.replace(/_/g, ' '),
                                },
                                { name: 'tableName', label: 'Table', field: 'tableName' },
                                { name: 'actions', label: 'Actions', field: 'actions' },
                            ]"
                            row-key="id"
                            dense
                        >
                            <template v-slot:body="props">
                                <q-tr :props="props">
                                    <q-td key="type">{{ props.row.type?.replace(/_/g, ' ') }}</q-td>
                                    <q-td key="tableName">{{ props.row.tableName }}</q-td>
                                    <q-td key="actions">
                                        <q-btn
                                            flat
                                            dense
                                            color="primary"
                                            icon="visibility"
                                            @click="showSingleIssue(props.row)"
                                        >
                                            <q-tooltip>View Details</q-tooltip>
                                        </q-btn>
                                        <q-btn
                                            flat
                                            dense
                                            color="positive"
                                            icon="build"
                                            :loading="isNodeFixing[`issue-${props.rowIndex}`]"
                                            @click="
                                                fixNodeIssues({
                                                    type: 'issue',
                                                    id: this.selectedNode.id,
                                                    issueData: props.row,
                                                })
                                            "
                                        >
                                            <q-tooltip>Fix Issue</q-tooltip>
                                        </q-btn>
                                    </q-td>
                                </q-tr>
                            </template>
                        </q-table>

                        <q-btn
                            @click="fixNodeIssues({ type: 'issues', children: selectedIssues })"
                            :loading="isNodeFixing['all-issues']"
                            color="primary"
                            class="q-mt-md"
                            label="Fix All Issues"
                        />
                    </q-card-section>
                </template>

                <q-card-actions align="right">
                    <q-btn flat label="Close" color="primary" v-close-popup />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <FolderBrowser v-if="showFolderBrowser"
            v-model="showFolderBrowser"
            :initial-path="dbFolder"
            @folder-selected="onFolderSelected"
        />
    </q-page>
</template>

<script>
import axios from 'axios'
import FolderBrowser from '../components/FolderBrowser.vue'


export default {
    components: {
        FolderBrowser
    },
    data() {
        return {
            isDbSetup: false,
            differences: {},
            columns: [
                { name: 'table', label: 'Table', align: 'left', field: 'table' },
                { name: 'difference', label: 'Difference', align: 'left', field: 'difference' },
            ],
            settingsDialog: false,
            host: '127.0.0.1',
            port: 3306,
            user: 'root',
            password: '',
            database: '',
            dbFolder: 'db-dump',
            existingDatabases: [],
            databaseColumns: [
                { name: 'name', label: 'Database Name', align: 'left', field: 'name' },
                { name: 'size', label: 'Size', align: 'left', field: 'size' },
            ],
            databaseTree: [],
            expandedNodes: [],
            issueDialog: false,
            selectedIssues: [],
            selectedNode: null,
            isNodeFixing: {}, // Tracks loading state for each node
            showFolderBrowser: false,
        }
    },
    methods: {
        openSettings() {
            this.settingsDialog = true
        },
        closeSettings() {
            this.settingsDialog = false
        },
        saveSettings() {
            const dbConfig = {
                host: this.host,
                port: this.port,
                user: this.user,
                password: this.password,
                database: this.database,
                output: this.dbFolder,
            }
            localStorage.setItem('dbConfig', JSON.stringify(dbConfig))
            this.isDbSetup = true
            this.closeSettings()
            this.getDatabasesFromExistingDumps()
            this.fetchAllDifferences()
        },
        async refreshDifferences() {
            if (!this.isDbSetup) return
            try {
                const response = await axios.post('http://localhost:3000/api/compare', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                        database: this.database,
                    },
                })
                this.differences = response.data
            } catch (error) {
                console.error('Error fetching differences:', error)
            }
        },
        async getDatabasesFromExistingDumps() {
            try {
                const response = await axios.post(
                    `http://localhost:3000/api/getDatabasesFromExistingDumps`,
                    {
                        config: {
                            host: this.host,
                            port: this.port,
                            user: this.user,
                            password: this.password,
                            output: this.dbFolder,
                        },
                    },
                )
                if (response.data && typeof response.data === 'object') {
                    this.existingDatabases = response.data
                    this.buildDatabaseTree()
                }
            } catch (error) {
                console.error('Error fetching databases from existing dumps:', error)
            }
        },
        async buildDatabaseTree() {
            if (Object.keys(this.differences).length === 0) {
                await this.fetchAllDifferences()
            }
            this.databaseTree = Object.entries(this.existingDatabases).map(([dbName, db]) => {
                console.log('Building database tree for:', dbName, this.differences)
                const dbDiffs = this.differences[dbName] || []
                const totalIssues = dbDiffs.length
                console.log(`Database ${dbName} differences ${totalIssues}:`, dbDiffs)
                return {
                    id: `db-${dbName}`,
                    label: dbName,
                    type: 'database',
                    lazy: true,
                    icon: totalIssues > 0 ? 'warning' : 'check_circle',
                    iconColor: totalIssues > 0 ? 'negative' : 'positive',
                    diffCount: totalIssues || null,
                    dbData: db,
                    dbName: dbName,
                }
            })

            console.log('Database tree:', this.databaseTree)
            this.expandedNodes = []
        },
        onLazyLoad({ node, done, fail }) {
            console.log('Lazy loading node:', node)
            try {
                if (node.type === 'database') {
                    console.log('Loading database children for:', node.dbName)
                    const db = node.dbData
                    const dbDiffs = this.differences[node.dbName] || []

                    // Count issues by main category
                    const tableIssues = dbDiffs.filter(
                        (d) =>
                            d.type.includes('table') ||
                            d.type.includes('field') ||
                            d.type.includes('index') ||
                            d.type.includes('trigger'),
                    )
                    console.log('Table issues:', tableIssues)

                    const procedureIssues = dbDiffs.filter((d) => d.type.includes('procedure'))
                    const viewIssues = dbDiffs.filter((d) => d.type.includes('view'))

                    const children = [
                        {
                            id: `${node.dbName}-tables`,
                            label: 'Tables',
                            type: 'category',
                            lazy: true,
                            icon: tableIssues.length > 0 ? 'warning' : 'check_circle',
                            iconColor: tableIssues.length > 0 ? 'negative' : 'positive',
                            diffCount: tableIssues.length || null,
                        },
                        db.procedures && {
                            id: `${node.dbName}-procedures`,
                            label: 'Procedures',
                            type: 'category',
                            lazy: true,
                            icon: procedureIssues.length > 0 ? 'warning' : 'check_circle',
                            iconColor: procedureIssues.length > 0 ? 'negative' : 'positive',
                            diffCount: procedureIssues.length || null,
                        },
                        db.views && {
                            id: `${node.dbName}-views`,
                            label: 'Views',
                            type: 'category',
                            lazy: true,
                            icon: viewIssues.length > 0 ? 'warning' : 'check_circle',
                            iconColor: viewIssues.length > 0 ? 'negative' : 'positive',
                            diffCount: viewIssues.length || null,
                        },
                    ].filter(Boolean)

                    console.log('Database children:', children)
                    done(children)
                } else if (node.type === 'category') {
                    console.log('Loading category children for:', node.id)
                    const dbName = node.id.split('-')[0]
                    const dbDiffs = this.differences[dbName] || []

                    if (node.id.includes('-tables')) {
                        const tableIssues = dbDiffs.filter(
                            (d) =>
                                d.type.includes('table') ||
                                d.type.includes('field') ||
                                d.type.includes('index') ||
                                d.type.includes('trigger'),
                        )
                        console.log('Table category issues:', tableIssues)

                        const children = []

                        // // Add issues section if there are any
                        // if (tableIssues.length > 0) {
                        //     children.push({
                        //         id: `${dbName}-tables-issues`,
                        //         label: 'Issues',
                        //         type: 'issues',
                        //         icon: 'warning',
                        //         iconColor: 'negative',
                        //         diffCount: tableIssues.length,
                        //         children: this.createTableIssueGroups(dbName, tableIssues),
                        //     })
                        // }

                        // Add actual tables
                        const tables = this.existingDatabases[dbName].tables
                        console.log('Tables:', tables)

                        children.push(
                            ...Object.entries(tables).map(([tableName, table]) => {
                                const specificTableIssues = tableIssues.filter(
                                    (d) => d.tableName === tableName,
                                )
                                console.log(`Issues for table ${tableName}:`, specificTableIssues)
                                const hasIssues = specificTableIssues.length > 0

                                return {
                                    id: `${dbName}-table-${tableName}`,
                                    label: tableName,
                                    type: 'table',
                                    lazy: true,
                                    icon: hasIssues ? 'warning' : 'check_circle',
                                    iconColor: hasIssues ? 'negative' : 'positive',
                                    diffCount: hasIssues ? specificTableIssues.length : null,
                                    tableData: table,
                                    issueData: specificTableIssues,
                                }
                            }),
                        )

                        console.log('Category children:', children)
                        done(children)
                    } else if (node.id.includes('-procedures')) {
                        const children = []
                        const procedures = this.existingDatabases[dbName].procedures
                        children.push(
                            ...Object.entries(procedures).map(([index, procedure]) => {
                                const procedureName = procedure.Name
                                const specificProcedureIssues = dbDiffs.filter(
                                    (d) => d.type.includes('procedure') && d.Name === procedureName,
                                )
                                console.log(
                                    `Issues for procedure ${procedureName}:`,
                                    specificProcedureIssues,
                                )
                                const hasIssues = specificProcedureIssues.length > 0
                                return {
                                    id: `${dbName}-procedure-${procedureName}`,
                                    label: procedureName,
                                    index: index,
                                    type: 'procedure',
                                    lazy: false,
                                    icon: hasIssues ? 'warning' : 'check_circle',
                                    iconColor: hasIssues ? 'negative' : 'positive',
                                    diffCount: hasIssues ? specificProcedureIssues.length : null,
                                    procedureData: procedure,
                                    issueData: specificProcedureIssues,
                                }
                            }),
                        )
                        done(children)
                    } else if (node.id.includes('-views')) {
                        const children = []
                        const views = this.existingDatabases[dbName].views
                        console.log('Views:', views)
                        children.push(
                            ...Object.entries(views).map(([name, view]) => ({
                                id: `${dbName}-view-${name}`,
                                label: name,
                                type: 'view',
                                lazy: false,
                                view: view,
                            })),
                        )
                        done(children)
                    }
                } else if (node.type === 'table') {
                    console.log('Loading table children for:', node.id)
                    const table = node.tableData
                    console.log('Table data:', table)

                    if (!table) {
                        console.error('No table data found for node:', node)
                        done([])
                        return
                    }

                    const children = []

                    if (table.columns?.length > 0) {
                        children.push({
                            id: `${node.id}-columns`,
                            label: `Columns (${table.columns.length})`,
                            type: 'subcategory',
                            lazy: false,
                            children: table.columns.map(column => {
                                let details = [];
                                if (column.AutoIncrement) details.push('AUTO_INCREMENT');
                                if (column.NotNull) details.push('NOT NULL');
                                if (column.Default !== undefined) details.push(`DEFAULT ${column.Default}`);

                                return {
                                    id: `${node.id}-column-${column.Field}`,
                                    label: `${column.Field} (${column.Type})${details.length ? ' ' + details.join(', ') : ''}`,
                                    type: 'column',
                                    expandable: false,
                                    columnData: column
                                };
                            })
                        })
                    }

                    if (table.indexes?.length > 0) {
                        children.push({
                            id: `${node.id}-indexes`,
                            label: `Indexes (${table.indexes.length})`,
                            type: 'subcategory',
                            lazy: false,
                            children: table.indexes.map(index => ({
                                id: `${node.id}-index-${index.Name}`,
                                label: `${index.Name}${index.Primary ? ' (PRIMARY)' : ''} [${index.ColumnName.join(', ')}]`,
                                type: 'index',
                                expandable: false,
                                indexData: index
                            }))
                        })
                    }

                    console.log('Table children:', children)
                    done(children)
                }
            } catch (error) {
                console.error('Error in lazy loading:', error)
                fail()
            }
        },
        createTableIssueGroups(dbName, issues) {
            const groupedIssues = issues.reduce((acc, issue) => {
                const type = issue.type
                acc[type] = acc[type] || { count: 0, items: [] }
                acc[type].count++
                acc[type].items.push(issue)
                return acc
            }, {})

            return Object.entries(groupedIssues).map(([type, group]) => ({
                id: `${dbName}-tables-${type}`,
                label: type
                    .split('_')
                    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' '),
                type: 'issue-group',
                icon: 'warning',
                iconColor: 'negative',
                diffCount: group.count,
                children: group.items.map((issue) => ({
                    id: `${dbName}-tables-${type}-${issue.tableName || issue.Name}`,
                    label: issue.tableName || issue.Name,
                    type: 'issue',
                    icon: 'warning',
                    iconColor: 'negative',
                    expandable: false,
                    issueData: issue,
                })),
            }))
        },
        async fetchAllDifferences() {
            const response = await axios.post('http://localhost:3000/api/compare', {
                config: {
                    host: this.host,
                    port: this.port,
                    user: this.user,
                    password: this.password,
                    output: this.dbFolder,
                },
            })
            this.differences = response.data
            console.log('Differences in fetchAllDifferences:', this.differences)
        },
        async fetchDifferencesForSelectedDb() {
            if (Object.keys(this.existingDatabases).length > 0) {
                const selectedDbName = Object.keys(this.existingDatabases)[0]
                const response = await axios.post('http://localhost:3000/api/compare', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                        database: selectedDbName,
                    },
                })
                this.differences = response.data
            }
        },
        async createNewDump(overwrite = false) {
            console.log('Creating a new dump...')
            if(overwrite){
                this.$q.dialog({
                    title: 'Overwrite',
                    message: 'Are you sure you want to overwrite the existing dump?',
                    ok: 'Overwrite',
                    cancel: 'Cancel',
                }).onOk(async () => {
                    console.log('Overwriting existing dump')
                    await this.createNewDump(false)
                })
                return
            }

            let response = await axios
                .post('http://localhost:3000/api/dump', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                        // database: this.database,
                    },
                })
                .catch((error) => {
                    if (error.response.data.message) {
                        this.$q.dialog({
                            title: 'Error',
                            message: error.response.data.message,
                        })
                    }
                    console.error('Error creating new dump:', error)
                    return
                })

            if (!response) return
            if (response.data.message) {
                this.$q.dialog({
                    title: 'Error',
                    message: response.data.message,
                })
            }
            this.differences = await this.fetchAllDifferences()
            console.log('Differences in createNewDump:', this.differences)
            if (
                response.data &&
                typeof response.data === 'object' &&
                Object.keys(response.data).length > 0
            ) {
                this.existingDatabases = response.data
                this.buildDatabaseTree()
            } else {
                this.existingDatabases = {}
                this.$q.notify({
                    message: 'Error creating new dump',
                    color: 'red',
                })
            }
        },
        showIssueDetails(issue, node) {
            console.log('Showing issue details:', issue, "from node:", node)
            this.selectedIssues = Array.isArray(issue) ? issue : [issue]
            this.selectedNode = node;
            this.issueDialog = true
        },
        showSingleIssue(issue, dbName) {
            this.selectedIssues = [issue]
            this.selectedIssueDbName = dbName;
            this.issueDialog = true
        },
        async fixNodeIssues(node) {
            if (!node) return
            try {
                let issues = []
                let dbName = null;
                // Set loading state for this node
                this.isNodeFixing[node.id] = true
                this.isNodeFixing = { ...this.isNodeFixing } // Trigger reactivity

                if(node.issueData){
                    issues = Array.isArray(node.issueData) ? node.issueData : [node.issueData];
                }else{
                    issues = await this.collectIssuesForNode(node)
                }
                dbName = this.getDbNameFromNode(node)

                if (!issues.length){
                    console.error('No issues found to fix', node);
                    return;
                }


                const response = await axios.post('http://localhost:3000/api/apply', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                    },
                    database: dbName,
                    diffs: issues,
                })

                if (response.data.message) {
                    this.$q.notify({
                        type: 'positive',
                        message: `Fixed ${issues.length} issue(s) successfully`,
                        position: 'top',
                    })
                    // Refresh the differences to update the UI

                    await this.fetchAllDifferences()
                    await this.buildDatabaseTree()
                }
            } catch (error) {
                console.error('Error fixing issues:', error)
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error fixing issues',
                    position: 'top',
                })
            } finally {
                this.isNodeFixing[node.id] = false
                this.isNodeFixing = { ...this.isNodeFixing } // Trigger reactivity
            }
        },
        getDbNameFromNode(node) {
            // Extract database name from node ID (assumes format: "dbName-something-etc")
            if(node.id.startsWith('db-')){
                return node.id.split('-')[1]
            }
            if (!node.id) return null, console.error('Node ID is required to get db name', node);
            console.log('Node ID:', node.id)
            return node.id.split('-')[0]
        },
        async collectIssuesForNode(node) {
            const issues = []
            console.log('Collecting issues for node:', node)
            switch (node.type) {
                case 'database':
                    //collect issues from the differences for the selected db
                    console.log('Collecting issues for database:', this.getDbNameFromNode(node))
                    issues.push(...this.differences[this.getDbNameFromNode(node)])
                    break
                case 'issue':
                    if (node.issueData) issues.push(node.issueData)
                    break

                case 'issue-group':
                    // Collect all issues in this group
                    if (node.children) {
                        issues.push(
                            ...node.children
                                .filter((child) => child.type === 'issue')
                                .map((child) => child.issueData)
                                .filter(Boolean),
                        )
                    }
                    break

                case 'issues':
                case 'category':
                    // For categories or issues sections, collect all nested issues
                    if (node.children) {
                        for (const child of node.children) {
                            if (child.type === 'issue-group' && child.children) {
                                issues.push(
                                    ...child.children
                                        .filter((grandChild) => grandChild.type === 'issue')
                                        .map((grandChild) => grandChild.issueData)
                                        .filter(Boolean),
                                )
                            }else if(child.issueData){
                                if(Array.isArray(child.issueData)){
                                    issues.push(...child.issueData)
                                }else if (child.issueData.type){
                                    issues.push(child.issueData)
                                }else{
                                    console.error('Unknown issue data:', child.issueData)
                                }
                            }
                        }
                    }else{
                        //need to collect issues from the differences for the selected db and type
                        const selectedDbName = this.getDbNameFromNode(node)
                        console.log('Selected DB Name:', selectedDbName)
                        let type = node.id.split('-')[1]
                        const dbDifferences = this.differences[selectedDbName]
                        console.log('DB Differences:', dbDifferences)
                        if(type === 'tables'){
                            issues.push(...dbDifferences.filter(diff => diff.type.includes('table')))
                        }else if(type === 'views'){
                            issues.push(...dbDifferences.filter(diff => diff.type.includes('view')))
                        }else if(type === 'procedures'){
                            issues.push(...dbDifferences.filter(diff => diff.type.includes('procedure')))
                        }else{
                            console.error('Unknown type:', type)
                        }

                    }
                    break
            }

            return issues
        },
        async applyFix() {
            if (!this.selectedIssues.length) return

            try {
                this.isApplying = true
                await this.fixNodeIssues(this.selectedNode)
                this.issueDialog = false
            } finally {
                this.isApplying = false
            }
        },
        onFolderSelected(path) {
            this.dbFolder = path;
            // If you want to save the setting immediately
            const dbConfig = {
                host: this.host,
                port: this.port,
                user: this.user,
                password: this.password,
                database: this.database,
                output: this.dbFolder,
            }
            localStorage.setItem('dbConfig', JSON.stringify(dbConfig));
        },
    },
    mounted() {
        const dbConfig = localStorage.getItem('dbConfig')
        if (dbConfig) {
            const config = JSON.parse(dbConfig)
            this.host = config.host
            this.port = config.port
            this.user = config.user
            this.password = config.password
            this.database = config.database
            this.dbFolder = config.output
            this.isDbSetup = true
            this.getDatabasesFromExistingDumps()
            this.fetchAllDifferences()
        }
    },
}
</script>

<style lang="scss">
.database-tree {
    .q-tree__node-header {
        padding: 8px;
        border-radius: 4px;
        transition: background-color 0.3s;

        &:hover {
            background-color: #f5f5f5;
        }
    }

    .q-tree__node--selected > .q-tree__node-header {
        background-color: #e3f2fd;
    }

    .q-tree__node--child {
        padding-left: 24px;
    }

    .q-icon {
        font-size: 20px;
    }
}

.q-card {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    border-radius: 8px;
}

.q-btn {
    border-radius: 8px;
}

.text-h6 {
    font-weight: 500;
    letter-spacing: 0.25px;
}

.q-page {
    max-width: 1400px;
    margin: 0 auto;
}
</style>

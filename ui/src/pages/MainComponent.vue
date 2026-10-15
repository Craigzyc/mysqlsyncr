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
                <div class="row items-center justify-between">
                    <div class="row items-center">
                        <q-icon name="account_tree" class="q-mr-sm" />
                        <div class="text-h6">Database Structure</div>
                        <q-badge
                            v-if="totalIssueCount > 0"
                            color="negative"
                            class="q-ml-sm"
                        >
                            {{ totalIssueCount }}
                        </q-badge>
                        <q-chip
                            v-if="versionInfo"
                            dense
                            :color="versionInfo.notes.length ? 'warning' : 'white'"
                            :text-color="versionInfo.notes.length ? 'black' : 'primary'"
                            :icon="versionInfo.notes.length ? 'warning' : 'dns'"
                            class="q-ml-md"
                        >
                            Template MySQL {{ templateVersionText }} · Server MySQL {{ versionInfo.server || 'unknown' }}
                            <q-tooltip max-width="420px">
                                <div v-if="versionInfo.template?.inferred">
                                    Template version inferred: it {{ versionInfo.template.reason }}. A new dump records it exactly.
                                </div>
                                <div v-for="note in versionInfo.notes" :key="note" class="q-mt-xs">{{ note }}</div>
                                <div v-if="!versionInfo.notes.length && !versionInfo.template?.inferred">
                                    The template and server are the same MySQL version.
                                </div>
                            </q-tooltip>
                        </q-chip>
                    </div>
                    <q-space />
                    <q-btn
                        v-if="ignoredCount > 0"
                        flat
                        dense
                        no-caps
                        color="white"
                        icon="visibility"
                        :label="`${ignoredCount} ignored`"
                        @click="showAllIgnored"
                    >
                        <q-tooltip>Show all ignored differences again</q-tooltip>
                    </q-btn>
                    <q-btn
                        v-if="totalIssueCount > 0"
                        flat
                        dense
                        color="white"
                        :loading="isFixingAll"
                        @click="fixAllIssues"
                        icon="build"
                        class="q-ml-md"
                    >
                        <q-tooltip>Fix All Issues ({{ totalIssueCount }})</q-tooltip>
                        <template v-slot:loading>
                            <span class="row items-center">
                                Fixing... ({{ currentFixProgress }}/{{ totalIssueCount }})
                            </span>
                        </template>
                    </q-btn>
                </div>
            </q-card-section>

            <q-card-section>
                <q-tree
                    ref="tree"
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
                                <q-badge
                                    v-if="prop.node.hiddenCount"
                                    color="grey"
                                    outline
                                    class="q-ml-sm"
                                >
                                    {{ prop.node.hiddenCount }} ignored
                                </q-badge>
                            </div>

                            <q-btn
                                v-if="
                                    ['database', 'table'].includes(prop.node.type) &&
                                    (prop.node.diffCount || isNodeIgnored(prop.node))
                                "
                                flat
                                dense
                                color="grey-7"
                                :icon="isNodeIgnored(prop.node) ? 'visibility' : 'visibility_off'"
                                size="sm"
                                class="q-ml-md"
                                @click.stop="toggleIgnored(prop.node)"
                            >
                                <q-tooltip>
                                    {{ isNodeIgnored(prop.node) ? 'Show these differences again' : 'Ignore these differences for this session' }}
                                </q-tooltip>
                            </q-btn>

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
                                        default=""
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
                        <q-btn
                            v-if="issueListBeforeDetails"
                            flat
                            dense
                            icon="arrow_back"
                            label="Back to list"
                            color="primary"
                            class="q-mb-sm"
                            @click="backToIssueList"
                        />
                        <div class="text-subtitle2 q-mb-sm">
                            Issue Type:
                            <q-badge color="negative">{{
                                selectedIssues[0].type?.replace(/_/g, ' ')
                            }}</q-badge>
                        </div>
                        <div v-if="selectedIssues[0].tableName" class="q-mb-sm">
                            <strong>Table:</strong> {{ selectedIssues[0].tableName }}
                        </div>
                        <div v-if="issueName(selectedIssues[0])" class="q-mb-sm">
                            <strong>{{ issueNameLabel(selectedIssues[0]) }}:</strong> {{ issueName(selectedIssues[0]) }}
                        </div>
                        <div class="q-mb-sm">{{ issueSummary(selectedIssues[0]) }}</div>

                        <div v-if="definitionComparison(selectedIssues[0])" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">Definition differences:</div>
                            <DefinitionDiff
                                :expected="definitionComparison(selectedIssues[0]).expected"
                                :current="definitionComparison(selectedIssues[0]).current"
                            />
                        </div>

                        <div v-else-if="singleDefinition(selectedIssues[0])" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">{{ singleDefinition(selectedIssues[0]).label }}:</div>
                            <q-card class="bg-grey-2">
                                <q-card-section class="q-pa-md">
                                    <pre class="sql-code">{{ singleDefinition(selectedIssues[0]).sql }}</pre>
                                </q-card-section>
                            </q-card>
                        </div>

                        <div v-if="issueComparison(selectedIssues[0])" class="q-mt-md">
                            <div class="text-subtitle2 q-mb-sm">Comparison:</div>
                            <q-markup-table flat bordered dense>
                                <thead>
                                    <tr>
                                        <th class="text-left">Property</th>
                                        <th class="text-left">Database (current)</th>
                                        <th class="text-left">Template (expected)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="row in issueComparison(selectedIssues[0])" :key="row.property">
                                        <td>{{ row.property }}</td>
                                        <td :class="{ 'text-grey': row.current === undefined }">
                                            {{ formatIssueValue(row.current, row.currentPresent) }}
                                        </td>
                                        <td :class="{ 'text-negative': row.differs, 'text-grey': row.expected === undefined }">
                                            {{ formatIssueValue(row.expected, row.expectedPresent) }}
                                        </td>
                                    </tr>
                                </tbody>
                            </q-markup-table>
                        </div>

                        <div class="row q-gutter-sm q-mt-md">
                            <!-- Act on the issue shown, not on every issue under the selected tree node -->
                            <q-btn
                                @click="fixNodeIssues({ type: 'issue', id: selectedNode?.id, issueData: selectedIssues[0] })"
                                :loading="isNodeFixing[selectedNode?.id]"
                                color="primary"
                                label="Fix Issue"
                            />
                            <q-btn
                                v-if="canKeepCurrent(selectedIssues[0])"
                                @click="keepCurrentInTemplate({ type: 'issue', id: selectedNode?.id, issueData: selectedIssues[0] })"
                                :loading="isNodeKeeping[selectedNode?.id]"
                                color="secondary"
                                outline
                                label="Keep Current"
                            >
                                <q-tooltip>Overwrite the template with the database's current value</q-tooltip>
                            </q-btn>
                        </div>
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
                                { name: 'item', label: 'Item', field: (row) => issueName(row) },
                                { name: 'actions', label: 'Actions', field: 'actions' },
                            ]"
                            row-key="id"
                            dense
                        >
                            <template v-slot:body="props">
                                <q-tr :props="props">
                                    <q-td key="type">{{ props.row.type?.replace(/_/g, ' ') }}</q-td>
                                    <q-td key="tableName">{{ props.row.tableName }}</q-td>
                                    <q-td key="item">{{ issueName(props.row) }}</q-td>
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
                                        <q-btn
                                            v-if="canKeepCurrent(props.row)"
                                            flat
                                            dense
                                            color="secondary"
                                            icon="save_as"
                                            :loading="isNodeKeeping[`issue-${props.rowIndex}`]"
                                            @click="
                                                keepCurrentInTemplate({
                                                    type: 'issue',
                                                    id: this.selectedNode.id,
                                                    issueData: props.row,
                                                }, `issue-${props.rowIndex}`)
                                            "
                                        >
                                            <q-tooltip>Keep Current: overwrite the template with the database's current value</q-tooltip>
                                        </q-btn>
                                    </q-td>
                                </q-tr>
                            </template>
                        </q-table>

                        <q-btn
                            @click="fixNodeIssues(this.selectedNode)"
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
import FolderBrowser from '../components/FolderBrowser.vue'
import DefinitionDiff from '../components/DefinitionDiff.vue'

// Ignored databases/tables last for the browser tab, so they survive a reload but not a new session
const IGNORED_KEY = 'mysqlsyncr.ignored'
const loadIgnored = () => {
    try {
        return JSON.parse(sessionStorage.getItem(IGNORED_KEY)) || {}
    } catch {
        return {}
    }
}
const saveIgnored = (ignoredByScope) => {
    try {
        sessionStorage.setItem(IGNORED_KEY, JSON.stringify(ignoredByScope))
    } catch {
        // Storage unavailable (private window etc.): ignoring still works until the page reloads
    }
}


export default {
    components: {
        FolderBrowser,
        DefinitionDiff
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
            dbFolder: '',
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
            isNodeKeeping: {}, // Tracks loading state for Keep Current
            issueListBeforeDetails: null, // The issue list View Details was opened from
            rawDifferences: {}, // differences as the server sent them; this.differences leaves out ignored ones
            // { 'host:port|folder': { databases: [db], tables: ['db.table'] } }, kept for this browser session
            ignoredByScope: loadIgnored(),
            versionInfo: null, // { server, template: { version, inferred, reason }, notes } from /api/versions
            showFolderBrowser: false,
            isFixingAll: false,
            currentFixProgress: 0,
        }
    },
    computed: {
        // What's ignored for the current server and template folder
        ignored() {
            return this.ignoredByScope[this.ignoredScope] || { databases: [], tables: [] }
        },
        ignoredScope() {
            return `${this.host}:${this.port}|${this.dbFolder}`
        },
        templateVersionText() {
            const template = this.versionInfo?.template
            if (!template) return 'unknown'
            return template.inferred ? `${template.version} (inferred)` : template.version
        },
        ignoredCount() {
            return this.ignored.databases.length + this.ignored.tables.length
        },
        totalIssueCount() {
            return Object.values(this.differences)
                .reduce((total, dbIssues) => total + dbIssues.length, 0);
        },
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
                const response = await this.$api.post('/api/compare', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                        database: this.database,
                    },
                })
                this.setDifferences(response.data)
            } catch (error) {
                console.error('Error fetching differences:', error)
            }
        },
        async getDatabasesFromExistingDumps() {
            try {
                const response = await this.$api.post(
                    `/api/getDatabasesFromExistingDumps`,
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
                const ignored = this.isDatabaseIgnored(dbName)
                return {
                    id: `db-${dbName}`,
                    label: dbName,
                    type: 'database',
                    lazy: true,
                    icon: ignored ? 'visibility_off' : totalIssues > 0 ? 'warning' : 'check_circle',
                    iconColor: ignored ? 'grey' : totalIssues > 0 ? 'negative' : 'positive',
                    hiddenCount: this.hiddenCount(dbName),
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
                    const tableIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'tables')
                    console.log('Table issues:', tableIssues)

                    const procedureIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'procedures')
                    const viewIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'views')
                    const otherIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'other')

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
                        // Shown for view differences too, e.g. a view only in the database
                        (db.views || viewIssues.length > 0) && {
                            id: `${node.dbName}-views`,
                            label: 'Views',
                            type: 'category',
                            lazy: true,
                            icon: viewIssues.length > 0 ? 'warning' : 'check_circle',
                            iconColor: viewIssues.length > 0 ? 'negative' : 'positive',
                            diffCount: viewIssues.length || null,
                        },
                        // Differences that belong to no table, procedure or view, so every counted one is shown
                        otherIssues.length > 0 && {
                            id: `${node.dbName}-other`,
                            label: 'Other',
                            type: 'category',
                            lazy: false,
                            icon: 'warning',
                            iconColor: 'negative',
                            diffCount: otherIssues.length,
                            children: otherIssues.map((issue, i) => ({
                                id: `${node.dbName}-other-${i}`,
                                label: `${issue.type.replace(/_/g, ' ')}${this.issueName(issue) ? `: ${this.issueName(issue)}` : ''}`,
                                type: 'issue',
                                icon: 'warning',
                                iconColor: 'negative',
                                expandable: false,
                                diffCount: 1,
                                issueData: issue,
                            })),
                        },
                    ].filter(Boolean)

                    console.log('Database children:', children)
                    done(children)
                } else if (node.type === 'category') {
                    console.log('Loading category children for:', node.id)
                    const dbName = node.id.split('-')[0]
                    const dbDiffs = this.differences[dbName] || []

                    if (node.id.includes('-tables')) {
                        const tableIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'tables')
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

                        // Add actual tables, plus any only in the database (extra_table) so their issues show
                        const tables = { ...this.existingDatabases[dbName].tables }
                        const onlyInDatabase = new Set()
                        for (const issue of [...tableIssues, ...(this.rawDifferences[dbName] || [])]) {
                            if (issue.tableName && !tables[issue.tableName] && this.issueCategory(issue) === 'tables') {
                                tables[issue.tableName] = null
                                onlyInDatabase.add(issue.tableName)
                            }
                        }
                        console.log('Tables:', tables)

                        children.push(
                            ...Object.entries(tables).map(([tableName, table]) => {
                                const specificTableIssues = tableIssues.filter(
                                    (d) => d.tableName === tableName,
                                )
                                console.log(`Issues for table ${tableName}:`, specificTableIssues)
                                const hasIssues = specificTableIssues.length > 0

                                const ignored = this.isTableIgnored(dbName, tableName) || this.isDatabaseIgnored(dbName)
                                return {
                                    id: `${dbName}-table-${tableName}`,
                                    label: onlyInDatabase.has(tableName) ? `${tableName} (not in template)` : tableName,
                                    type: 'table',
                                    dbName,
                                    tableName,
                                    // A table only in the database has no template structure to expand
                                    lazy: table !== null,
                                    icon: ignored ? 'visibility_off' : hasIssues ? 'warning' : 'check_circle',
                                    iconColor: ignored ? 'grey' : hasIssues ? 'negative' : 'positive',
                                    hiddenCount: this.hiddenCount(dbName, tableName),
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
                        const views = { ...(this.existingDatabases[dbName].views || {}) }
                        const viewIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'views')
                        const onlyInDatabase = new Set()
                        for (const issue of viewIssues) {
                            if (!(issue.viewName in views)) {
                                views[issue.viewName] = null
                                onlyInDatabase.add(issue.viewName)
                            }
                        }
                        console.log('Views:', views)
                        children.push(
                            ...Object.entries(views).map(([name, view]) => {
                                const specificViewIssues = viewIssues.filter((d) => d.viewName === name)
                                const hasIssues = specificViewIssues.length > 0
                                return {
                                    id: `${dbName}-view-${name}`,
                                    label: onlyInDatabase.has(name) ? `${name} (not in template)` : name,
                                    type: 'view',
                                    lazy: false,
                                    view: view,
                                    icon: hasIssues ? 'warning' : 'check_circle',
                                    iconColor: hasIssues ? 'negative' : 'positive',
                                    diffCount: hasIssues ? specificViewIssues.length : null,
                                    issueData: specificViewIssues,
                                }
                            }),
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
            try {
                const response = await this.$api.post('/api/compare', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                },
                })
                this.setDifferences(response.data)
                console.log('Differences in fetchAllDifferences:', this.differences)
                this.fetchVersions()
            } catch (error) {
                console.error('Error fetching all differences:', error)
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error fetching all differences',
                    position: 'top'
                })
                throw error
            }
        },
        async fetchDifferencesForSelectedDb() {
            if (Object.keys(this.existingDatabases).length > 0) {
                const selectedDbName = Object.keys(this.existingDatabases)[0]
                try {
                    const response = await this.$api.post('/api/compare', {
                        config: {
                            host: this.host,
                            port: this.port,
                            user: this.user,
                            password: this.password,
                        output: this.dbFolder,
                        database: selectedDbName,
                        },
                    })
                    this.setDifferences(response.data)
                } catch (error) {
                    console.error('Error fetching differences for selected db:', error)
                }
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
                    await this.getDatabasesFromExistingDumps()
                    await this.fetchAllDifferences()
                })
                return
            }

            this.$q.loading.show({
                message: 'Creating new dump...',
                spinnerColor: 'primary',
                backgroundColor: 'grey-1',
                spinnerSize: 80,
                messageColor: 'primary',
                customClass: 'custom-loading',
            })

            try {

                let response = await this.$api.post('/api/dump', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                    },
                })

                if (response.data.message) {
                    this.$q.notify({
                        type: 'positive',
                        message: response.data.message,
                        position: 'top'
                    })
                }

                // Update loading message for each subsequent operation
                this.$q.loading.show({
                    message: 'Loading databases...',
                    spinnerColor: 'primary',
                    backgroundColor: 'grey-1',
                    spinnerSize: 80,
                    messageColor: 'primary',
                    customClass: 'custom-loading',
                })
                await this.getDatabasesFromExistingDumps()

                this.$q.loading.show({
                    message: 'Fetching differences...',
                    spinnerColor: 'primary',
                    backgroundColor: 'grey-1',
                    spinnerSize: 80,
                    messageColor: 'primary',
                    customClass: 'custom-loading',
                })
                await this.fetchAllDifferences()

            } catch (error) {
                this.$q.loading.hide()
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error creating dump',
                    position: 'top'
                })
                console.error('Error creating new dump:', error)
            } finally {
                this.$q.loading.hide()
            }
        },
        showIssueDetails(issue, node) {
            console.log('Showing issue details:', issue, "from node:", node)
            this.issueListBeforeDetails = null
            this.selectedIssues = Array.isArray(issue) ? issue : [issue]
            this.selectedNode = node;
            this.issueDialog = true
        },
        showSingleIssue(issue, dbName) {
            // Remember the list so the details view can go back to it
            if (this.selectedIssues.length > 1) this.issueListBeforeDetails = this.selectedIssues
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


                const response = await this.$api.post('/api/apply', {
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
                    this.afterIssuesResolved(issues)
                    // Refresh the differences, keeping the tree as it was
                    await this.refreshKeepingExpanded()
                }
            } catch (error) {
                console.error('Error fixing issues:', error)
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error fixing issues',
                    position: 'top',
                })
                // The server tries every difference and saves the ones that work, so refresh
                // to drop those that were applied; the dialog keeps the rest
                if (error.response) {
                    await this.refreshKeepingExpanded().catch((refreshError) => console.error('Error refreshing:', refreshError))
                }
            } finally {
                this.isNodeFixing[node.id] = false
                this.isNodeFixing = { ...this.isNodeFixing } // Trigger reactivity
            }
        },
        // Shown next to the differences; a failure just leaves the versions out
        async fetchVersions() {
            try {
                const response = await this.$api.post('/api/versions', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                    },
                })
                this.versionInfo = response.data
            } catch (error) {
                console.error('Error fetching MySQL versions:', error)
                this.versionInfo = null
            }
        },
        setDifferences(raw) {
            this.rawDifferences = raw || {}
            this.differences = this.withoutIgnored(this.rawDifferences)
        },
        withoutIgnored(raw) {
            return Object.fromEntries(
                Object.entries(raw).map(([dbName, diffs]) => [
                    dbName,
                    this.isDatabaseIgnored(dbName)
                        ? []
                        : (Array.isArray(diffs) ? diffs : []).filter(
                              (diff) => !(diff.tableName && this.isTableIgnored(dbName, diff.tableName)),
                          ),
                ]),
            )
        },
        isDatabaseIgnored(dbName) {
            return this.ignored.databases.includes(dbName)
        },
        isTableIgnored(dbName, tableName) {
            return this.ignored.tables.includes(`${dbName}.${tableName}`)
        },
        // How many of a database's (or one table's) differences are hidden by ignoring
        hiddenCount(dbName, tableName) {
            const diffs = Array.isArray(this.rawDifferences[dbName]) ? this.rawDifferences[dbName] : []
            if (tableName) {
                const hidden = this.isTableIgnored(dbName, tableName) || this.isDatabaseIgnored(dbName)
                return hidden ? diffs.filter((d) => d.tableName === tableName).length : 0
            }
            return diffs.length - (this.differences[dbName]?.length ?? 0)
        },
        isNodeIgnored(node) {
            if (node.type === 'database') return this.isDatabaseIgnored(node.dbName)
            if (node.type === 'table') return this.isTableIgnored(node.dbName, node.tableName)
            return false
        },
        async setIgnored(ignored) {
            this.ignoredByScope = { ...this.ignoredByScope, [this.ignoredScope]: ignored }
            saveIgnored(this.ignoredByScope)
            this.differences = this.withoutIgnored(this.rawDifferences)
            await this.rebuildTreeKeepingExpanded()
        },
        // Hide a database's or table's differences for this session, or show them again
        async toggleIgnored(node) {
            const { databases, tables } = this.ignored
            if (node.type === 'database') {
                const dbName = node.dbName
                await this.setIgnored({
                    databases: databases.includes(dbName) ? databases.filter((d) => d !== dbName) : [...databases, dbName],
                    tables,
                })
            } else if (node.type === 'table') {
                const key = `${node.dbName}.${node.tableName}`
                await this.setIgnored({
                    databases,
                    tables: tables.includes(key) ? tables.filter((t) => t !== key) : [...tables, key],
                })
            }
        },
        async showAllIgnored() {
            await this.setIgnored({ databases: [], tables: [] })
        },
        async rebuildTreeKeepingExpanded() {
            const expanded = [...this.expandedNodes]
            await this.buildDatabaseTree()
            await this.restoreExpanded(expanded)
        },
        // Reload the differences (and the template if it changed) and rebuild the tree,
        // re-opening the nodes that were expanded
        async refreshKeepingExpanded({ reloadTemplate = false } = {}) {
            const expanded = [...this.expandedNodes]
            await this.fetchAllDifferences()
            if (reloadTemplate) await this.getDatabasesFromExistingDumps()
            await this.buildDatabaseTree()
            await this.restoreExpanded(expanded)
        },
        // Expand the given nodes again. Children of lazy nodes only exist once their
        // parent is expanded, so expand level by level until nothing more is found
        async restoreExpanded(keys) {
            const tree = this.$refs.tree
            if (!tree) return
            const pending = new Set(keys)
            while (pending.size > 0) {
                await this.$nextTick()
                const found = [...pending].filter((key) => tree.getNodeByKey(key))
                if (found.length === 0) break
                for (const key of found) {
                    tree.setExpanded(key, true)
                    pending.delete(key)
                }
            }
        },
        // Which part of the tree a difference is shown under: tables, procedures, views or other
        issueCategory(issue) {
            if (issue.type?.includes('procedure')) return 'procedures'
            if (issue.type?.includes('view')) return 'views'
            if (issue.tableName) return 'tables'
            return 'other'
        },
        // The column, index, trigger, procedure, view or row an issue is about
        issueName(issue) {
            if (!issue) return ''
            if (issue.field?.Field) return issue.field.Field
            if (issue.indexName || issue.index?.Name) return issue.indexName || issue.index.Name
            if (issue.trigger?.Name) return issue.trigger.Name
            if (issue.key) return Object.entries(issue.key).map(([k, v]) => `${k} = ${v}`).join(', ')
            return issue.viewName || issue.Name || issue.database || ''
        },
        issueNameLabel(issue) {
            const kind = issue?.type?.split('_').slice(1).join('_')
            return { field: 'Column', index: 'Index', trigger: 'Trigger', procedure: 'Procedure', view: 'View', row: 'Row', database: 'Database' }[kind] || 'Name'
        },
        issueSummary(issue) {
            if (!issue?.type) return ''
            const [state, ...rest] = issue.type.split('_')
            const kind = this.issueNameLabel(issue).toLowerCase()
            const thing = rest.join('_') === 'table' ? 'This table' : `The ${kind}`
            if (state === 'extra') return `${thing} is in the database but not in the template.`
            if (state === 'missing') return `${thing} is in the template but not in the database.`
            if (state === 'mismatched') {
                const what = issue.info || issue.from
                return `${thing} differs between the database and the template${what ? ` (${what})` : ''}.`
            }
            return ''
        },
        // [{ property, current, expected, ... }] comparing the database and template side of an issue, or null
        issueComparison(issue) {
            const sides = {
                extra_field: [issue?.field, undefined],
                missing_field: [undefined, issue?.field],
                mismatched_field: [issue?.currentField, issue?.field],
                extra_index: [issue?.index, undefined],
                missing_index: [undefined, issue?.index],
                missing_row: [undefined, issue?.row],
            }[issue?.type]
            if (!sides) return null
            const [current, expected] = sides
            const keys = [...new Set([...Object.keys(current || {}), ...Object.keys(expected || {})])]
            return keys
                .filter((key) => (current?.[key] ?? null) !== null || (expected?.[key] ?? null) !== null)
                .map((key) => ({
                    property: key,
                    current: current?.[key],
                    expected: expected?.[key],
                    currentPresent: !!current,
                    expectedPresent: !!expected,
                    differs: !!current && !!expected && JSON.stringify(current[key] ?? null) !== JSON.stringify(expected[key] ?? null),
                }))
        },
        // { expected, current } definitions of a mismatched procedure, view or trigger, or null
        definitionComparison(issue) {
            const pair = {
                mismatched_procedure: [issue?.Definition, issue?.currentDefinition],
                mismatched_view: [issue?.definition, issue?.current],
                mismatched_trigger: [issue?.trigger?.Definition, issue?.currentTrigger?.Definition],
            }[issue?.type]
            // Diffs from an older server have no current definition to compare
            if (!pair || pair[1] === undefined) return null
            return { expected: pair[0] ?? '', current: pair[1] ?? '' }
        },
        // { label, sql } for an issue that has a definition on one side only
        singleDefinition(issue) {
            if (!issue) return null
            const sql = issue.createSQL || issue.Definition || issue.definition || issue.trigger?.Definition
            if (!sql) return null
            const fromDatabase = issue.type?.startsWith('extra_')
            return { label: `Definition in the ${fromDatabase ? 'database (current)' : 'template (expected)'}`, sql }
        },
        formatIssueValue(value, present) {
            if (!present) return '(not present)'
            if (value === undefined || value === null) return '—'
            if (Array.isArray(value)) return value.join(', ')
            if (typeof value === 'boolean') return value ? 'yes' : 'no'
            return String(value)
        },
        // Drop resolved issues from the dialog: back to the list when the details view
        // is done, and close once nothing is left
        afterIssuesResolved(resolved) {
            const remaining = (list) => list?.filter((issue) => !resolved.includes(issue))
            this.issueListBeforeDetails = remaining(this.issueListBeforeDetails)
            this.selectedIssues = remaining(this.selectedIssues)
            if (this.selectedIssues.length === 0 && this.issueListBeforeDetails?.length) {
                this.backToIssueList()
            }
            if (this.selectedIssues.length === 0) this.issueDialog = false
        },
        backToIssueList() {
            this.selectedIssues = this.issueListBeforeDetails
            this.issueListBeforeDetails = null
        },
        // Every difference except these can be kept by changing the template
        canKeepCurrent(issue) {
            return !!issue && !['missing_database', 'missing_row'].includes(issue.type)
        },
        // The opposite of fixNodeIssues: change the template to match the database
        async keepCurrentInTemplate(node, loadingKey = node?.id) {
            if (!node) return
            const issues = node.issueData
                ? (Array.isArray(node.issueData) ? node.issueData : [node.issueData])
                : await this.collectIssuesForNode(node)
            const keepable = issues.filter((issue) => this.canKeepCurrent(issue))
            if (!keepable.length) {
                this.$q.notify({ type: 'warning', message: 'Nothing here can be kept as the current value', position: 'top' })
                return
            }

            const confirmed = await new Promise((resolve) => {
                this.$q
                    .dialog({
                        title: 'Keep Current',
                        message: `Overwrite the template in ${this.dbFolder} with the database's current value for ${keepable.length} difference(s)? The database isn't changed.`,
                        cancel: true,
                        persistent: true,
                    })
                    .onOk(() => resolve(true))
                    .onCancel(() => resolve(false))
            })
            if (!confirmed) return

            this.isNodeKeeping = { ...this.isNodeKeeping, [loadingKey]: true }
            try {
                await this.$api.post('/api/acceptCurrent', {
                    config: {
                        host: this.host,
                        port: this.port,
                        user: this.user,
                        password: this.password,
                        output: this.dbFolder,
                    },
                    database: this.getDbNameFromNode(node),
                    diffs: keepable,
                })
                this.$q.notify({
                    type: 'positive',
                    message: `Template updated for ${keepable.length} difference(s)`,
                    position: 'top',
                })
                this.afterIssuesResolved(keepable)
            } catch (error) {
                console.error('Error keeping current values:', error)
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error updating the template',
                    position: 'top',
                })
            } finally {
                this.isNodeKeeping = { ...this.isNodeKeeping, [loadingKey]: false }
                // Refresh even after a partial failure: the differences that succeeded were saved.
                // The template changed too, so reload it
                await this.refreshKeepingExpanded({ reloadTemplate: true })
            }
        },
        getDbNameFromNode(node) {
            // Extract database name from node ID (assumes format: "dbName-something-etc")
            if(!node || !node.id) node = this.selectedNode
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
                          console.log('Collecting table issues')
                          console.log('DB Differences:', dbDifferences)
                          issues.push(...dbDifferences.filter(diff => diff.type.includes('table') || diff.tableName))
                      }else if(type === 'views'){
                          console.log('Collecting view issues')
                          issues.push(...dbDifferences.filter(diff => diff.type.includes('view')))
                      }else if(type === 'procedures'){
                          console.log('Collecting procedure issues')
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
        async fixAllIssues() {
            if (this.isFixingAll) return;

            try {
                this.isFixingAll = true;
                this.currentFixProgress = 0;

                let iterationCount = 0;

                // Create the initial dialog
                const dialog = this.$q.dialog({
                    title: 'Fixing Database Issues',
                    message: `<div class="text-h6">Iteration: 1/6</div>
                             <div class="text-subtitle2">Remaining issues: ${this.totalIssueCount}</div>
                             <div class="text-caption">Preparing...</div>`,
                    html: true,
                    progress: {
                        spinner: true,
                        color: 'primary'
                    },
                    persistent: true,
                    ok: false
                });

                while (iterationCount < 6 && this.totalIssueCount > 0) {
                    iterationCount++;

                    // Update dialog for new iteration
                    dialog.update({
                        message: `<div class="text-h6">Iteration: ${iterationCount}/6</div>
                                 <div class="text-subtitle2">Remaining issues: ${this.totalIssueCount}</div>
                                 <div class="text-caption">Starting fixes...</div>`,
                        html: true
                    });

                    // Fix issues for each database
                    for (const dbName of Object.keys(this.differences)) {
                        if (this.differences[dbName].length > 0) {
                            const node = {
                                id: `db-${dbName}`,
                                type: 'database'
                            };

                            // Update progress before fixing
                            dialog.update({
                                message: `<div class="text-h6">Iteration: ${iterationCount}/6</div>
                                         <div class="text-subtitle2">Remaining issues: ${this.totalIssueCount}</div>
                                         <div class="text-caption q-mt-sm">Currently fixing: <span class="text-weight-bold">${dbName}</span></div>`,
                                html: true
                            });

                            await this.fixNodeIssues(node);
                        }
                    }

                    // Refresh differences after all databases are processed
                    await this.fetchAllDifferences();

                    // If all issues are fixed, show success
                    if (this.totalIssueCount === 0) {
                        await dialog.hide();
                        this.$q.dialog({
                            title: 'Success!',
                            message: `<div class="text-h6 text-positive">All issues have been fixed!</div>
                                     <div class="text-subtitle2">Completed in ${iterationCount} iterations</div>`,
                            html: true,
                            ok: true,
                            persistent: false
                        });
                        break;
                    }

                }

                // If we hit the iteration limit
                if (iterationCount >= 6 && this.totalIssueCount > 0) {
                    await dialog.hide();
                    this.$q.dialog({
                        title: 'Process Complete',
                        message: `<div class="text-h6 text-warning">Maximum iterations reached</div>
                                 <div class="text-subtitle2">${this.totalIssueCount} issues remaining</div>
                                 <div class="text-caption">Completed all 6 iterations</div>`,
                        html: true,
                        ok: true,
                        persistent: false
                    });
                }

            } catch (error) {
                console.error('Error fixing all issues:', error);
                this.$q.dialog({
                    title: 'Error',
                    message: `<div class="text-negative">An error occurred while fixing issues</div>
                             <div class="text-caption">${error.message}</div>`,
                    html: true,
                    ok: true,
                    persistent: false
                });
            } finally {
                this.isFixingAll = false;
                this.currentFixProgress = 0;
            }
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

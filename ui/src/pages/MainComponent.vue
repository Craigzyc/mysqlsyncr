<template>
    <q-page class="sync-workspace">
        <header class="workspace-header">
            <div class="workspace-brand"><q-icon name="sync_alt" size="30px" /><div><h1>MySQLsyncr</h1><p>Compare, restore and inspect your databases.</p></div></div>
            <q-btn outline no-caps @click="openSettings" :disable="busy" icon="settings" label="Connection settings" color="primary" />
        </header>
        <section class="connection-strip" aria-label="Current connection">
            <div><q-icon name="dns" /><span>{{ isDbSetup ? host + ':' + port : 'No connection configured' }}</span><q-badge v-if="isDbSetup" outline color="primary">{{ database || 'All template databases' }}</q-badge></div>
            <div class="template-path"><q-icon name="folder_open" /><span>{{ dbFolder || 'Choose a CAM template folder to get started' }}</span></div>
        </section>
        <q-banner v-if="!isDbSetup" class="workspace-welcome q-mb-lg">
            <template #avatar><q-icon name="database" color="primary" /></template>
            <strong>Start with your server and template.</strong>
            <div>Choose the database connection and DBTemplate folder. Comparing reads the database; changes are applied separately.</div>
            <template #action><q-btn no-caps unelevated color="primary" label="Configure connection" @click="openSettings" /></template>
        </q-banner>
        <q-tabs v-model="activeTab" align="left" no-caps active-color="primary" indicator-color="primary" class="workspace-tabs">
            <q-tab name="schema" label="Schema sync" icon="account_tree" />
            <q-tab name="performance" label="Performance" icon="speed" />
        </q-tabs>
        <PerformanceCheck v-show="activeTab === 'performance'" :config="connectionConfig" :enabled="isDbSetup && !busy" />
        <section v-show="activeTab === 'schema'">
        <div class="workspace-actions">
            <div class="comparison-status" role="status" aria-live="polite">
                <q-spinner v-if="comparisonState === 'loading'" color="primary" size="22px" />
                <q-icon v-else :name="comparisonState === 'error' ? 'error_outline' : comparisonState === 'ready' ? (totalIssueCount ? 'difference' : 'check_circle') : 'help_outline'" :color="comparisonState === 'error' ? 'negative' : comparisonState === 'ready' && !totalIssueCount ? 'positive' : 'primary'" size="24px" />
                <div><strong>{{ comparisonStatus }}</strong><div class="text-caption text-grey-7">{{ lastCompared ? 'Last compared ' + lastCompared : 'Compare to check the current database structure.' }}{{ ignoredCount ? ' Ignored differences are excluded.' : '' }}</div></div>
            </div>
            <div class="row q-gutter-sm">
                <q-btn no-caps outline color="primary" icon="download" label="Export database" :disable="!isDbSetup || busy" @click="createNewDump(Object.keys(existingDatabases).length > 0)" />
                <q-btn no-caps unelevated color="primary" icon="compare_arrows" label="Compare now" :loading="comparisonState === 'loading'" :disable="!isDbSetup || busy" @click="refreshWorkspace" />
            </div>
        </div>
        <q-banner v-if="comparisonError" class="bg-red-1 text-negative q-mb-md" role="alert">{{ comparisonError }}</q-banner>
        <q-banner v-if="isDbSetup && comparisonState === 'ready' && !Object.keys(existingDatabases).length" class="bg-blue-1 q-mb-md">No database definitions were found in this folder for the selected database. Choose the folder containing the database JSON files, or export this server to create a template.</q-banner>

        <!-- Database Structure Card -->
        <q-card v-if="Object.keys(existingDatabases).length > 0" class="schema-card q-mb-lg" flat bordered>
            <q-card-section class="schema-card-heading">
                <div class="row items-center justify-between">
                    <div class="row items-center">
                        <q-icon name="account_tree" class="q-mr-sm" />
                        <h2 class="text-h6 q-ma-none">Database structure</h2>
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
                        color="primary"
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
                        color="primary"
                        :loading="isFixingAll"
                        @click="fixAllIssues"
                        label="Apply all"
                        no-caps
                        icon="build" aria-label="Apply template changes" :disable="!canApply"
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

            <q-card-section v-if="templateDrift.length > 0" class="q-pb-none">
                <q-banner dense rounded class="bg-orange-1 text-black">
                    <template v-slot:avatar>
                        <q-icon name="difference" color="warning" />
                    </template>
                    {{ templateDrift.length }} table(s) in the template have a tables/&lt;table&gt;.sql file that differs
                    from the createSQL in the database's JSON, which is what comparing uses. Pick which version to keep.
                    <div class="q-mt-xs">
                        <q-chip
                            v-for="drift in templateDrift"
                            :key="`${drift.database}.${drift.table}`"
                            dense
                            clickable
                            icon="rule"
                            @click="reviewDrift(drift)"
                        >
                            {{ drift.database }}.{{ drift.table }}
                            <q-tooltip>Review and pick a version</q-tooltip>
                        </q-chip>
                    </div>
                </q-banner>
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
                                :tabindex="prop.node.issueData && prop.node.diffCount ? 0 : undefined"
                                :role="prop.node.issueData && prop.node.diffCount ? 'button' : undefined"
                                @keydown.enter.stop="prop.node.issueData && prop.node.diffCount && showIssueDetails(prop.node.issueData, prop.node)"
                                @click="openNode($event, prop.node)"
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
                                :aria-label="(isNodeIgnored(prop.node) ? 'Show differences for ' : 'Ignore differences for ') + prop.node.label"
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
                                icon="build" aria-label="Apply template changes" :disable="!canApply"
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

        </section>

        <q-dialog v-model="settingsDialog" persistent>
            <q-card class="settings-card">
                <q-card-section class="bg-primary text-white">
                    <div class="text-h5">Connection settings</div>
                    <div class="text-subtitle2">Set the server to inspect and the template to compare against.</div>
                </q-card-section>

                <q-card-section class="q-pa-lg col scroll">
                    <div class="row q-col-gutter-lg justify-center">
                        <div class="col-12 col-sm-10">
                            <div class="row q-col-gutter-md">
                                <div class="col-12 col-sm-6">
                                    <q-input
                                        v-model="settingsDraft.host"
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
                                        v-model="settingsDraft.port"
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
                                        v-model="settingsDraft.user"
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
                                        v-model="settingsDraft.password"
                                        label="Database password" hint="Kept only until this page is closed or reloaded."
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
                                        v-model="settingsDraft.database"
                                        label="Database (optional)" hint="Leave blank for all databases in the template."
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
                                        v-model="settingsDraft.output"
                                        label="Template folder"
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

                <q-banner v-if="settingsError" class="bg-red-1 text-negative q-mx-lg" role="alert">{{ settingsError }}</q-banner>
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
                        label="Save and compare"
                        color="primary"
                        unelevated
                        class="q-px-md q-ml-sm"
                    />
                </q-card-actions>
            </q-card>
        </q-dialog>

        <!-- Issue Details Dialog -->
        <q-dialog v-model="issueDialog">
            <q-card class="review-dialog">
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

                        <div v-if="selectedIssues[0].type === 'mismatched_index' && selectedIssues[0].index" class="q-mb-sm">
                            <strong>Columns:</strong>
                            {{ (selectedIssues[0].index.ColumnName || []).join(', ') }}
                            <q-badge v-if="selectedIssues[0].index.Primary" color="primary" class="q-ml-sm">
                                PRIMARY
                            </q-badge>
                            <q-badge
                                v-else-if="selectedIssues[0].index.Unique"
                                color="secondary"
                                class="q-ml-sm"
                            >
                                UNIQUE
                            </q-badge>
                        </div>

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
                                @click="fixSingleIssue()"
                                :loading="isNodeFixing['single-issue']"
                                :disable="!canApply"
                                color="primary"
                                label="Fix Issue"
                            />
                            <q-btn
                                v-if="canKeepCurrent(selectedIssues[0])"
                                @click="keepCurrentInTemplate({ type: 'issue', id: 'single-issue', dbName: selectedIssueDbName, issueData: selectedIssues[0] })"
                                :disable="!canApply"
                                :loading="isNodeKeeping['single-issue']"
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
                                { name: 'name', label: 'Name', field: (row) => issueName(row) },
                                { name: 'tableName', label: 'Table', field: 'tableName' },
                                { name: 'item', label: 'Item', field: (row) => issueName(row) },
                                { name: 'actions', label: 'Actions', field: 'actions' },
                            ]"
                            :row-key="issueKey"
                            dense
                        >
                            <template v-slot:body="props">
                                <q-tr :props="props">
                                    <q-td key="type">{{ props.row.type?.replace(/_/g, ' ') }}</q-td>
                                    <q-td key="name">{{ issueName(props.row) }}</q-td>
                                    <q-td key="tableName">{{ props.row.tableName }}</q-td>
                                    <q-td key="item">{{ issueName(props.row) }}</q-td>
                                    <q-td key="actions">
                                        <q-btn
                                            flat
                                            dense
                                            color="primary"
                                            icon="visibility"
                                            @click="showSingleIssue(props.row, selectedIssueDbName)"
                                        >
                                            <q-tooltip>View Details</q-tooltip>
                                        </q-btn>
                                        <q-btn
                                            flat
                                            dense
                                            color="positive"
                                            icon="build" aria-label="Apply template changes" :disable="!canApply"
                                            :loading="isNodeFixing[`issue-${props.rowIndex}`]"
                                            @click="
                                                fixNodeIssues({
                                                    type: 'issue',
                                                    id: `issue-${props.rowIndex}`,
                                                    dbName: selectedIssueDbName,
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
                                            :disable="!canApply"
                                :loading="isNodeKeeping[`issue-${props.rowIndex}`]"
                                            @click="
                                                keepCurrentInTemplate({
                                                    type: 'issue',
                                                    id: `issue-${props.rowIndex}`,
                                                    dbName: selectedIssueDbName,
                                                    issueData: props.row,
                                                })
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
                            :loading="isNodeFixing[selectedNode?.id]"
                            :disable="!canApply"
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

        <q-dialog v-model="driftDialog">
            <q-card v-if="selectedDrift" class="review-dialog">
                <q-card-section>
                    <div class="text-h6">{{ selectedDrift.database }}.{{ selectedDrift.table }}</div>
                    <div class="text-body2 q-mt-sm">
                        The table's createSQL in {{ selectedDrift.database }}.json (used for comparing and for
                        creating the table) differs from {{ selectedDrift.file }}. Keeping one copies it over the other;
                        notes written after the statement in the .sql file are kept either way.
                    </div>
                </q-card-section>
                <q-card-section class="q-pt-none">
                    <DefinitionDiff
                        :expected="selectedDrift.json"
                        :current="selectedDrift.sql"
                        :expected-label="`${selectedDrift.database}.json (used for comparing)`"
                        :current-label="selectedDrift.file"
                    />
                </q-card-section>
                <q-card-actions align="right">
                    <q-btn flat label="Cancel" color="primary" v-close-popup />
                    <q-btn
                        outline
                        color="primary"
                        :label="`Use ${selectedDrift.file}`"
                        :loading="resolvingDrift === 'sql'"
                        :disable="!!resolvingDrift"
                        @click="resolveDrift('sql')"
                    >
                        <q-tooltip>Copy the .sql file's statement into the JSON, so comparing uses it</q-tooltip>
                    </q-btn>
                    <q-btn
                        unelevated
                        color="primary"
                        :label="`Use ${selectedDrift.database}.json`"
                        :loading="resolvingDrift === 'json'"
                        :disable="!!resolvingDrift"
                        @click="resolveDrift('json')"
                    >
                        <q-tooltip>Copy the JSON's createSQL into the .sql file</q-tooltip>
                    </q-btn>
                </q-card-actions>
            </q-card>
        </q-dialog>

        <FolderBrowser v-if="showFolderBrowser"
            v-model="showFolderBrowser"
            :initial-path="settingsDraft.output"
            @folder-selected="onFolderSelected"
        />
    </q-page>
</template>

<script>
import FolderBrowser from '../components/FolderBrowser.vue'
import { defaultConfig, normalizeConfig, saveConnection, loadConnection, databaseForNode } from '../workspaceState'
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
import PerformanceCheck from '../components/PerformanceCheck.vue'


export default {
    components: {
        FolderBrowser,
        DefinitionDiff,
        PerformanceCheck
    },
    data() {
        return {
            isDbSetup: false,
            activeTab: 'schema',
            settingsDraft: defaultConfig(),
            settingsError: '',
            comparisonState: 'idle',
            comparisonError: '',
            lastCompared: '',
            activeOperation: '',
            isApplying: false,
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
            selectedIssueDbName: null,
            isNodeFixing: {}, // Tracks loading state for each node
            isNodeKeeping: {}, // Tracks loading state for Keep Current
            issueListBeforeDetails: null, // The issue list View Details was opened from
            rawDifferences: {}, // differences as the server sent them; this.differences leaves out ignored ones
            // { 'host:port|folder': { databases: [db], tables: ['db.table'] } }, kept for this browser session
            ignoredByScope: loadIgnored(),
            versionInfo: null, // { server, template: { version, inferred, reason }, notes } from /api/versions
            templateDrift: [], // [{ database, table, file, json, sql }]: .sql files that differ from the JSON createSQL
            driftDialog: false,
            selectedDrift: null,
            resolvingDrift: null, // 'json' or 'sql' while saving
            showFolderBrowser: false,
            isFixingAll: false,
            currentFixProgress: 0,
        }
    },
    computed: {
        connectionConfig() {
            return { host: this.host, port: this.port, user: this.user, password: this.password, database: this.database, output: this.dbFolder }
        },
        busy() { return !!this.activeOperation || this.isFixingAll || this.comparisonState === 'loading' },
        canApply() { return this.isDbSetup && this.comparisonState === 'ready' && !this.busy },
        comparisonStatus() {
            if (this.comparisonState === 'loading') return 'Comparing database and template…'
            if (this.comparisonState === 'error') return 'Comparison failed'
            if (this.comparisonState !== 'ready') return 'Not compared yet'
            return this.totalIssueCount ? this.totalIssueCount + ' differences to review' : 'No differences found'
        },
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
        issueKey(issue) { return JSON.stringify(issue) },
        openNode(event, node) {
            if (node.issueData && node.diffCount) {
                event.stopPropagation()
                this.showIssueDetails(node.issueData, node)
            }
        },
        openSettings() {
            if (this.busy) return
            this.settingsDraft = { ...this.connectionConfig }
            this.settingsError = ''
            this.settingsDialog = true
        },
        closeSettings() {
            this.settingsDialog = false
            this.showFolderBrowser = false
        },
        async saveSettings() {
            if (this.busy) return
            let config
            try { config = normalizeConfig(this.settingsDraft) }
            catch (error) { this.settingsError = error.message; return }
            Object.assign(this, { host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, dbFolder: config.output })
            try { saveConnection(localStorage, config) } catch { /* Storage may be unavailable. */ }
            this.isDbSetup = true
            this.issueDialog = false
            this.driftDialog = false
            this.selectedIssues = []
            this.existingDatabases = {}
            this.databaseTree = []
            this.rawDifferences = {}
            this.differences = {}
            this.versionInfo = null
            this.templateDrift = []
            this.lastCompared = ''
            this.closeSettings()
            await this.refreshWorkspace()
        },
        async refreshWorkspace() {
            if (!this.isDbSetup || this.busy) return
            this.comparisonState = 'loading'
            this.comparisonError = ''
            try {
                await this.getDatabasesFromExistingDumps()
                await this.refreshKeepingExpanded()
                await this.fetchTemplateDrift()
            } catch (error) {
                this.comparisonState = 'error'
                this.comparisonError = error.response?.data?.message || error.message || 'Could not compare the database.'
                this.setDifferences({})
                this.databaseTree = []
            }
        },
        async refreshDifferences() { await this.refreshWorkspace() },
        async getDatabasesFromExistingDumps() {
                const response = await this.$api.post(
                    `/api/getDatabasesFromExistingDumps`,
                    {
                        config: { ...this.connectionConfig },
                    },
                )
                if (response.data && typeof response.data === 'object') {
                    this.existingDatabases = this.database
                        ? Object.fromEntries(Object.entries(response.data).filter(([name]) => name === this.database))
                        : response.data
                }
        },
        async buildDatabaseTree() {
            this.databaseTree = Object.entries(this.existingDatabases).map(([dbName, db]) => {

                const dbDiffs = this.differences[dbName] || []
                const totalIssues = dbDiffs.length

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

            this.expandedNodes = []
        },
        onLazyLoad({ node, done, fail }) {

            try {
                if (node.type === 'database') {

                    const db = node.dbData
                    const dbDiffs = this.differences[node.dbName] || []

                    // Count issues by main category
                    const tableIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'tables')

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
                        (db.procedures?.length || procedureIssues.length) && {
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

                    done(children.map(child => ({ ...child, dbName: child.dbName || node.dbName || this.getDbNameFromNode(node) })))
                } else if (node.type === 'category') {

                    const dbName = this.getDbNameFromNode(node)
                    const dbDiffs = this.differences[dbName] || []

                    if (node.id.includes('-tables')) {
                        const tableIssues = dbDiffs.filter((d) => this.issueCategory(d) === 'tables')

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

                        children.push(
                            ...Object.entries(tables).map(([tableName, table]) => {
                                const specificTableIssues = tableIssues.filter(
                                    (d) => d.tableName === tableName,
                                )

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

                        done(children.map(child => ({ ...child, dbName: child.dbName || node.dbName || this.getDbNameFromNode(node) })))
                    } else if (node.id.includes('-procedures')) {
                        const children = []
                        const procedures = [...(this.existingDatabases[dbName].procedures || [])]
                        for (const issue of dbDiffs.filter(diff => this.issueCategory(diff) === 'procedures')) {
                            if (!procedures.some(procedure => procedure.Name === issue.Name)) procedures.push({ Name: issue.Name })
                        }
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
                        done(children.map(child => ({ ...child, dbName: child.dbName || node.dbName || this.getDbNameFromNode(node) })))
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
                        done(children.map(child => ({ ...child, dbName: child.dbName || node.dbName || this.getDbNameFromNode(node) })))
                    }
                } else if (node.type === 'table') {

                    const table = node.tableData

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

                    done(children.map(child => ({ ...child, dbName: child.dbName || node.dbName || this.getDbNameFromNode(node) })))
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
            this.comparisonState = 'loading'
            this.comparisonError = ''
            try {
                const response = await this.$api.post('/api/compare', {
                    config: { ...this.connectionConfig },
                })
                this.setDifferences(response.data)
                this.comparisonState = 'ready'
                this.lastCompared = new Date().toLocaleTimeString()
                await this.fetchVersions()
            } catch (error) {
                this.comparisonState = 'error'
                this.comparisonError = error.response?.data?.message || error.message
                this.setDifferences({})
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
            if (!this.isDbSetup || this.busy) return
            if(overwrite){
                this.$q.dialog({
                    title: 'Replace the template with this database?',
                    message: 'Exporting saves the current database structure to ' + this.dbFolder + '. Existing template definitions there will be replaced.',
                    ok: 'Overwrite',
                    cancel: 'Cancel',
                }).onOk(async () => {
                    await this.createNewDump(false)
                })
                return
            }

            this.activeOperation = 'export'
            this.$q.loading.show({
                message: 'Exporting database structure...',
                spinnerColor: 'primary',
                backgroundColor: 'grey-1',
                spinnerSize: 80,
                messageColor: 'primary',
                customClass: 'custom-loading',
            })

            try {

                let response = await this.$api.post('/api/dump', {
                    config: { ...this.connectionConfig },
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
                await this.refreshKeepingExpanded()
                await this.fetchTemplateDrift()

            } catch (error) {
                this.$q.loading.hide()
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error creating dump',
                    position: 'top'
                })
                console.error('Error creating new dump:', error)
            } finally {
                this.activeOperation = ''
                this.$q.loading.hide()
            }
        },
        showIssueDetails(issue, node) {

            this.issueListBeforeDetails = null
            this.selectedIssues = Array.isArray(issue) ? issue : [issue]
            this.selectedNode = node;
            this.selectedIssueDbName = this.getDbNameFromNode(node)
            this.issueDialog = true
        },
        showSingleIssue(issue, dbName) {
            // Remember the list so the details view can go back to it
            if (this.selectedIssues.length > 1) this.issueListBeforeDetails = this.selectedIssues
            this.selectedIssues = [issue]
            this.selectedIssueDbName = dbName || this.getDbNameFromNode(this.selectedNode)
            this.issueDialog = true
        },
        // Fixes only the issue currently shown in the single-issue view, rather
        // than everything under the node the dialog was opened from.
        async fixSingleIssue() {
            const issue = this.selectedIssues[0]
            if (!issue) return
            if (!this.selectedIssueDbName) {
                // Without the database the synthetic node id below would be
                // parsed as one, so refuse rather than apply to the wrong db.
                console.error('No database known for issue', issue)
                this.$q.notify({
                    type: 'negative',
                    message: 'Could not determine which database this issue belongs to',
                    position: 'top',
                })
                return
            }
            await this.fixNodeIssues({
                type: 'issue',
                id: 'single-issue',
                dbName: this.selectedIssueDbName,
                issueData: issue,
            })
        },
        async confirmChanges(message) {
            return new Promise(resolve => {
                this.$q.dialog({ title: 'Apply template changes?', message, cancel: true, persistent: true, ok: { label: 'Apply changes', color: 'primary' } })
                    .onOk(() => resolve(true)).onCancel(() => resolve(false)).onDismiss(() => resolve(false))
            })
        },
        async fixNodeIssues(node) {
            if (!node || !this.canApply) return false
            this.activeOperation = 'apply'
            this.isNodeFixing = { ...this.isNodeFixing, [node.id]: true }
            try {
                const issues = node.issueData ? (Array.isArray(node.issueData) ? node.issueData : [node.issueData]) : await this.collectIssuesForNode(node)
                const dbName = this.getDbNameFromNode(node)
                if (!dbName || !issues.length) return false
                if (!await this.confirmChanges('Apply ' + issues.length + ' change(s) to ' + dbName + ' on ' + this.host + ':' + this.port + '? Extra objects are removed; column changes may affect stored data.')) return false
                const response = await this.$api.post('/api/apply', {
                    config: { ...this.connectionConfig }, database: dbName, diffs: issues,
                })
                await this.refreshKeepingExpanded()
                const remaining = new Set((this.rawDifferences[dbName] || []).map(issue => JSON.stringify(issue)))
                this.afterIssuesResolved(issues.filter(issue => !remaining.has(JSON.stringify(issue))))
                const warnings = response.data.warnings || []
                this.$q.notify({
                    type: warnings.length ? 'warning' : 'positive',
                    message: response.data.message || 'Changes applied. Comparison refreshed.',
                    position: 'top', timeout: warnings.length ? 10000 : 5000,
                })
                return true
            } catch (error) {
                this.$q.notify({ type: 'negative', message: error.response?.data?.message || error.message || 'Could not apply changes.', position: 'top', timeout: 10000 })
                // A failed batch may have applied some changes; always re-read the database.
                await this.refreshKeepingExpanded().catch(() => {})
                return false
            } finally {
                this.activeOperation = ''
                this.isNodeFixing = { ...this.isNodeFixing, [node.id]: false }
            }
        },
        // Tables whose .sql file disagrees with the JSON createSQL; reads only the template
        async fetchTemplateDrift() {
            try {
                const response = await this.$api.post('/api/templateDrift', { config: { output: this.dbFolder } })
                this.templateDrift = Array.isArray(response.data) ? response.data : []
            } catch (error) {
                console.error('Error checking the template for .sql files that differ:', error)
                this.templateDrift = []
            }
        },
        reviewDrift(drift) {
            this.selectedDrift = drift
            this.driftDialog = true
        },
        async resolveDrift(keep) {
            if (this.busy) return
            this.activeOperation = 'template'
            const { database, table } = this.selectedDrift
            this.resolvingDrift = keep
            try {
                const response = await this.$api.post('/api/resolveTemplateDrift', {
                    config: { output: this.dbFolder },
                    database,
                    table,
                    keep,
                })
                this.$q.notify({ type: 'positive', message: response.data.message, position: 'top' })
                this.driftDialog = false
                await this.fetchTemplateDrift()
                // Keeping the .sql file changes the JSON, which is what comparing uses
                if (keep === 'sql') await this.refreshKeepingExpanded({ reloadTemplate: true })
            } catch (error) {
                this.$q.notify({
                    type: 'negative',
                    message: error.response?.data?.message || 'Error updating the template',
                    position: 'top',
                })
            } finally {
                this.resolvingDrift = null
                this.activeOperation = ''
            }
        },
        // Shown next to the differences; a failure just leaves the versions out
        async fetchVersions() {
            try {
                const response = await this.$api.post('/api/versions', {
                    config: { ...this.connectionConfig },
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
            if (this.busy) return
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
            if (this.busy) return
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
            if (issue.constraintName || issue.constraint?.Name) return issue.constraintName || issue.constraint.Name
            if (issue.indexName || issue.index?.Name) return issue.indexName || issue.index.Name
            if (issue.trigger?.Name) return issue.trigger.Name
            if (issue.key) return Object.entries(issue.key).map(([k, v]) => `${k} = ${v}`).join(', ')
            return issue.viewName || issue.Name || issue.database || ''
        },
        issueNameLabel(issue) {
            const kind = issue?.type?.split('_').slice(1).join('_')
            return { field: 'Column', index: 'Index', trigger: 'Trigger', procedure: 'Procedure', view: 'View', row: 'Row', database: 'Database', constraint: 'Foreign key', table_options: 'Table options' }[kind] || 'Name'
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
                mismatched_index: [issue?.currentIndex, issue?.index],
                missing_constraint: [undefined, issue?.constraint],
                extra_constraint: [issue?.constraint, undefined],
                mismatched_constraint: [issue?.currentConstraint, issue?.constraint],
                mismatched_table_options: [issue?.currentOptions, issue?.options],
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
            if (typeof value === 'object') return JSON.stringify(value)
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
            return !!issue && !['missing_database', 'missing_row', 'missing_constraint', 'mismatched_constraint', 'extra_constraint', 'mismatched_table_options'].includes(issue.type)
        },
        // The opposite of fixNodeIssues: change the template to match the database
        async keepCurrentInTemplate(node, loadingKey = node?.id) {
            if (!node || !this.canApply) return
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

            if (!this.canApply) return
            this.activeOperation = 'keep-current'
            this.isNodeKeeping = { ...this.isNodeKeeping, [loadingKey]: true }
            try {
                await this.$api.post('/api/acceptCurrent', {
                    config: { ...this.connectionConfig },
                    database: node.dbName || this.getDbNameFromNode(node),
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
                try { await this.refreshKeepingExpanded({ reloadTemplate: true }) } catch { /* Comparison error is shown in the workspace. */ }
                this.activeOperation = ''
            }
        },
        getDbNameFromNode(node) {
            return databaseForNode(node || this.selectedNode, [...new Set([...Object.keys(this.existingDatabases), ...Object.keys(this.differences)])])
        },
        async collectIssuesForNode(node) {
            const issues = []

            switch (node.type) {
                case 'database':
                    //collect issues from the differences for the selected db

                    issues.push(...(this.differences[this.getDbNameFromNode(node)] || []))
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

                        let type = node.id.slice(selectedDbName.length + 1)
                      const dbDifferences = this.differences[selectedDbName] || []

                      if(type === 'tables'){


                          issues.push(...dbDifferences.filter(diff => diff.type.includes('table') || diff.tableName))
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
            this.settingsDraft.output = path
        },
        async fixAllIssues() {
            if (!this.canApply || !this.totalIssueCount) return
            this.isFixingAll = true
            let dialog
            try {
                if (!await this.confirmChanges('Apply all ' + this.totalIssueCount + ' visible change(s) to ' + this.host + ':' + this.port + '? Ignored items are excluded. Extra objects are removed; column changes may affect stored data.')) return
                dialog = this.$q.dialog({ title: 'Applying template', message: 'Preparing changes…', progress: true, persistent: true, ok: false })
                const warnings = []
                for (let pass = 1; pass <= 6 && this.totalIssueCount > 0; pass++) {
                    const before = JSON.stringify(this.differences)
                    dialog.update({ message: 'Pass ' + pass + ' of 6. Applying ' + this.totalIssueCount + ' changes across the selected databases.' })
                    try {
                        const response = await this.$api.post('/api/applyAll', { config: { ...this.connectionConfig }, differences: this.differences })
                        warnings.push(...(response.data.warnings || []))
                    } catch (error) {
                        this.$q.notify({ type: 'negative', message: error.response?.data?.message || error.message || 'Could not apply changes.', timeout: 10000 })
                        await this.refreshKeepingExpanded().catch(() => {})
                        return
                    }
                    await this.refreshKeepingExpanded()
                    this.issueDialog = false
                    if (this.comparisonState !== 'ready' || before === JSON.stringify(this.differences)) break
                }
                this.$q.notify({
                    type: this.comparisonState === 'ready' && !this.totalIssueCount && !warnings.length ? 'positive' : 'warning',
                    message: this.comparisonState !== 'ready' ? 'Changes stopped because comparison failed.' : this.totalIssueCount ? this.totalIssueCount + ' differences remain. Review the findings before applying again.' : warnings.length ? 'Changes applied with ' + warnings.length + ' compatibility warning(s).' : 'Database matches the template for all non-ignored objects.',
                    caption: warnings.map(warning => warning.message).join('; '),
                    timeout: 10000,
                })
            } catch (error) {
                this.$q.notify({ type: 'negative', message: error.response?.data?.message || error.message, timeout: 10000 })
            } finally {
                dialog?.hide()
                this.isFixingAll = false
            }
        },
    },
    mounted() {
        const config = loadConnection(localStorage)
        if (config) {
            this.settingsDraft = config
            this.settingsDialog = true
        }
    },
}
</script>

<style lang="scss">
.sync-workspace { max-width: 1440px; margin: 0 auto; padding: 28px 32px 48px; }
.workspace-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.workspace-brand { display: flex; align-items: center; gap: 14px; color: #14545b; }
.workspace-brand h1 { font-size: 27px; line-height: 1.25; letter-spacing: -.7px; font-weight: 650; margin: 0; }
.workspace-brand p { color: #617179; font-size: 14px; margin: 5px 0 0; }
.connection-strip { background: #eaf0f2; border-radius: 6px; padding: 13px 16px; margin-bottom: 22px; display: grid; gap: 8px; }
.connection-strip > div { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.template-path { color: #4c606a; font-size: 13px; overflow-wrap: anywhere; }
.template-path span { min-width: 0; }
.workspace-welcome { background: #eaf4f3; color: #254d52; border: 1px solid #c9dfdc; border-radius: 6px; }
.workspace-tabs { border-bottom: 1px solid #ced9dd; margin-bottom: 22px; }
.workspace-actions { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin: 0 0 22px; }
.comparison-status { display: flex; align-items: center; gap: 12px; }
.schema-card { border-color: #ced9dd; border-radius: 8px; }
.schema-card-heading { background: #f3f7f8; border-bottom: 1px solid #dce4e7; color: #203b47; }
.schema-card-heading > .row > .row { min-width: 0; max-width: 100%; }
.schema-card-heading .q-chip { max-width: 100%; height: auto; min-height: 24px; }
.schema-card-heading .q-chip__content { white-space: normal; overflow-wrap: anywhere; }
.database-tree .q-tree__node-header { padding: 8px; border-radius: 4px; }
.database-tree .q-tree__node-header:hover { background: #edf4f4; }
.database-tree .q-tree__node--child { padding-left: 20px; }
.database-tree .q-icon { font-size: 20px; }
.settings-card { width: 900px; max-width: 95vw; }
.review-dialog { width: 1100px; max-width: 95vw; }
.sql-code { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 50vh; overflow-y: auto; }
.flex-grow-1 { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.q-btn { border-radius: 5px; }
.q-btn:focus-visible, button:focus-visible { outline: 2px solid #176b74; outline-offset: 3px; }
@media (max-width: 700px) {
    .sync-workspace { padding: 18px 12px 32px; }
    .workspace-header, .workspace-actions { align-items: flex-start; flex-direction: column; }
    .workspace-brand h1 { font-size: 24px; }
    .schema-card-heading > .row { gap: 8px; }
    .schema-card-heading .q-chip { margin-left: 0; }
    .database-tree .q-tree__node--child { padding-left: 10px; }
}
</style>

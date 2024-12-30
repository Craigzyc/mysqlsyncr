<template>
  <q-page>
    <div class="q-mb-md">
      <q-btn @click="openSettings" label="Settings" color="primary" />
      <q-btn
        @click="Object.keys(existingDatabases).length === 0 ? createNewDump() : refreshDifferences"
        :label="Object.keys(existingDatabases).length === 0 ? 'Get New Dump' : 'Refresh Dump'"
        color="secondary"
      />
    </div>

    <q-card v-if="!isDbSetup" class="q-mb-md">
      <q-card-section>
        <div class="text-h6">Database Not Set Up</div>
        <div>Please configure your database settings.</div>
        <q-btn @click="openSettings" label="Open Settings" color="primary" />
      </q-card-section>
    </q-card>

    <q-card v-if="isDbSetup" class="q-mb-md">
      <q-card-section>
        <div class="text-h6">Database Differences</div>
        <q-table :rows="differences" :columns="columns" />
        <q-btn @click="refreshDifferences" label="Refresh Differences" color="secondary" />
      </q-card-section>
    </q-card>

    <q-card v-if="Object.keys(existingDatabases).length > 0" class="q-mb-md">
      <q-card-section>
        <div class="text-h6">Database Structure</div>
        <q-tree
          :nodes="databaseTree"
          node-key="id"
          v-model:expanded="expandedNodes"
        >
          <template v-slot:default-header="prop">
            <div class="row items-center">
              <div>{{ prop.node.label }}</div>
              <q-badge v-if="prop.node.type" color="primary" class="q-ml-sm">
                {{ prop.node.type }}
              </q-badge>
            </div>
          </template>
        </q-tree>
      </q-card-section>
    </q-card>

    <q-dialog v-model="settingsDialog" persistent>
      <q-card>
        <q-card-section>
          <div class="text-h6">Database Settings</div>
          <q-input v-model="host" label="Database Host" required />
          <q-input v-model="port" label="Database Port" type="number" required />
          <q-input v-model="user" label="Database User" required />
          <q-input
            v-model="password"
            label="Database Password"
            type="password"
            required
            autocomplete="off"
          />
          <q-input v-model="database" label="Database Name" required />
          <q-input v-model="dbFolder" label="Database Folder" required />
        </q-card-section>
        <q-card-actions>
          <q-btn @click="saveSettings" label="Save" color="primary" />
          <q-btn @click="closeSettings" label="Cancel" color="secondary" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script>
import axios from 'axios'

export default {
  data() {
    return {
      isDbSetup: false,
      differences: [],
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
      this.refreshDifferences()
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
    buildDatabaseTree() {
      this.databaseTree = Object.entries(this.existingDatabases).map(([dbName, db]) => ({
        id: `db-${dbName}`,
        label: dbName,
        type: 'database',
        children: [
          // Tables section
          {
            id: `${dbName}-tables`,
            label: 'Tables',
            type: 'category',
            children: Object.entries(db.tables).map(([tableName, table]) => ({
              id: `${dbName}-table-${tableName}`,
              label: tableName,
              type: 'table',
              children: [
                // Columns subsection
                {
                  id: `${dbName}-table-${tableName}-columns`,
                  label: 'Columns',
                  type: 'subcategory',
                  children: table.columns.map(column => ({
                    id: `${dbName}-table-${tableName}-column-${column.Field}`,
                    label: `${column.Field} (${column.Type})${column.NotNull ? ' NOT NULL' : ''}${column.AutoIncrement ? ' AUTO_INCREMENT' : ''}`,
                    type: 'column',
                    noChildren: true
                  }))
                },
                // Indexes subsection (if present)
                table.indexes && table.indexes.length > 0 && {
                  id: `${dbName}-table-${tableName}-indexes`,
                  label: 'Indexes',
                  type: 'subcategory',
                  children: table.indexes.map(index => ({
                    id: `${dbName}-table-${tableName}-index-${index.Name}`,
                    label: `${index.Name}${index.Primary ? ' (Primary)' : ''}${index.Unique ? ' (Unique)' : ''}`,
                    type: 'index',
                    noChildren: true
                  }))
                },
                // Triggers subsection (if present)
                table.triggers && table.triggers.length > 0 && {
                  id: `${dbName}-table-${tableName}-triggers`,
                  label: 'Triggers',
                  type: 'subcategory',
                  children: table.triggers.map(trigger => ({
                    id: `${dbName}-table-${tableName}-trigger-${trigger.name}`,
                    label: trigger.name,
                    type: 'trigger',
                    noChildren: true
                  }))
                }
              ].filter(Boolean)
            }))
          },
          // Procedures section (if present)
          db.procedures && db.procedures.length > 0 && {
            id: `${dbName}-procedures`,
            label: 'Procedures',
            type: 'category',
            children: db.procedures.map(proc => ({
              id: `${dbName}-proc-${proc.Name}`,
              label: proc.Name,
              type: 'procedure',
              noChildren: true
            }))
          }
        ].filter(Boolean)
      }))

      // Only expand the first level (databases)
      this.expandedNodes = this.databaseTree.map(node => node.id)
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
    async createNewDump() {
      console.log('Creating a new dump...')
      let response = await axios.post('http://localhost:3000/api/dump', {
        config: {
          host: this.host,
          port: this.port,
          user: this.user,
          password: this.password,
          output: this.dbFolder,
          database: this.database,
        },
      }).catch((error) => {
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

      if (response.data && typeof response.data === 'object' && Object.keys(response.data).length > 0) {
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

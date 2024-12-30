<template>
  <q-page>
    <q-btn @click="compareDatabases" label="Compare Databases" color="primary" />
    <q-table v-if="differences.length" :rows="differences" :columns="columns" />
    <q-spinner v-if="loading" />
    <div v-if="message">{{ message }}</div>
  </q-page>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return {
      loading: false,
      message: '',
      differences: [],
      columns: [
        { name: 'table', label: 'Table', align: 'left', field: 'table' },
        { name: 'difference', label: 'Difference', align: 'left', field: 'difference' },
        { name: 'action', label: 'Action', align: 'center', field: 'action', sortable: false },
      ],
    };
  },
  methods: {
    async compareDatabases() {
      this.loading = true;
      try {
        const response = await axios.post('http://localhost:3000/api/compare', {
          config: {
            host: this.$store.state.db.host,
            port: this.$store.state.db.port,
            user: this.$store.state.db.user,
            password: this.$store.state.db.password,
          },
          database: this.$store.state.db.database,
          output: 'outputDir', // Specify output directory
        });
        this.differences = response.data.map(diff => ({
          table: diff.table,
          difference: diff.difference,
          action: 'Apply', // Placeholder for action
        }));
      } catch (error) {
        this.message = error.response.data.message;
      } finally {
        this.loading = false;
      }
    },
    applyDifference(difference) {
      // Logic to apply the individual difference
      console.log('Applying difference:', difference);
    },
  },
};
</script>

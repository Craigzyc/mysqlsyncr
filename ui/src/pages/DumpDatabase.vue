<template>
  <q-page>
    <q-btn @click="dumpDatabase" label="Dump Database" color="primary" />
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
    };
  },
  methods: {
    async dumpDatabase() {
      this.loading = true;
      try {
        const response = await axios.post('http://localhost:3000/api/dump', {
          config: {
            host: this.$store.state.db.host,
            port: this.$store.state.db.port,
            user: this.$store.state.db.user,
            password: this.$store.state.db.password,
          },
          database: this.$store.state.db.database,
        });
        this.message = response.data.message;
      } catch (error) {
        this.message = error.response.data.message;
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

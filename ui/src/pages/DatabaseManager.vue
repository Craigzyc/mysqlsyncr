<template>
  <q-page>
    <q-form @submit.prevent="connectToDatabase">
      <q-input v-model="host" label="Database Host" required />
      <q-input v-model="port" label="Database Port" type="number" required />
      <q-input v-model="user" label="Database User" required />
      <q-input v-model="password" label="Database Password" type="password" required />
      <q-input v-model="database" label="Database Name" required />
      <q-btn type="submit" label="Connect" color="primary" />
    </q-form>

    <q-btn @click="goToDump" label="Dump Database" color="secondary" />
    <q-btn @click="goToCompare" label="Compare Database" color="secondary" />
  </q-page>
</template>

<script>
export default {
  data() {
    return {
      host: '',
      port: 3306,
      user: '',
      password: '',
      database: '',
    };
  },
  methods: {
    connectToDatabase() {
      // Logic to connect to the database using the provided credentials
      console.log('Connecting to database:', this.host, this.port, this.user, this.password, this.database);
      // Emit connection details to the socket server if needed
    },
    goToDump() {
      this.$router.push('/dump');
    },
    goToCompare() {
      this.$router.push('/compare');
    },
  },
};
</script>

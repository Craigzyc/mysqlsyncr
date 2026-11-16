import { defineBoot } from '#q-app/wrappers'
import axios from 'axios'

// Same origin in both modes: the API only accepts requests from its own origin,
// so `quasar dev` reaches it through the devServer proxy in quasar.config.js.
const api = axios.create({ baseURL: '/' })

export default defineBoot(({ app }) => {
  // for use inside Vue files through this.$axios and this.$api
  app.config.globalProperties.$axios = axios
  app.config.globalProperties.$api = api
})

export { api }

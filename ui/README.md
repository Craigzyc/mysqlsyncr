# MySQLsyncr (mysqlsyncr)

A simple ui for the sync features in mysqlsyncr

## Requirements

Building or running the UI in development mode needs **Node.js 22.22.0 or later** (or 24, 26, 28, 30). The Quasar CLI (`@quasar/app-vite`) checks this itself and stops with "INCOMPATIBLE NODE VERSION" on anything older, even though its `package.json` accepts any Node 22.

```bash
node -v          # check
nvm install 22   # then nvm use 22, if you use nvm
```

This only applies to building. `mysqlsyncr ui` serves the prebuilt files in `dist/spa`, and installing or running mysqlsyncr doesn't need these packages or this Node version.

## Install the dependencies
```bash
yarn
# or
npm install
```

### Start the app in development mode (hot-code reloading, error reporting, etc.)
```bash
quasar dev
```


### Lint the files
```bash
yarn lint
# or
npm run lint
```


### Format the files
```bash
yarn format
# or
npm run format
```


### Build the app for production
```bash
npm run build
# or
quasar build
```

This writes the UI to `dist/spa`, which is what `mysqlsyncr ui` serves and what gets published. It's committed to the repository, so rebuild and commit it after changing anything in `src/`; otherwise the served UI won't include the change.

### Customize the configuration
See [Configuring quasar.config.js](https://v2.quasar.dev/quasar-cli-vite/quasar-config-js).

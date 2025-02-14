# MySQLSyncr

Warning: Please be careful when using this tool. It is still in development and may not be fully stable. Test on a development database before using on production.

MySQLSyncr is a command-line tool for managing and comparing MySQL database structures with JSON dumps. It allows users to dump the database structure, compare it with existing JSON files, and update the database based on those JSON definitions.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
  - [Global Installation](#global-installation)
  - [Local Installation](#local-installation)
- [Usage](#usage)
  - [Commands](#commands)
  - [Configuration Options](#configuration-options)
- [Using MySQLSyncr as a Module](#using-mysqlsyncr-as-a-module)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Dump**: Export the database structure to JSON files.
- **Compare**: Compare the current database structure with JSON dumps to identify differences.
- **Update**: Update the database structure based on the provided JSON definitions.
- **UI**: Open a web-based database browser interface.
- **Verbose Logging**: Enable detailed logging for debugging purposes.

![Database Browser Interface](view.png)

## Installation

### Global Installation

To install MySQLSync globally, allowing you to use it from the command line, run the following command:

```bash
npm install -g mysqlsyncr
```

This will allow you to run the command as `mysqlsyncr` from anywhere in your terminal.

### Local Installation

If you prefer to use MySQLSyncr locally within a project, you can install it as a dependency:

```bash
npm install mysqlsyncr
```

This will add MySQLSyncr to your project's `node_modules` and allow you to use it within your project.

## Usage

You can run MySQLSync commands using the following syntax:

```bash
mysqlsyncr <command> [options]
```

### Commands

- `dump`: Dumps the database structure to files.
- `compare`: Compares the database structure with JSON dumps (dry run).
- `update`: Updates the database structure based on JSON dumps.
- `ui`: Opens a web-based database browser in your default system browser.

### Configuration Options

You can configure the following options when running the commands:

| Option      | Alias | Description                                                                 | Default Value                  |
|-------------|-------|-----------------------------------------------------------------------------|--------------------------------|
| `uiPort`    | `-U`  | UI port                                                                     | `3600`                         |
| `openUI`    | `-O`  | Open UI in default browser (boolean)                                      | `true`                         |
| `host`      | `-h`  | Database host                                                              | `localhost`                   |
| `port`      | `-P`  | Database port                                                              | `3306`                         |
| `user`      | `-u`  | Database user                                                              | `root`                         |
| `password`  | `-p`  | Database password (required)                                              |                                |
| `database`  | `-d`  | Target database                                                            | `null`                        |
| `output`    | `-o`  | Output directory for dumping. Default is one level up from the current directory in a new folder called `db-dump` | `../db-dump`                  |
| `verbose`   | `-v`  | Enable verbose logging (boolean)                                          | `false`                       |

### Example Usage

1. **Dump the database structure**:
   ```bash
   mysqlsyncr dump --host localhost --user root --password yourpassword
   ```

2. **Compare the database structure with JSON dumps**:
   ```bash
   mysqlsyncr compare --host localhost --user root --password yourpassword
   ```

3. **Update the database structure based on JSON dumps**:
   ```bash
   mysqlsyncr update --host localhost --user root --password yourpassword
   ```

4. **Open the database browser interface**:
   ```bash
   mysqlsyncr ui --host localhost --user root --password yourpassword
   ```

## Using MySQLSync as a Module

If you want to use MySQLSync as a module in your own Node.js application, you can require it in your code:

```javascript
import mysqlsyncr from 'mysqlsyncr';

// Example usage
const config = {
    host: 'localhost',
    user: 'root',
    password: 'yourpassword',
    database: 'yourdatabase'
};
```

```javascript
// app.js
import mysqlsyncr from 'mysqlsyncr';
import fs from 'fs';
import path from 'path';

// Database configuration
const config = {
    host: 'localhost',
    user: 'root',
    password: 'yourpassword',
    database: 'yourdatabase'
};

// Function to dump the database structure
async function dumpDatabase() {
    try {
        console.log('Dumping the database structure...');
        await mysqlsyncr.dump(config);
        console.log('Database structure dumped successfully.');
    } catch (error) {
        console.error('Error dumping database:', error.message);
    }
}

// Function to compare the database structure with JSON dumps
async function compareDatabase() {
    try {
        const inputDir = path.join(__dirname, 'db-dump'); // Directory where JSON dumps are stored
        console.log('Comparing the database structure with JSON dumps...');
        const differences = await mysqlsyncr.compare(config, inputDir);
        
        if (differences.length > 0) {
            console.log('Differences found:');
            console.log(differences);
        } else {
            console.log('No differences found. The database structure matches the JSON dumps.');
        }
    } catch (error) {
        console.error('Error comparing database:', error.message);
    }
}

// Main function to execute dump and compare
(async () => {
    await dumpDatabase();
    await compareDatabase();
})();
```

Make sure to check the source code for available functions and their usage.

## Contributing

Contributions are welcome! If you would like to contribute to MySQLSyncr, please follow these steps:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them with clear messages.
4. Push your changes to your forked repository.
5. Open a pull request to the main repository.


## License

This project is licensed under the ISC License. See the [LICENSE](LICENSE) file for more details.
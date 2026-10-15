import { parseCreateTableSQL, parseColumnDefinition } from '../src/parsers';
import { findDifferences } from '../src/differences';
import { applyDifferences, columnDefinition } from '../src/apply';

// A one-table structure the way getDatabaseStructure returns it
const liveStructure = (createSQL) => {
    const parsed = parseCreateTableSQL(createSQL);
    return {
        tables: { [parsed.name]: { columns: parsed.columns, indexes: parsed.indexes, constraints: parsed.constraints, triggers: [], createSQL } },
        procedures: []
    };
};

// A one-table template: hand-written JSON columns/indexes alongside its createSQL
const templateStructure = (createSQL, columns, indexes) => ({
    tables: { [parseCreateTableSQL(createSQL).name]: { columns, indexes, triggers: [], createSQL } },
    procedures: []
});

// Records every statement instead of running it; statements matching failOn throw
const mockConnection = (failOn = []) => {
    const statements = [];
    return {
        statements,
        query: async (sql) => {
            if (sql.startsWith('USE') || sql.startsWith('SELECT VERSION')) return [];
            if (sql.startsWith('SHOW COLUMNS')) return [{ Field: 'alarmString' }];
            statements.push(sql);
            const failure = failOn.find(f => sql.includes(f));
            if (failure) throw new Error(`failed on ${failure}`);
            return [];
        }
    };
};

describe('parseColumnDefinition', () => {
    test('reads DEFAULT after COLLATE', () => {
        expect(parseColumnDefinition('`IID` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,')).toEqual({
            Field: 'IID', Type: 'varchar(25)', Collate: 'utf8mb4_unicode_ci', Default: 'NULL'
        });
    });

    test('reads DEFAULT after a two-parameter type', () => {
        expect(parseColumnDefinition('`currentValue` float(10,2) DEFAULT NULL,')).toEqual({
            Field: 'currentValue', Type: 'float(10,2)', Default: 'NULL'
        });
    });

    test('keeps enum values in the type', () => {
        expect(parseColumnDefinition("`changeType` enum('INSERT','UPDATE','DELETE') NOT NULL,")).toEqual({
            Field: 'changeType', Type: "enum('INSERT','UPDATE','DELETE')", NotNull: true
        });
    });

    test('keeps spaces and escaped quotes in a quoted default', () => {
        expect(parseColumnDefinition("`modifiedBy` varchar(32) NOT NULL DEFAULT 'System Generated',").Default).toBe('System Generated');
        expect(parseColumnDefinition("`note` varchar(32) DEFAULT 'it''s, ok',").Default).toBe("it's, ok");
    });

    test('ignores keywords inside a comment', () => {
        expect(parseColumnDefinition("`notes` text COMMENT 'NOT NULL DEFAULT x, ON UPDATE CURRENT_TIMESTAMP',")).toEqual({
            Field: 'notes', Type: 'text', Comment: 'NOT NULL DEFAULT x, ON UPDATE CURRENT_TIMESTAMP'
        });
    });

    test('reads ON UPDATE', () => {
        expect(parseColumnDefinition('`dateUpdated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,')).toEqual({
            Field: 'dateUpdated', Type: 'timestamp', NotNull: true, Default: 'CURRENT_TIMESTAMP', OnUpdate: 'CURRENT_TIMESTAMP'
        });
    });

    test('returns null for index lines', () => {
        expect(parseColumnDefinition('KEY `idx_IID` (`IID`,`point`),')).toBeNull();
        expect(parseColumnDefinition('PRIMARY KEY (`alarmID`),')).toBeNull();
    });
});

describe('findDifferences on tables already matching the template', () => {
    test('columns with COLLATE before DEFAULT', () => {
        const createSQL = `CREATE TABLE \`E2Alarms\` (
  \`alarmID\` bigint NOT NULL,
  \`IID\` varchar(25) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (\`alarmID\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
        const template = templateStructure(createSQL + ';', [
            { Field: 'alarmID', Type: 'bigint', NotNull: true },
            { Field: 'IID', Type: 'varchar(25)', Default: 'NULL' }
        ], [{ ColumnName: ['alarmID'], Primary: true, Name: 'PRIMARY' }]);
        expect(findDifferences(template, liveStructure(createSQL))).toEqual([]);
    });

    test('enum type, quoted default with a space, and indexes with "Unique": false', () => {
        const createSQL = `CREATE TABLE \`SystemCodesHistory\` (
  \`idSystemCodesHistory\` int NOT NULL AUTO_INCREMENT,
  \`assetID\` int NOT NULL,
  \`changeType\` enum('INSERT','UPDATE','DELETE') NOT NULL,
  \`modifiedBy\` varchar(32) NOT NULL DEFAULT 'System Generated',
  PRIMARY KEY (\`idSystemCodesHistory\`),
  KEY \`idx_systemcodeshistory_assetID\` (\`assetID\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const template = templateStructure(createSQL + ';', [
            { Field: 'idSystemCodesHistory', Type: 'int', NotNull: true, AutoIncrement: true },
            { Field: 'assetID', Type: 'int', NotNull: true },
            { Field: 'changeType', Type: "enum('INSERT','UPDATE','DELETE')", NotNull: true },
            { Field: 'modifiedBy', Type: 'varchar(32)', NotNull: true, Default: 'System Generated' }
        ], [
            { ColumnName: ['idSystemCodesHistory'], Unique: false, Name: 'PRIMARY' },
            { ColumnName: ['assetID'], Unique: false, Name: 'idx_systemcodeshistory_assetID' }
        ]);
        expect(findDifferences(template, liveStructure(createSQL))).toEqual([]);
    });

    test('nullable columns with and without an explicit DEFAULT NULL', () => {
        // MySQL never prints DEFAULT NULL for TEXT columns
        const createSQL = `CREATE TABLE \`data_alarms\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`confirm_notes\` text COMMENT 'optional notes',
  \`notificationStartTime\` time DEFAULT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const template = templateStructure(createSQL + ';', [
            { Field: 'id', Type: 'int', NotNull: true, AutoIncrement: true },
            { Field: 'confirm_notes', Type: 'text', Default: 'NULL' },
            { Field: 'notificationStartTime', Type: 'time', NotNull: false }
        ], [{ ColumnName: ['id'], Primary: true, Name: 'PRIMARY' }]);
        expect(findDifferences(template, liveStructure(createSQL))).toEqual([]);
    });

    test('prefix index recorded without its length in the JSON', () => {
        const createSQL = `CREATE TABLE \`E2Alarms\` (
  \`alarmID\` bigint NOT NULL,
  \`alarmString\` mediumtext,
  PRIMARY KEY (\`alarmID\`),
  KEY \`idx_e2alarms_alarmstring\` (\`alarmString\`(255))
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const template = templateStructure(createSQL + ';', [
            { Field: 'alarmID', Type: 'bigint', NotNull: true },
            { Field: 'alarmString', Type: 'mediumtext' }
        ], [
            { ColumnName: ['alarmID'], Primary: true, Name: 'PRIMARY' },
            { ColumnName: ['alarmString'], Name: 'idx_e2alarms_alarmstring' }
        ]);
        expect(findDifferences(template, liveStructure(createSQL))).toEqual([]);
    });
});

describe('findDifferences on tables that differ', () => {
    test('a missing prefix index keeps its length from the createSQL', () => {
        const templateSQL = `CREATE TABLE \`E2Alarms\` (
  \`alarmID\` bigint NOT NULL,
  \`alarmString\` mediumtext,
  PRIMARY KEY (\`alarmID\`),
  KEY \`idx_e2alarms_alarmstring\` (\`alarmString\`(255))
) ENGINE=InnoDB DEFAULT CHARSET=latin1;`;
        const liveSQL = `CREATE TABLE \`E2Alarms\` (
  \`alarmID\` bigint NOT NULL,
  \`alarmString\` mediumtext,
  PRIMARY KEY (\`alarmID\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const template = templateStructure(templateSQL, [
            { Field: 'alarmID', Type: 'bigint', NotNull: true },
            { Field: 'alarmString', Type: 'mediumtext' }
        ], [
            { ColumnName: ['alarmID'], Primary: true, Name: 'PRIMARY' },
            { ColumnName: ['alarmString'], Name: 'idx_e2alarms_alarmstring' }
        ]);
        const diffs = findDifferences(template, liveStructure(liveSQL));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'missing_index', index: { ColumnName: ['alarmString(255)'] } });
    });

    test('a missing column picks up ON UPDATE from the createSQL', () => {
        const templateSQL = `CREATE TABLE \`Alarms_Log\` (
  \`idAlarmLog\` int NOT NULL AUTO_INCREMENT,
  \`dateUpdated\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`idAlarmLog\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const liveSQL = `CREATE TABLE \`Alarms_Log\` (
  \`idAlarmLog\` int NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (\`idAlarmLog\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
        const template = templateStructure(templateSQL, [
            { Field: 'idAlarmLog', Type: 'int', NotNull: true, AutoIncrement: true },
            { Field: 'dateUpdated', Type: 'timestamp', NotNull: true, Default: 'CURRENT_TIMESTAMP' }
        ], [{ ColumnName: ['idAlarmLog'], Primary: true, Name: 'PRIMARY' }]);
        const diffs = findDifferences(template, liveStructure(liveSQL));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'missing_field', field: { Field: 'dateUpdated', OnUpdate: 'CURRENT_TIMESTAMP' } });
    });

    test('detects a nullability change', () => {
        const templateSQL = `CREATE TABLE \`t\` (
  \`a\` int NOT NULL
) ENGINE=InnoDB;`;
        const template = templateStructure(templateSQL, [{ Field: 'a', Type: 'int', NotNull: true }], []);
        const notNullLive = liveStructure(templateSQL.replace(';', ' DEFAULT CHARSET=latin1'));
        expect(findDifferences(template, notNullLive)).toEqual([]);
        const nullableLive = liveStructure(templateSQL.replace('int NOT NULL', 'int DEFAULT NULL'));
        expect(findDifferences(template, nullableLive).map(d => d.info)).toContain('Null');
    });

    test('does not reorder composite index columns', () => {
        const createSQL = `CREATE TABLE \`t\` (
  \`b\` int NOT NULL,
  \`a\` int NOT NULL,
  KEY \`idx_ba\` (\`b\`,\`a\`)
) ENGINE=InnoDB`;
        const template = templateStructure(createSQL, [
            { Field: 'b', Type: 'int', NotNull: true },
            { Field: 'a', Type: 'int', NotNull: true }
        ], [{ ColumnName: ['b', 'a'], Name: 'idx_ba' }]);
        const live = liveStructure(createSQL.replace('`idx_ba`', '`other`'));
        findDifferences(template, live);
        expect(template.tables.t.indexes[0].ColumnName).toEqual(['b', 'a']);
        expect(live.tables.t.indexes[0].ColumnName).toEqual(['b', 'a']);
    });
});

describe('columnDefinition', () => {
    test('NOT NULL without a default gets no DEFAULT NULL', () => {
        expect(columnDefinition({ Field: 'DeviceId', Type: 'varchar(45)', NotNull: true })).toBe('varchar(45) NOT NULL');
    });

    test('nullable timestamp is explicitly NULL', () => {
        expect(columnDefinition({ Field: 'lastValueUpdated', Type: 'timestamp', Default: 'NULL' })).toBe('timestamp NULL DEFAULT NULL');
    });

    test('CURRENT_TIMESTAMP default with ON UPDATE', () => {
        expect(columnDefinition({ Field: 'dateUpdated', Type: 'timestamp', NotNull: true, Default: 'CURRENT_TIMESTAMP', OnUpdate: 'CURRENT_TIMESTAMP' }))
            .toBe('timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    });

    test('quotes string defaults', () => {
        expect(columnDefinition({ Field: 'modifiedBy', Type: 'varchar(32)', NotNull: true, Default: "System's Generated" }))
            .toBe("varchar(32) NOT NULL DEFAULT 'System''s Generated'");
    });

    test('keeps the live collation and comment when the template has none recorded', () => {
        expect(columnDefinition({ Field: 'IID', Type: 'varchar(25)', Default: 'NULL' }, { Field: 'IID', Type: 'varchar(25)', Collate: 'utf8mb4_unicode_ci', Comment: 'note' }))
            .toBe("varchar(25) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL COMMENT 'note'");
    });

    test('a template without ON UPDATE removes it from the live column', () => {
        expect(columnDefinition({ Field: 'd', Type: 'timestamp', Default: 'CURRENT_TIMESTAMP', OnUpdate: null }, { Field: 'd', Type: 'timestamp', OnUpdate: 'CURRENT_TIMESTAMP' }))
            .toBe('timestamp NULL DEFAULT CURRENT_TIMESTAMP');
    });
});

describe('applyDifferences', () => {
    test('generates valid SQL for the store diffs', async () => {
        const connection = mockConnection();
        await applyDifferences(connection, 'Alerts', [
            { type: 'missing_field', tableName: 'Alarms_Log', field: { Field: 'dateUpdated', Type: 'timestamp', NotNull: true, Default: 'CURRENT_TIMESTAMP', OnUpdate: 'CURRENT_TIMESTAMP' } },
            { type: 'mismatched_field', info: 'Type', tableName: 'E2Data', field: { Field: 'DeviceId', Type: 'varchar(45)', NotNull: true }, currentField: { Field: 'DeviceId', Type: 'varchar(75)', NotNull: true } },
            { type: 'missing_index', tableName: 'E2Alarms', indexName: 'idx_e2alarms_alarmstring', index: { ColumnName: ['alarmString(255)'], Name: 'idx_e2alarms_alarmstring' } },
            { type: 'mismatched_index', from: 'primary', tableName: 'SystemCodesHistory', indexName: 'PRIMARY', index: { ColumnName: ['idSystemCodesHistory'], Name: 'PRIMARY' } }
        ]);
        expect(connection.statements).toEqual([
            'ALTER TABLE `Alarms_Log` ADD COLUMN `dateUpdated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;',
            'ALTER TABLE `E2Data` CHANGE `DeviceId` `DeviceId` varchar(45) NOT NULL;',
            'ALTER TABLE `E2Alarms` ADD INDEX `idx_e2alarms_alarmstring` (`alarmString`(255));',
            'ALTER TABLE `SystemCodesHistory` DROP PRIMARY KEY, ADD PRIMARY KEY (`idSystemCodesHistory`);'
        ]);
    });

    test('tries every difference, then throws listing the failures', async () => {
        const connection = mockConnection(['`a`']);
        const diffs = [
            { type: 'missing_field', tableName: 't', field: { Field: 'a', Type: 'int' } },
            { type: 'missing_field', tableName: 't', field: { Field: 'b', Type: 'int' } }
        ];
        await expect(applyDifferences(connection, 'db', diffs)).rejects.toMatchObject({
            errors: [{ difference: 'missing_field t.a', error: 'failed on `a`' }]
        });
        expect(connection.statements).toHaveLength(2);
    });
});

describe('mismatched procedures', () => {
    test('include the database definition alongside the template one', () => {
        const expected = { tables: {}, procedures: [{ Name: 'P', Definition: 'CREATE PROCEDURE `P`() SELECT 1' }] };
        const current = { tables: {}, procedures: [{ Name: 'P', Definition: 'CREATE PROCEDURE `P`() SELECT 2' }] };
        expect(findDifferences(expected, current)).toEqual([{
            type: 'mismatched_procedure',
            Name: 'P',
            Definition: 'CREATE PROCEDURE `P`() SELECT 1',
            currentDefinition: 'CREATE PROCEDURE `P`() SELECT 2'
        }]);
    });
});

describe('templates written by older versions', () => {
    const createSQL = `CREATE TABLE \`SystemCodesHistory\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`changeType\` enum('INSERT','UPDATE','DELETE') NOT NULL,
  \`modifiedBy\` varchar(32) NOT NULL DEFAULT 'System Generated',
  \`recallTime\` decimal(10,2) NOT NULL DEFAULT '60.00',
  \`assetId\` int NOT NULL,
  PRIMARY KEY (\`id\`),
  CONSTRAINT \`fk_asset\` FOREIGN KEY (\`assetId\`) REFERENCES \`Alerts\`.\`Assets\` (\`idAsset\`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1`;
    // What the old parser stored for that createSQL
    const legacyColumns = [
        { Field: 'id', Type: 'int', NotNull: true, AutoIncrement: true },
        { Field: 'changeType', Type: 'enum' },
        { Field: 'modifiedBy', Type: 'varchar(32)', NotNull: true, Default: 'System' },
        { Field: 'recallTime', Type: 'decimal(10,2)' },
        { Field: 'assetId', Type: 'int', NotNull: true },
        { Field: 'fk_asset', Type: 'FOREIGN' }
    ];

    test('show no differences against a database that matches the createSQL', () => {
        const template = templateStructure(createSQL + ';', legacyColumns, [{ ColumnName: ['id'], Primary: true, Name: 'PRIMARY' }]);
        expect(findDifferences(template, liveStructure(createSQL))).toEqual([]);
    });

    test('keep columns that were edited by hand', () => {
        const edited = legacyColumns.map(c => c.Field === 'modifiedBy' ? { ...c, Default: 'Someone Else' } : c);
        const template = templateStructure(createSQL + ';', edited, [{ ColumnName: ['id'], Primary: true, Name: 'PRIMARY' }]);
        const diffs = findDifferences(template, liveStructure(createSQL));
        expect(diffs).toHaveLength(1);
        expect(diffs[0]).toMatchObject({ type: 'mismatched_field', info: 'Default', field: { Field: 'modifiedBy', Default: 'Someone Else' } });
    });
});

describe('columns the old parser lost attributes from', () => {
    test('quoted parts of defaults and generated expressions are kept', () => {
        expect(parseColumnDefinition("`flag` bit(1) NOT NULL DEFAULT b'0',").Default).toBe("b'0'");
        expect(parseColumnDefinition("`tags` json DEFAULT (_utf8mb4'[]'),").Default).toBe("(_utf8mb4'[]')");
        expect(parseColumnDefinition("`c` varchar(20) GENERATED ALWAYS AS (concat(_utf8mb4'a',`b`)) STORED,").Generated).toBe("(concat(_utf8mb4'a',`b`)) STORED");
        expect(parseColumnDefinition("`n` int unsigned NOT NULL DEFAULT '0',").Type).toBe('int unsigned');
    });

    test('column SQL keeps bit literals, unsigned and generated expressions', () => {
        expect(columnDefinition({ Field: 'flag', Type: 'bit(1)', NotNull: true, Default: "b'0'" })).toBe("bit(1) NOT NULL DEFAULT b'0'");
        expect(columnDefinition({ Field: 'n', Type: 'int unsigned', NotNull: true, Default: '0' })).toBe("int unsigned NOT NULL DEFAULT '0'");
        expect(columnDefinition(
            { Field: 'c', Type: 'varchar(20)', Default: 'NULL' },
            { Field: 'c', Type: 'varchar(20)', Generated: "(concat(_utf8mb4'a',`b`)) STORED" }
        )).toBe("varchar(20) GENERATED ALWAYS AS (concat(_utf8mb4'a',`b`)) STORED NULL");
    });

    test('integer display widths from older MySQL versions still match, unsigned included', () => {
        const template = templateStructure('CREATE TABLE `t` (\n  `a` int unsigned NOT NULL\n);', [{ Field: 'a', Type: 'int unsigned', NotNull: true }], []);
        expect(findDifferences(template, liveStructure('CREATE TABLE `t` (\n  `a` int(10) unsigned NOT NULL\n)'))).toEqual([]);
        expect(findDifferences(template, liveStructure('CREATE TABLE `t` (\n  `a` int(10) NOT NULL\n)')).map(d => d.info)).toEqual(['Type']);
    });
});

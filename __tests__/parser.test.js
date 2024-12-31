import { parseCreateTableSQL, parseDatabaseStructure } from '../src/parsers';



describe('Create Table Parser', () => {

    test('should correctly parse a valid create table statement. Check #1', () => {
        const input = `CREATE TABLE \`AlarmRuleHistory\` (
  \`idAlarmHistory\` int(11) NOT NULL AUTO_INCREMENT,
  \`idAsset\` int(11) NOT NULL,
  \`idCaseDX\` int(11) DEFAULT NULL,
  \`idAlertRule\` int(11) DEFAULT NULL,
  \`activeAlarmRule\` smallint(1) NOT NULL DEFAULT '0',
  \`alarmRule_StartDate\` timestamp NULL DEFAULT NULL,
  \`alarmRule_EndDate\` timestamp NULL DEFAULT NULL,
  \`dateCreated\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`dateUpdated\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`lastModifiedBy\` varchar(32) NOT NULL DEFAULT 'System Generated',
  PRIMARY KEY (\`idAlarmHistory\`),
  KEY \`AlertRule_idx\` (\`idAlertRule\`),
  KEY \`CaseDX_idx\` (\`idCaseDX\`),
  KEY \`Asset_idx\` (\`idAsset\`),
  CONSTRAINT \`AlertRule\` FOREIGN KEY (\`idAlertRule\`) REFERENCES \`AlertRules\` (\`idAlertRule\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT \`Asset\` FOREIGN KEY (\`idAsset\`) REFERENCES \`Assets\` (\`idAsset\`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT \`CaseDX\` FOREIGN KEY (\`idCaseDX\`) REFERENCES \`Case_DX\` (\`idCaseDX\`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COMMENT='Keeps track of all active/inactive alarm rules used for the assets.\n';`;

        const expectedOutput = {
            "name": "AlarmRuleHistory",
            "columns": [
              {
                "Field": "idAlarmHistory",
                "Type": "int(11)",
                "NotNull": true,
                "AutoIncrement": true
              },
              {
                "Field": "idAsset",
                "Type": "int(11)",
                "NotNull": true
              },
              {
                "Field": "idCaseDX",
                "Type": "int(11)",
                "Default": "NULL"
              },
              {
                "Field": "idAlertRule",
                "Type": "int(11)",
                "Default": "NULL"
              },
              {
                "Field": "activeAlarmRule",
                "Type": "smallint(1)",
                "NotNull": true,
                "Default": "0"
              },
              {
                "Field": "alarmRule_StartDate",
                "Type": "timestamp",
                "Default": "NULL"
              },
              {
                "Field": "alarmRule_EndDate",
                "Type": "timestamp",
                "Default": "NULL"
              },
              {
                "Field": "dateCreated",
                "Type": "timestamp",
                "NotNull": true,
                "Default": "CURRENT_TIMESTAMP"
              },
              {
                "Field": "dateUpdated",
                "Type": "timestamp",
                "NotNull": true,
                "Default": "CURRENT_TIMESTAMP"
              },
              {
                "Field": "lastModifiedBy",
                "Type": "varchar(32)",
                "NotNull": true,
                "Default": "System"
              }
            ],
            "indexes": [
              {
                "ColumnName": [
                  "idAlarmHistory"
                ],
                "Primary": true,
                "Name": "PRIMARY"
              },
              {
                "ColumnName": [
                  "idAlertRule"
                ],
                "Name": "AlertRule_idx"
              },
              {
                "ColumnName": [
                  "idCaseDX"
                ],
                "Name": "CaseDX_idx"
              },
              {
                "ColumnName": [
                  "idAsset"
                ],
                "Name": "Asset_idx"
              }
            ],
            "constraints": [
              {
                "Name": "AlertRule",
                "Type": "FOREIGN KEY",
                "ColumnName": [
                  "idAlertRule"
                ],
                "References": {
                  "Table": "AlertRules",
                  "Column": "idAlertRule"
                },
                "OnDelete": "NO ACTION",
                "OnUpdate": "NO ACTION"
              },
              {
                "Name": "AlertRule",
                "Type": "FOREIGN KEY",
                "ColumnName": [
                  "idAsset"
                ],
                "References": {
                  "Table": "Assets",
                  "Column": "idAsset"
                },
                "OnDelete": "NO ACTION",
                "OnUpdate": "NO ACTION"
              },
              {
                "Name": "AlertRule",
                "Type": "FOREIGN KEY",
                "ColumnName": [
                  "idCaseDX"
                ],
                "References": {
                  "Table": "Case_DX",
                  "Column": "idCaseDX"
                },
                "OnDelete": "NO ACTION",
                "OnUpdate": "NO ACTION"
              }
            ],
            "engine": "InnoDB",
            "charset": "latin1",
            "collate": null
          }
    
        

        const result = parseCreateTableSQL(input);
        expect(result).toEqual(expectedOutput);
    });


}); 
import { parseCreateTableSQL, parseDatabaseStructure } from '../src/parsers';



describe('Create Table Parser', () => {

    test('should correctly parse a valid create table statement. Check #1', () => {
        const input = `CREATE TABLE \`Alarms\` (
            \`alarmId\` int NOT NULL AUTO_INCREMENT,
            \`alarmRuleId\` int NOT NULL,
            \`alarmStatus\` int NOT NULL,
            \`alarmStatus_Text\` varchar(50) NOT NULL,
            \`alarmCreated_Date\` timestamp NULL DEFAULT NULL,
            \`alarmConfirmed_Date\` timestamp NULL DEFAULT NULL,
            \`alarmRecall_Date\` timestamp NULL DEFAULT NULL,
            \`activeAlarm\` tinyint(1) NOT NULL DEFAULT '0',
            \`emailSent\` tinyint(1) DEFAULT '0',
            \`emailSent_AnswerPlus\` tinyint(1) DEFAULT '0',
            \`ticketEmailSent\` tinyint(1) DEFAULT '0',
            \`type\` varchar(45) DEFAULT NULL,
            \`oorValue\` float(10,2) DEFAULT NULL,
            \`thresholdValue\` float(10,2) DEFAULT NULL,
            \`dateCreated\` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            \`dateUpdated\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`alarmId\`),
            UNIQUE KEY \`UniqueAlarmRules\` (\`alarmRuleId\`),
            KEY \`idx_alarms_alarmruleid_alarmstatus\` (\`alarmRuleId\`, \`alarmStatus\`)
          ) ENGINE=InnoDB AUTO_INCREMENT=117 DEFAULT CHARSET=latin1 COMMENT='Alarm table for alarms '`;
          

        const expectedOutput = {
            "name": "Alarms",
            "columns": [
              {
                "Field": "alarmId",
                "Type": "int",
                "NotNull": true,
                "AutoIncrement": true
              },
              {
                "Field": "alarmRuleId",
                "Type": "int",
                "NotNull": true
              },
              {
                "Field": "alarmStatus",
                "Type": "int",
                "NotNull": true
              },
              {
                "Field": "alarmStatus_Text",
                "Type": "varchar(50)",
                "NotNull": true
              },
              {
                "Field": "alarmCreated_Date",
                "Type": "timestamp",
                "Default": "NULL"
              },
              {
                "Field": "alarmConfirmed_Date",
                "Type": "timestamp",
                "Default": "NULL"
              },
              {
                "Field": "alarmRecall_Date",
                "Type": "timestamp",
                "Default": "NULL"
              },
              {
                "Field": "activeAlarm",
                "Type": "tinyint(1)",
                "NotNull": true,
                "Default": "0"
              },
              {
                "Field": "emailSent",
                "Type": "tinyint(1)",
                "Default": "0"
              },
              {
                "Field": "emailSent_AnswerPlus",
                "Type": "tinyint(1)",
                "Default": "0"
              },
              {
                "Field": "ticketEmailSent",
                "Type": "tinyint(1)",
                "Default": "0"
              },
              {
                "Field": "type",
                "Type": "varchar(45)",
                "Default": "NULL"
              },
              {
                "Field": "oorValue",
                "Type": "float(10,2)"
              },
              {
                "Field": "thresholdValue",
                "Type": "float(10,2)"
              },
              {
                "Field": "dateCreated",
                "Type": "timestamp",
                "Default": "CURRENT_TIMESTAMP"
              },
              {
                "Field": "dateUpdated",
                "Type": "timestamp",
                "NotNull": true,
                "Default": "CURRENT_TIMESTAMP"
              }
            ],
            "indexes": [
              {
                "ColumnName": [
                  "alarmId"
                ],
                "Primary": true,
                "Name": "PRIMARY"
              },
              {
                "ColumnName": [
                  "alarmRuleId"
                ],
                "Unique": true,
                "Name": "UniqueAlarmRules"
              },
              {
                "ColumnName": [
                  "alarmRuleId",
                  "alarmStatus"
                ],
                "Name": "idx_alarms_alarmruleid_alarmstatus"
              }
            ],
            "constraints": [],
            "engine": null,
            "charset": null,
            "collate": null
          }
    
        

        const result = parseCreateTableSQL(input);
        console.log('Result:', JSON.stringify(result, null, 2))
        expect(result).toEqual(expectedOutput);
    });


}); 
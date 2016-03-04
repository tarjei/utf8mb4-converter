// Copyright (c) 2016, David M. Lee, II
import 'babel-polyfill';

import _ from 'lodash';
import _knex from 'knex';
import program from 'commander';
import read from 'read';

const { name, version } = require('../package.json');

const databasesToSkip = [
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
];

program.version(version)
  .option('-h --host [host]', 'MySQL server to connect to [localhost]', 'localhost')
  .option('-u --user [user]', 'User to connect with [root]', 'root')
  .option('-p --password [passwd]', 'Use or prompt for password')
  .option('-v --verbose', 'Log more details')
  .option('   --skip [database]', 'Skip conversion of the database', d => databasesToSkip.push(d))
  .option('   --make-it-so', 'Execute DDL in addition to printing it out')
  .option('   --force-latin1', 'Force conversions of latin1 data');
program.on('--help', () => {
  console.log('The --force-latin1 conversion assumes that only ASCII characters are in latin1');
  console.log('columns. Any international characters in latin1 columns will be corrupted.');
  console.log();
  console.log('If --password is not given, then no password is used.');
  console.log('The --password may option may optionally specify the password, but putting');
  console.log('passwords on the command line are not recommended.');
});
program.parse(process.argv);

function debug(...args) {
  if (program.verbose) {
    function commentOut(arg) {
      return arg.split(/\n/)
        .map((line, index) => index === 0 ? line : `-- ${line}`)
        .join('\n');
    }
    const commented = _.map(args, commentOut);
    commented.unshift('--');
    console.log.apply(null, commented);
  }
}

const CharsetsToConvert = program.forceLatin1 ? ['utf8', 'latin1'] : ['utf8'];

debug('settings', JSON.stringify(_.pick(program, ['host', 'user', 'forceLatin1', 'makeItSo'])));

async function go() {
  if (!_.isUndefined(program.password) && !_.isString(program.password)) {
    program.password = await new Promise((resolve, reject) => {
      read({
        prompt: 'Password:',
        silent: true,
      }, (err, res) => {
        if (err) { return reject(err); }
        resolve(res);
      });
    });
  }

  const knex = _knex({
    client: 'mysql',
    connection: {
      host: program.host,
      user: program.user,
      password: program.password,
      database: 'mysql',
    },
  });

  function alter(ddl) {
    console.log(`${ddl.replace(/\s+/g, ' ').trim()}`);
    if (program.makeItSo) {
      return knex.schema.raw(ddl);
    }
  }

  function select(query) {
    debug(query.toString());
    return query.select();
  }

  let databases = await select(knex('information_schema.SCHEMATA')
    .where('schema_name', 'not in', databasesToSkip)
    .where('default_character_set_name', 'in', CharsetsToConvert)
    .columns('schema_name'));
  databases = _.map(databases, 'schema_name');

  debug('Altering databases', JSON.stringify(databases));
  for (const db of databases) {
    await alter(`
      ALTER DATABASE \`${db}\`
        CHARACTER SET = utf8mb4
        COLLATE = utf8mb4_unicode_ci`);
  }

  const tables = await select(
    knex('information_schema.COLLATION_CHARACTER_SET_APPLICABILITY as CCSA')
      .join('information_schema.TABLES as T', 'CCSA.collation_name', 'T.table_collation')
      .where('T.table_schema', 'not in', databasesToSkip)
      .where('CCSA.character_set_name', 'in', CharsetsToConvert)
      .where('T.table_type', 'BASE TABLE')
      .columns('T.table_schema', 'T.table_name'));
  debug('Altering tables', JSON.stringify(tables));
  for (const table of tables) {
    await alter(`
      ALTER TABLE \`${table.table_schema}\`.\`${table.table_name}\`
        CONVERT TO CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci`);
  }

  const problemColumns = await select(
    knex('information_schema.COLUMNS as C')
      .join('information_schema.STATISTICS as S', {
        'C.table_schema': 'S.table_schema',
        'C.table_name': 'S.table_name',
        'C.column_name': 'S.column_name',
      })
      .where('C.table_schema', 'not in', databasesToSkip)
      .where('C.character_set_name', 'in', CharsetsToConvert)
      .where(function complicated() {
        this
          .whereNull('S.sub_part').where('C.character_maximum_length', '>', 191)
          .orWhere('S.sub_part', '>', 191);
      })
      .orderBy('C.table_schema')
      .orderBy('C.table_name')
      .orderBy('S.index_name')
      .columns('S.index_name', 'S.index_type', 'C.table_schema', 'C.table_name', 'C.column_name',
        'C.data_type', 'C.character_maximum_length', 'S.sub_part'));
  if (!_.isEmpty(problemColumns)) {
    console.error(`ERROR: There are ${problemColumns.length} indexed columns to long to convert`);
    console.error(JSON.stringify(problemColumns, null, 2));
    console.error('Go write some migrations to fix that');
    process.exit(1);
  }

  const columns = await select(
    knex('information_schema.COLUMNS')
      .where('table_schema', 'not in', databasesToSkip)
      .where('character_set_name', 'in', CharsetsToConvert)
      .columns('table_schema', 'table_name', 'column_name', 'column_type'));
  debug('Altering columns', JSON.stringify(columns, null, 2));
  for (const c of columns) {
    await alter(`
      ALTER TABLE \`${c.table_schema}\`.\`${c.table_name}\`
        CHANGE \`${c.column_name}\`
        \`${c.column_name}\` ${c.column_type}
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  }
}

go()
  .then(() => {
    debug('done');
    process.exit(0);
  }, err => {
    console.error(err.stack);
    process.exit(1);
  });

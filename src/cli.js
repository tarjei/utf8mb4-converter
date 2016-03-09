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

const tablesToSkip = [];

const columnsToSkip = [];

const databasesToLimit = [];

function skip(spec) {
  const split = spec.split(/\./);
  if (split.length < 1 || split.length > 3) {
    console.error(`${name}: Invalid --skip ${spec}`);
    process.exit(1);
  }

  const [database, table, column] = split;

  if (column) {
    columnsToSkip.push({ database, table, column });
  } else if (table) {
    tablesToSkip.push({ database, table });
  } else {
    databasesToSkip.push(database);
  }
}

program.version(version)
  .option('-h --host [host]', 'MySQL server to connect to [localhost]', 'localhost')
  .option('-u --user [user]', 'User to connect with [root]', 'root')
  .option('-p --password [passwd]', 'Use or prompt for password')
  .option('-v --verbose', 'Log more details')
  .option('   --skip [database[.table[.column]]]',
    'Skip conversion of the database/table/column', skip)
  .option('   --limit [database]', 'Limit to given database', d => databasesToLimit.push(d))
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

function commentOut(arg) {
  return arg.split(/\n/)
    .map((line, index) => index === 0 ? line : `-- ${line}`)
    .join('\n');
}

function debug(...args) {
  if (program.verbose) {
    const commented = _.map(args, commentOut);
    commented.unshift('--');
    console.log.apply(null, commented);
  }
}

const CharsetsToConvert = program.forceLatin1 ? ['utf8', 'latin1'] : ['utf8'];

debug('settings', JSON.stringify(_.pick(program, ['host', 'user', 'forceLatin1', 'makeItSo'])));

async function go() {
  if (process.env.MYSQL_PWD) {
    program.password = process.env.MYSQL_PWD;
  }
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

  function time(p) {
    const start = process.hrtime();
    const end = () => {
      const diff = process.hrtime(start);
      debug(`${diff[0] * 1000 + diff[1] / 1000000} ms`);
    };
    return p.then(v => {
      end();
      return v;
    }, err => {
      end();
      return Promise.reject(err);
    });
  }

  function alter(ddl) {
    console.log(`${ddl.replace(/\s+/g, ' ').trim()}`);
    if (program.makeItSo) {
      return time(knex.schema.raw(ddl));
    }
  }

  function select(query) {
    debug(query.toString());
    return time(query.select());
  }

  let dbQuery = knex('information_schema.SCHEMATA')
      .where('schema_name', 'not in', databasesToSkip);
  if (!_.isEmpty(databasesToLimit)) {
    dbQuery = dbQuery.where('schema_name', 'in', databasesToLimit);
  }
  let databases = await select(dbQuery
    .where('default_character_set_name', 'in', CharsetsToConvert)
    .columns('schema_name'));
  databases = _.map(databases, 'schema_name');

  debug(`Altering ${databases.length} databases`);
  for (const db of databases) {
    await alter(`
      ALTER DATABASE \`${db}\`
        CHARACTER SET = utf8mb4
        COLLATE = utf8mb4_unicode_ci`);
  }

  let tableQuery = knex('information_schema.COLLATION_CHARACTER_SET_APPLICABILITY as CCSA')
    .join('information_schema.TABLES as T', 'CCSA.collation_name', 'T.table_collation')
    .where('T.table_schema', 'not in', databasesToSkip);
  for (const tableToSkip of tablesToSkip) {
    tableQuery = tableQuery.whereNot(function skipTables() {
      this.where({ 'T.table_schema': tableToSkip.database, 'T.table_name': tableToSkip.table });
    });
  }
  const tables = await select(
    tableQuery
      .where('CCSA.character_set_name', 'in', CharsetsToConvert)
      .where('T.table_type', 'BASE TABLE')
      .columns('T.table_schema', 'T.table_name'));
  debug(`Altering ${tables.length} tables`);
  for (const table of tables) {
    await alter(`
      ALTER TABLE \`${table.table_schema}\`.\`${table.table_name}\`
        DEFAULT CHARACTER SET utf8mb4
        COLLATE utf8mb4_unicode_ci`);
  }

  // base query for finding the columns we want to convert
  let columnQuery = knex('information_schema.COLUMNS as C')
    .where('C.table_schema', 'not in', databasesToSkip)
    .where('C.character_set_name', 'in', CharsetsToConvert);
  for (const tableToSkip of tablesToSkip) {
    columnQuery = columnQuery.whereNot(function skipTables() {
      this.where({ 'C.table_schema': tableToSkip.database, 'C.table_name': tableToSkip.table });
    });
  }
  for (const columnToSkip of columnsToSkip) {
    columnQuery = columnQuery.whereNot(function skipColumns() {
      this.where({
        'C.table_schema': columnToSkip.database,
        'C.table_name': columnToSkip.table,
        'C.column_name': columnToSkip.column,
      });
    });
  }

  const problemColumns = await select(
    columnQuery.clone()
      .join('information_schema.STATISTICS as S', {
        'C.table_schema': 'S.table_schema',
        'C.table_name': 'S.table_name',
        'C.column_name': 'S.column_name',
      })
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
  debug('No problem columns detected');

  const columns = await select(
    columnQuery.clone()
      .columns(
        'C.table_schema', 'C.table_name', 'C.column_name', 'C.column_type', 'C.is_nullable'));
  debug(`Altering ${columns.length} columns`);
  for (const c of columns) {
    await alter(`
      ALTER TABLE \`${c.table_schema}\`.\`${c.table_name}\`
        MODIFY \`${c.column_name}\` ${c.column_type}
        CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
          ${c.is_nullable === 'NO' ? ' NOT NULL' : ''}
          `);
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

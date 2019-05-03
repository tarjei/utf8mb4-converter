# This is a fork of the original utf8mb4-converter!

It's main difference is that it does not rely on babel for compilation and building.

The easiest way to use it (with a modern version of node) is to check out out this repo and run

    npm install
    node src/cli.js 

And then add the commandline options you need.


# utf8mb4-converter

So, you thought ahead when setting up your [MySQL][] database and set your
character encoding to `utf8` to make it easier to store international characters
and actually read them back out again.

But then someone sets their name to an [emoji][], and it isn't being read back
properly from the database. A little bit of digging reveals that `utf8` on MySQL
is really [just a subset of the full UTF-8 character set][utf8mb3]. What you
really wanted was [utf8mb4][]. At this point, you have a few choices.

 1. Switch to [PostgreSQL][], [MongoDB][], or pretty much anything else
 2. Fix the charset and encoding in your MySQL database

## Switching to utf8mb4

There are a number of resources for switching the character set and collation
for your MySQL databases, tables and columns. [The best write-up][full-unicode]
is by [Mathais][], but there's also [useful info][RDS] from [Alon Diamant][] if
you happen to be running in AWS.

**Please read everything you can before proceeding!!!** This script attempts to
safely and automagically convert `utf8` (and `latin1`, if you are daring), but
it may not work with your dataset. Backup before proceeding, run it in a test
environment if you can.

Before proceeding:

 0. [Backup]. These scripts worked for me, but may cause you to lose all your
    data.
 1. Run it a few times in a test environment. Be sure this test environment is
    running the same version of MySQL; I've seen slightly different behaviors
    with different versions.
 2. Update MySQL configuration prior to migrating data, so that new
    tables/colums can be correctly encoded with `utf8mb4`.

## Installation

This app requires [Node.js][].

```
$ npm install -g https://github.com/building5/utf8mb4-converter.git
```

## Usage

```
$ utf8mb4-converter [OPTIONS...]
```

 0. You made a backup already, right?
 1. Run `utf8mb4-converter` and inspect the DDL it will execute to see what it
    is going to do to your database.
 2. If all looks good, you can either execute that generated script, or you can
    run `utf8mb4-converter --make-it-so` to execute the DDL on the server.

## Options


### --force-latin1

If you have some data encoded as `latin1`, and you are really, *really* sure
that it only has ASCII characters in it, then you can provide `--force-latin1`
to convert those databases/tables/columns to `utf8mb4`. Any international
characters in those columns will probably be corrupted.

If you'd like to see more of what the script is doing, pass in `--verbose`.

### --skip

If there are some databases on your MySQL server you'd rather not convert, you
can pass them to `--skip` to, well, skip them.

## Be Aware

InnoDB has an index length limit of 767 bytes per column. For `utf8mb3`, this
conveniently works out to 255 characters. But for `utf8mb4`, this is only 191
characters. If you have any columns longer than that, you will either have to
limit the index to 191 characters of the column, or narrow the column to 191
characters.

# LICENSE

ISC license. PRs welcome.

 [MySQL]: https://www.mysql.com/
 [emoji]: http://unicode.org/emoji/charts/full-emoji-list.html
 [utf8mb3]: https://dev.mysql.com/doc/refman/5.5/en/charset-unicode-utf8mb3.html
 [utf8mb4]: https://dev.mysql.com/doc/refman/5.5/en/charset-unicode-utf8mb4.html
 [PostgreSQL]: http://www.postgresql.org/
 [MongoDB]: https://www.mongodb.com/
 [full-unicode]: https://mathiasbynens.be/notes/mysql-utf8mb4
 [Mathais]: https://mathiasbynens.be/
 [RDS]: http://aprogrammers.blogspot.com/2014/12/utf8mb4-character-set-in-amazon-rds.html
 [Alon Diamant]: http://aprogrammers.blogspot.com/2014/12/utf8mb4-character-set-in-amazon-rds.html
 [Backup]: http://dev.mysql.com/doc/refman/5.7/en/backup-and-recovery.html
 [Node.js]: https://nodejs.org/en/

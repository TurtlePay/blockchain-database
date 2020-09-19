// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import {Postgres, SQLite, MySQL} from "db-abstraction";
import {Collector} from "./Collector";
import {Logger} from "./Logger";

/** @ignore */
require('dotenv').config();

(async() => {
    let database;

    if (!process.env.NODE_ENV || process.env.NODE_ENV.toLowerCase() !== 'production') {
        Logger.warn('Node.JS is not running in production mode. ' +
            'Consider running in production mode: export NODE_ENV=production');
    }

    const host = process.env.DB_HOST || undefined;
    const port = (process.env.DB_PORT) ? parseInt(process.env.DB_PORT, 10) : undefined;
    const user = process.env.DB_USER || undefined;
    const pass = process.env.DB_PASS || undefined;
    const db = process.env.DB_NAME || 'turtlecoin';

    const node_host = process.env.NODE_HOST || 'localhost';
    const node_port = (process.env.NODE_PORT) ? parseInt(process.env.NODE_PORT, 10) : 11898;
    const node_ssl = !!(process.env.NODE_SSL &&
        (process.env.NODE_SSL.toLowerCase() === 'true' || process.env.NODE_SSL === '1'));

    if (process.env.USE_MYSQL) {
        Logger.info('Using MySQL Backend...');

        if (host === undefined || user === undefined || pass === undefined || db === undefined) {
            console.error('\n\n!! Missing database connection parameters in environment variables !!\n\n');

            process.exit(1);
        }

        database = new MySQL(host, port || 3306, user, pass, db);
    } else if (process.env.USE_POSTGRES) {
        Logger.info('Using Postgres Backend...');

        if (host === undefined || user === undefined || pass === undefined || db === undefined) {
            console.error('\n\n!! Missing database connection parameters in environment variables !!\n\n');

            process.exit(1);
        }

        database = new Postgres(host, port || 5432, user, pass, db);
    } else {
        Logger.info('Using SQLite Backend...');

        database = new SQLite(process.env.SQLITE_PATH || 'blockchain.sqlite3');
    }

    const collector = new Collector(database, node_host, node_port, node_ssl);

    Logger.info('Collector starting...');

    await collector.init();
})();
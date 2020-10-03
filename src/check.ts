// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { Logger } from './Logger';
import { BlockchainDB } from './BlockchainDB';
import { getDatabase, checkProduction } from './Common';

(async () => {
    checkProduction();

    const database = await getDatabase();

    const blockchain = new BlockchainDB(database);

    Logger.info('Connected to database...');

    Logger.info('Checking database consistency...');

    let [consistency, inconsistentRows] = await blockchain.checkConsistency();

    while (!consistency) {
        Logger.warn('Database consistency check failed... attempting recovery...');

        let lowestHeight = Number.MAX_SAFE_INTEGER;

        for (const hash of inconsistentRows) {
            const height = await blockchain.heightFromHash(hash);

            if (height < lowestHeight) {
                lowestHeight = height;
            }
        }

        Logger.warn('Attempting rewind of database to: %s', lowestHeight);

        await blockchain.rewind(lowestHeight);

        [consistency, inconsistentRows] = await blockchain.checkConsistency();

        Logger.debug('Database consistency state is now %s',
            (consistency) ? 'valid' : 'invalid');
    }

    Logger.info('Database consistency verified!');

    process.exit(0);
})();

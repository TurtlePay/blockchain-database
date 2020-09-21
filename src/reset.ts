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

    Logger.info('Resetting database...');

    await blockchain.reset();

    Logger.info('Database reset complete.');
})();

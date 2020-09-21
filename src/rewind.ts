// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { Logger } from './Logger';
import { BlockchainDB } from './BlockchainDB';
import { getDatabase, checkProduction } from './Common';

(async () => {
    checkProduction();

    const database = await getDatabase();

    const rewindTo = parseInt(process.argv[2], 10);

    const blockchain = new BlockchainDB(database);

    Logger.info('Connected to database...');

    Logger.info('Rewinding to: %s', rewindTo);

    await blockchain.rewind(rewindTo);

    Logger.info('Rewound database to: %s', rewindTo);
})();

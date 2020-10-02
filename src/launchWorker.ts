// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { RawBlockWorker } from './Worker';
import { Logger } from './Logger';
import { getDatabase, checkProduction } from './Common';

(async () => {
    checkProduction();

    const database = await getDatabase();

    Logger.info('Starting raw block processor...');

    const worker = await RawBlockWorker.init(database, 'rawblock-processor');

    await worker.start();

    Logger.info('Waiting for requests...');
})();

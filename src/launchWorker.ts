// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { RawBlockWorker } from './RawBlockWorker';
import { Logger } from '@turtlepay/logger';
import { getDatabase, checkProduction } from './Common';

(async () => {
    checkProduction();

    const database = await getDatabase();

    Logger.info('Starting raw block processor...');

    try {
        const worker = new RawBlockWorker(database, 'rawblock-processor');

        await worker.init();

        await worker.start();

        Logger.info('Waiting for requests...');
    } catch (e) {
        Logger.error('Cannot connect to RabbitMQ server. Exiting...');

        process.exit(1);
    }
})();

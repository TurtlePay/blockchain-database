// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { Collector } from './Collector';
import { Logger } from '@turtlepay/logger';
import { getDatabase, getNode, checkProduction } from './Common';

(async () => {
    checkProduction();

    const node = await getNode();

    const database = await getDatabase();

    const collector = new Collector(database, node.host, node.port, node.ssl);

    Logger.info('Collector starting...');

    await collector.init();
})();

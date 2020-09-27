// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { ProcessedBlock } from './BlockLoader';
import { IDatabase, Interfaces } from 'db-abstraction';
import { Logger } from './Logger';
import IBulkQuery = Interfaces.IBulkQuery;
import IValueArray = Interfaces.IValueArray;

/** @ignore */
const combine = (a: IBulkQuery[], b: IBulkQuery[]): IBulkQuery[] => {
    return a.concat(b);
};

/** @ignore */
export async function prepareProcessedBlockStatements (
    database: IDatabase,
    block: ProcessedBlock): Promise<IBulkQuery[]> {
    let result: IBulkQuery[] = [];

    result = combine(result,
        await prepareMultiInsert(database, 'blocks',
            ['hash', 'data'], block.blocks));

    result = combine(result,
        await prepareMultiInsert(database, 'blockchain',
            ['height', 'hash', 'utctimestamp'], block.blockchain));

    result = combine(result,
        await prepareMultiInsert(database, 'transactions',
            ['hash', 'block_hash', 'coinbase', 'data'], block.transactions));

    result = combine(result,
        await prepareMultiInsert(database, 'transaction_meta',
            ['hash', 'fee', 'amount', 'size'], block.transaction_meta));

    result = combine(result,
        await prepareMultiInsert(database, 'transaction_inputs',
            ['hash', 'keyImage'], block.inputs));

    result = combine(result,
        await prepareMultiInsert(database, 'transaction_outputs',
            ['hash', 'idx', 'amount', 'outputKey'], block.outputs));

    result = combine(result,
        await prepareMultiInsert(database, 'transaction_paymentids',
            ['hash', 'paymentId'], block.paymentIds));

    return result;
}

/** @ignore */
export async function prepareMultiInsert (
    database: IDatabase,
    table: string,
    columns: string[],
    values: IValueArray
): Promise<IBulkQuery[]> {
    Logger.debug('Preparing insert statements into %s table for %s rows...', table, values.length);

    const result: IBulkQuery[] = [];

    while (values.length > 0) {
        const records = values.slice(0, 25);

        values = values.slice(25);

        const stmt = database.prepareMultiInsert(table, columns, records);

        result.push({ query: stmt });
    }

    return result;
}

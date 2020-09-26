// Copyright (c) 2018-2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { IDatabase, Interfaces, prepareCreateTable } from 'db-abstraction';
import {
    Block,
    KeyInput,
    KeyOutput,
    Transaction,
    TransactionInputs,
    TransactionOutputs,
    TurtleCoindTypes as TurtleCoindInterfaces
} from 'turtlecoin-utils';
import { format } from 'util';
import { Logger } from './Logger';
import * as BigInteger from 'big-integer';

/** @ignore */
require('dotenv').config();

/** @ignore */
import ITurtleCoind = TurtleCoindInterfaces.ITurtleCoind;
/** @ignore */
import FKAction = Interfaces.FKAction;
/** @ignore */
import IBulkQuery = Interfaces.IBulkQuery;
/** @ignore */
import IValueArray = Interfaces.IValueArray;
/** @ignore */
import CoinbaseInput = TransactionInputs.CoinbaseInput;
/** @ignore */
import InputType = TransactionInputs.InputType;
/** @ignore */
import OutputType = TransactionOutputs.OutputType;

/** @ignore */
export interface ILoadedBlock extends Block {
    txns?: Transaction[];
}

/** @ignore */
export interface ILoadedRawBlock extends TurtleCoindInterfaces.IRawBlock {
    hash: string;
}

/**
 * Represents an instance of the blockchain database
 */
export class BlockchainDB implements ITurtleCoind {
    private readonly m_db: IDatabase;

    /**
     * Database cache constructor
     * @param database the database connection to use
     */
    constructor (database: IDatabase) {
        this.m_db = database;
    }

    /**
     * Checks the consistency of the blockchain in the database
     */
    public async checkConsistency (): Promise<[boolean, string[]]> {
        const [count, rows] = await this.m_db.query(
            'SELECT blocks.hash AS hash FROM blocks ' +
            'LEFT JOIN block_meta ON block_meta.hash = blocks.hash ' +
            'WHERE block_meta.size IS NULL');

        return [count === 0, rows.map(elem => elem.hash)];
    }

    /**
     * Closes the underlying database connection
     */
    public async close (): Promise<void> {
        return this.m_db.close();
    }

    /**
     * Retrieves the genesis hash
     */
    public async genesisHash (): Promise<string> {
        return this.hashFromHeight(0);
    }

    /**
     * Retrieve the proper start sync height based on the selected parameters
     * @param checkpoints the known block hash checkpoints
     * @param height the known block height
     * @param timestamp the timestamp to start syncing from
     */
    public async getSyncHeight (
        checkpoints: string[] = [],
        height = 0,
        timestamp = 0
    ): Promise<number> {
        let syncHeight = 0;

        if (checkpoints.length > 0) {
            const clauses: string[] = [];

            for (const checkpoint of checkpoints) {
                clauses.push(format('hash = \'%s\'', checkpoint));
            }

            const [count, rows] = await this.m_db.query(
                'SELECT height FROM blockchain WHERE ' + clauses.join(' OR ') + ' ORDER BY height DESC LIMIT 1');

            if (count !== 0) {
                syncHeight = parseInt(rows[0].height, 10);

                syncHeight++;
            }
        }

        if (timestamp > 0) {
            const [count, rows] = await this.m_db.query(
                'SELECT height FROM blockchain WHERE utctimestamp <= ? ORDER BY height DESC LIMIT 1',
                [timestamp]);

            if (count !== 0) {
                syncHeight = parseInt(rows[0].height, 10);

                syncHeight++;
            }
        }

        if (height > syncHeight) {
            syncHeight = height;
        }

        return syncHeight;
    }

    /**
     * Retrieves transaction meta data
     * @param hash the transaction hash
     * @private
     */
    private async getTransactionMeta (hash: string): Promise<TurtleCoindInterfaces.TransactionSummary> {
        const [count, rows] = await this.m_db.query(
            'SELECT hash, fee, amount, size FROM transaction_meta WHERE hash = ?', [hash]);

        if (count === 0) throw new Error('Transaction meta data not found: ' + hash);

        return {
            hash: rows[0].hash,
            amountOut: parseInt(rows[0].amount, 10),
            fee: parseInt(rows[0].fee, 10),
            size: parseInt(rows[0].size, 10)
        };
    }

    /**
     * Retrives all transaction meta information for the given block
     * @param hash the transaction hash
     * @private
     */
    private async getTransactionsMetaByBlock (hash: string): Promise<TurtleCoindInterfaces.TransactionSummary[]> {
        const [, rows] = await this.m_db.query(
            'SELECT transactions.hash AS hash, fee, amount, size FROM transactions LEFT JOIN transaction_meta ' +
            'ON transaction_meta.hash = transactions.hash WHERE transactions.block_hash = ? ORDER BY coinbase',
            [hash]);

        return rows
            .map(row => {
                return {
                    hash: row.hash,
                    amountOut: parseInt(row.amount, 10),
                    fee: parseInt(row.fee, 10),
                    size: parseInt(row.size, 10)
                };
            });
    }

    /**
     * Retrieves a Block from the database
     * @param hash the block hash
     */
    public async getBlock (hash: string): Promise<Block> {
        const [count, rows] = await this.m_db.query(
            'SELECT data FROM blocks WHERE hash = ?',
            [hash]);

        if (count === 0) throw new Error('Block not found: ' + hash);

        return Block.from(rows[0].data);
    }

    /**
     * Retrieve the block hash for the given transaction
     * @param hash the transaction hash
     * @private
     */
    private async getBlockHashByTransaction (hash: string): Promise<string> {
        const [count, rows] = await this.m_db.query(
            'SELECT block_hash FROM transactions WHERE hash = ?', [hash]);

        if (count === 0) throw new Error('Transaction not found');

        return rows[0].block_hash;
    }

    /**
     * Retrieves the block hashes above a given height from the database
     * @param height the height to start retrieving block hashes from
     * @private
     */
    private async getBlockHashesAboveHeight (height: number): Promise<string[]> {
        const [count, rows] = await this.m_db.query(
            'SELECT hash FROM blockchain WHERE height >= ?',
            [height]);

        if (count === 0) return [];

        return rows.map(elem => elem.hash);
    }

    /**
     * Retrieves a Block Header from the database
     * @param hash the block hash or block height
     * @private
     */
    private async getBlockHeader (hash: string | number): Promise<TurtleCoindInterfaces.IBlockHeader> {
        if (typeof hash === 'number') {
            hash = await this.hashFromHeight(hash);
        }

        hash = hash.toLowerCase();

        return this.getBlockMeta(hash);
    }

    /**
     * Retrieves the block headers from the database up to the given height
     * @param height the block height to finish at
     * @param limit the number of block headers to retrieve
     * @private
     */
    private async getBlockHeaders (height: number, limit = 30): Promise<TurtleCoindInterfaces.IBlockHeader[]> {
        const [count, rows] = await this.m_db.query(
            'SELECT block_meta.hash AS hash, prevHash, height, baseReward, difficulty, majorVersion, ' +
            'minorVersion, nonce, size, utctimestamp, alreadyGeneratedCoins, alreadyGeneratedTransactions, ' +
            'reward, sizeMedian, totalFeeAmount, transactionsCount, transactionsCumulativeSize, orphan, penalty ' +
            'FROM block_meta LEFT JOIN blockchain ON blockchain.hash = block_meta.hash WHERE height <= ? ORDER BY ' +
            'height DESC LIMIT ?', [height, limit]);

        if (count === 0) throw new Error('No blocks found in database');

        const topHeight = await this.getTopBlockHeight();

        return rows
            .map(row => {
                return {
                    hash: row.hash,
                    prevHash: row.prevHash || row.prevhash,
                    height: parseInt(row.height, 10),
                    baseReward: parseInt(row.baseReward || row.basereward, 10),
                    difficulty: parseInt(row.difficulty, 10),
                    majorVersion: parseInt(row.majorVersion || row.majorversion, 10),
                    minorVersion: parseInt(row.minorVersion || row.minorversion, 10),
                    nonce: parseInt(row.nonce, 10),
                    size: parseInt(row.size),
                    timestamp: new Date(parseInt(row.utctimestamp, 10) * 1000),
                    alreadyGeneratedCoins: BigInteger(row.alreadyGeneratedCoins || row.alreadygeneratedcoins),
                    alreadyGeneratedTransactions:
                        parseInt(row.alreadyGeneratedTransactions || row.alreadygeneratedtransactions, 10),
                    reward: parseInt(row.reward, 10),
                    sizeMedian: parseInt(row.sizeMedian || row.sizemedian, 10),
                    totalFeeAmount: parseInt(row.totalFeeAmount || row.totalfeeamount, 10),
                    transactionsCumulativeSize:
                        parseInt(row.transactionsCumulativeSize || row.transactionscumulativesize, 10),
                    transactionCount: parseInt(row.transactionsCount || row.transactionscount, 10),
                    depth: topHeight - parseInt(row.height, 10),
                    orphan: (row.orphan === 1 || row.orpahn === '1'),
                    penalty: parseInt(row.penalty, 10)
                };
            });
    }

    /**
     * Retrieves block meta data
     * @param hash the block hash
     * @private
     */
    private async getBlockMeta (hash: string): Promise<TurtleCoindInterfaces.IBlockHeader> {
        try {
            const height = await this.heightFromHash(hash);

            const result = await this.getBlockHeaders(height, 1);

            return result[0];
        } catch {
            throw new Error('Block meta data not found: ' + hash);
        }
    }

    /**
     * Retrieves arbitrary information from the database
     */
    public async getInformation (): Promise<TurtleCoindInterfaces.IInfo> {
        const [count, rows] = await this.m_db.query(
            'SELECT data FROM information WHERE idx = ?', ['info']);

        if (count === 0) throw new Error('Information key not found');

        const topBlock = await this.lastBlock();

        const transactions = await this.getUserTransactionsCount();

        try {
            const result: TurtleCoindInterfaces.IInfo = JSON.parse(rows[0].data);

            /**
             * We have to overwrite a few of these values so that it reflects
             * the current status of the database in the response
             */

            result.isCacheApi = true;

            result.height = topBlock.height;

            result.networkHeight--;

            if (result.height !== result.networkHeight) {
                result.synced = false;
            }

            result.difficulty = topBlock.difficulty;

            result.hashrate = Math.round(result.difficulty / 30);

            result.lastBlockIndex = topBlock.height;

            result.majorVersion = topBlock.majorVersion;

            result.minorVersion = topBlock.minorVersion;

            result.startTime = new Date((result as any).startTime);

            result.transactionsSize = transactions;

            return result;
        } catch {
            throw new SyntaxError('Malformed JSON found in database');
        }
    }

    public async getPeers (): Promise<TurtleCoindInterfaces.IPeers> {
        const [count, rows] = await this.m_db.query(
            'SELECT data FROM information WHERE idx = ?', ['peers']);

        if (count === 0) throw new Error('Peers key not found');

        try {
            return JSON.parse(rows[0].data);
        } catch {
            throw new SyntaxError('Malformed JSON found in database');
        }
    }

    /**
     * Retrieves the top block height in the database
     * @private
     */
    private async getTopBlockHeight (): Promise<number> {
        const [count, rows] = await this.m_db.query(
            'SELECT height FROM blockchain ORDER BY height DESC LIMIT 1');

        if (count === 0) throw new Error('No blocks in database');

        return parseInt(rows[0].height, 10);
    }

    /**
     * Retrieves a Transaction from the database
     * @param hash the transaction hash
     */
    public async getTransaction (hash: string): Promise<Transaction> {
        const [count, rows] = await this.m_db.query(
            'SELECT data FROM transactions WHERE hash = ?',
            [hash]);

        if (count === 0) throw new Error('Transaction not found: ' + hash);

        return Transaction.from(rows[0].data);
    }

    /**
     * Retrieves the number of user transactions in the database
     * @private
     */
    private async getUserTransactionsCount (): Promise<number> {
        const [, rows] = await this.m_db.query('SELECT COUNT(*) AS cnt FROM transactions WHERE coinbase = 0');

        return parseInt(rows[0].cnt, 10);
    }

    /**
     * Retrieves an array of block hashes that can be sent to a traditional
     * daemon for syncing purposes
     */
    public async hashesForSync (): Promise<string[]> {
        const hashes: string[] = [];

        const insert = (hash: string) => {
            if (hashes.indexOf(hash) === -1) {
                hashes.push(hash);
            }
        };

        try {
            const topBlockHeight = await this.getTopBlockHeight();

            const [count, rows] = await this.m_db.query(
                'SELECT hash, height FROM blockchain WHERE height <= ? ORDER BY height DESC LIMIT 11',
                [topBlockHeight]);

            if (!count) return [];

            rows.map(elem => insert(elem.hash));

            let bottomHeight = parseInt(rows[rows.length - 1].height, 10);
            let n = 1;

            do {
                const diff = Math.pow(2, n);
                bottomHeight = bottomHeight - diff;
                if (bottomHeight > 0) {
                    n++;
                    const hash = await this.hashFromHeight(bottomHeight);
                    insert(hash);
                }
            } while (bottomHeight > 0);

            const hash = await this.genesisHash();

            insert(hash);

            return hashes;
        } catch (e) {
            return [];
        }
    }

    /**
     * Retrieves the hash from the height
     * @param height
     */
    public async hashFromHeight (height: number): Promise<string> {
        const [count, rows] = await this.m_db.query(
            'SELECT hash FROM blockchain WHERE height = ?',
            [height]);

        if (count === 0) throw new Error('No block exists for given height: ' + height);

        return rows[0].hash;
    }

    /**
     * indicates whether we have the genesis hash in the database
     */
    public async haveGenesis (): Promise<boolean> {
        try {
            const hash = await this.genesisHash();

            return (hash.length !== 0);
        } catch (e) {
            return false;
        }
    }

    /**
     * Retrieves the height from the hash
     * @param hash
     */
    public async heightFromHash (hash: string): Promise<number> {
        const [count, rows] = await this.m_db.query(
            'SELECT height FROM blockchain WHERE hash = ?',
            [hash]);

        if (count === 0) throw new Error('Block not found: ' + hash);

        return parseInt(rows[0].height, 10);
    }

    /**
     * Initializes the required database structure in the database if
     * it does not already exist in the underlying database storage
     */
    public async init (): Promise<void> {
        const stmts: IBulkQuery[] = [];
        let create: { table: string, indexes: string[] };

        const hashType = this.m_db.hashType;
        const blobType = this.m_db.blobType;
        const uint64Type = this.m_db.uint64Type;
        const uint32Type = this.m_db.uint32Type;
        const tableOptions = this.m_db.tableOptions;

        const addQuery = () => {
            stmts.push({ query: create.table });

            create.indexes.map(index => stmts.push({ query: index }));
        };

        create = prepareCreateTable(this.m_db.type, 'blocks', [
            { name: 'hash', type: hashType },
            { name: 'data', type: blobType }
        ], ['hash'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'blockchain', [
            { name: 'height', type: uint64Type },
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'blocks',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'utctimestamp', type: uint64Type }
        ], ['height'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'block_meta', [
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'blocks',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'prevHash', type: hashType },
            { name: 'baseReward', type: uint64Type },
            { name: 'difficulty', type: uint32Type },
            { name: 'majorVersion', type: uint32Type },
            { name: 'minorVersion', type: uint32Type },
            { name: 'nonce', type: uint32Type },
            { name: 'size', type: uint32Type },
            { name: 'alreadyGeneratedCoins', type: uint64Type },
            { name: 'alreadyGeneratedTransactions', type: uint64Type },
            { name: 'reward', type: uint64Type },
            { name: 'sizeMedian', type: uint32Type },
            { name: 'totalFeeAmount', type: uint64Type },
            { name: 'transactionsCumulativeSize', type: uint32Type },
            { name: 'transactionsCount', type: uint32Type },
            { name: 'orphan', type: uint32Type },
            { name: 'penalty', type: uint32Type }
        ], ['hash'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transactions', [
            { name: 'hash', type: hashType },
            {
                name: 'block_hash',
                type: hashType,
                foreign: {
                    table: 'blocks',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'coinbase', type: uint32Type },
            { name: 'data', type: blobType }
        ], ['hash'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transaction_meta', [
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'transactions',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'fee', type: uint64Type },
            { name: 'size', type: uint32Type },
            { name: 'amount', type: uint64Type }
        ], ['hash'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transaction_inputs', [
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'transactions',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'keyImage', type: hashType }
        ], ['keyImage'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transaction_outputs', [
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'transactions',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'idx', type: uint64Type },
            { name: 'amount', type: uint64Type },
            { name: 'outputKey', type: hashType },
            { name: 'globalIdx', type: uint32Type, nullable: true }
        ], ['hash', 'idx'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transaction_paymentIds', [
            {
                name: 'hash',
                type: hashType,
                foreign: {
                    table: 'transactions',
                    column: 'hash',
                    delete: FKAction.CASCADE,
                    update: FKAction.CASCADE
                }
            },
            { name: 'paymentId', type: hashType }
        ], ['hash', 'paymentId'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'transaction_pool', [
            { name: 'hash', type: hashType },
            { name: 'fee', type: uint64Type },
            { name: 'size', type: uint32Type },
            { name: 'amount', type: uint64Type },
            { name: 'data', type: blobType, nullable: true }
        ], ['hash'], tableOptions);

        addQuery();

        create = prepareCreateTable(this.m_db.type, 'information', [
            { name: 'idx', type: hashType },
            { name: 'data', type: blobType }
        ], ['idx'], tableOptions);

        addQuery();

        await this.m_db.transaction(stmts);
    }

    /**
     * Retrieves the last block header
     */
    public async lastBlockHeader (): Promise<TurtleCoindInterfaces.IBlockHeader> {
        const [count, rows] = await this.m_db.query(
            'SELECT blockchain.hash AS hash FROM blockchain ' +
            'LEFT JOIN block_meta ON block_meta.hash = blockchain.hash ' +
            'WHERE block_meta.reward IS NOT NULL ORDER BY height DESC LIMIT 1');

        if (count === 0) throw new Error('No blocks in the blockchain');

        return this.getBlockHeader(rows[0].hash);
    }

    /**
     * Loads a RawBlock as structured objects for later use
     * @param rawBlock the raw block to load
     * @private
     */
    private static async loadRawBlock (rawBlock: TurtleCoindInterfaces.IRawBlock): Promise<ILoadedBlock> {
        const block: ILoadedBlock = await Block.from(rawBlock.blob);

        // calculate the hash so it becomes cached
        await block.hash();

        Logger.debug('Block %s decoded successfully', await block.hash());

        // calculate the hash so it becomes cached
        await block.minerTransaction.hash();

        block.txns = [block.minerTransaction];

        for (const tx of rawBlock.transactions) {
            const txn = await Transaction.from(tx);

            Logger.debug('Transaction %s decoded successfully', await txn.hash());

            // calculate the hash so it becomes cached
            await txn.hash();

            block.txns.push(txn);
        }

        return block;
    }

    /**
     * Prepares all delete statements in support of rewinding the database
     * @param height the height to start from for rewiding the database
     * @private
     */
    private async prepareRewind (height: number): Promise<IBulkQuery[]> {
        const stmts: IBulkQuery[] = [];

        const toDelete: string[] = await this.getBlockHashesAboveHeight(height);

        for (const hash of toDelete) {
            stmts.push({ query: 'DELETE FROM blocks WHERE hash = ?', values: [hash] });
        }

        return stmts;
    }

    /**
     * Retrieves high level block information for the last 2880 blocks (day)
     */
    public async recentChainStats (): Promise<{
        timestamp: number,
        difficulty: number,
        nonce: number,
        size: number,
        txnCount: number
    }[]> {
        const [count, rows] = await this.m_db.query(
            'SELECT utctimestamp, difficulty, nonce, size, transactionsCount ' +
            'FROM blockchain LEFT JOIN block_meta ON block_meta.hash = blockchain.hash ' +
            'ORDER BY height DESC LIMIT 2880'
        );

        if (!count) throw new Error('No data');

        return rows.map(row => {
            return {
                timestamp: parseInt(row.utctimestamp, 10),
                difficulty: parseInt(row.difficulty, 10),
                nonce: parseInt(row.nonce, 10),
                size: parseInt(row.nonce, 10),
                txnCount: parseInt(row.transactionsCount || row.transactionscount, 10)
            };
        });
    }

    /**
     * Resets the blockchain database
     */
    public async reset (): Promise<void> {
        try {
            await this.m_db.query(
                'TRUNCATE blocks CASCADE');

            await this.m_db.query(
                'TRUNCATE information CASCADE');

            await this.m_db.query(
                'TRUNCATE transaction_pool CASCADE');
        } catch {
            await this.m_db.query(
                'DELETE FROM blocks');

            await this.m_db.query(
                'DELETE FROM information');

            await this.m_db.query(
                'DELETE FROM transaction_pool');
        }
    }

    /**
     * Rewinds the database to the given height
     * @param height the height to rewind the database to
     */
    public async rewind (height: number): Promise<void> {
        let stmts: IBulkQuery[] = await this.prepareRewind(height);

        if (stmts.length > 0) {
            Logger.debug('Preparing to delete %s blocks', stmts.length);

            while (stmts.length > 0) {
                const _stmts = stmts.slice(0, 1);

                stmts = stmts.slice(1);

                Logger.debug('Deleting block...', _stmts.length);

                try {
                    await this.m_db.transaction(_stmts);
                } catch {
                    console.log(_stmts);

                    for (const stmt of _stmts) {
                        stmts.push(stmt);
                    }
                }
            }
        }
    }

    /**
     * Saves block meta data (things we cannot easily compute) to the database
     * @param headers and array of block headers
     */
    public async saveBlocksMeta (headers: TurtleCoindInterfaces.IBlockHeader[]): Promise<void> {
        if (headers.length === 0) {
            return;
        }

        let l_headers: IValueArray = [];

        const stmts: IBulkQuery[] = [];

        const l_hashes: string[] = [];

        for (const header of headers) {
            /* Let's not double process the same block */
            if (l_hashes.indexOf(header.hash) !== -1) {
                continue;
            }

            stmts.push({
                query: 'DELETE FROM block_meta WHERE hash = ?',
                values: [header.hash]
            });

            l_headers.push([
                header.hash,
                header.prevHash,
                header.baseReward,
                header.difficulty,
                header.majorVersion,
                header.minorVersion,
                header.nonce,
                header.size,
                header.alreadyGeneratedCoins.toString(),
                header.alreadyGeneratedTransactions,
                header.reward,
                header.sizeMedian,
                header.totalFeeAmount,
                header.transactionsCumulativeSize,
                header.transactionCount,
                (header.orphan) ? 1 : 0,
                header.penalty
            ]);

            l_hashes.push(header.hash);
        }

        while (l_headers.length > 0) {
            const records = l_headers.slice(0, 25);

            l_headers = l_headers.slice(25);

            const query = this.m_db.prepareMultiInsert(
                'INSERT INTO block_meta VALUES %L', records);

            stmts.push({ query });
        }

        return this.m_db.transaction(stmts);
    }

    /**
     * Saves daemon information in the database
     * @param info information object from daemon
     */
    public async saveInformation (info: TurtleCoindInterfaces.IInfo): Promise<void> {
        (info as any).startTime = info.startTime.getTime();

        const value = JSON.stringify(info);

        const stmts: IBulkQuery[] = [];

        stmts.push({
            query: 'DELETE FROM information WHERE idx = ?',
            values: ['info']
        });

        stmts.push({
            query: 'INSERT INTO information (idx, data) VALUES (?,?)',
            values: ['info', value]
        });

        await this.m_db.transaction(stmts);
    }

    /**
     * Saves daemon peers in the database
     * @param peers peers object from daemon
     */
    public async savePeers (peers: TurtleCoindInterfaces.IPeers): Promise<void> {
        const value = JSON.stringify(peers);

        const stmts: IBulkQuery[] = [];

        stmts.push({
            query: 'DELETE from information WHERE idx = ?',
            values: ['peers']
        });

        stmts.push({
            query: 'INSERT INTO information (idx, data) VALUES (?,?)',
            values: ['peers', value]
        });

        await this.m_db.transaction(stmts);
    }

    /**
     * Saves a series of raw blocks to the underlying database
     * @param blocks the raw blocks to save
     */
    public async saveRawBlocks (blocks: TurtleCoindInterfaces.IRawBlock[]): Promise<[number[], string[]]> {
        const l_heights: number[] = [];
        const l_hashes: string[] = [];

        if (blocks.length === 0) return [l_heights, l_hashes];

        const l_blockchain: IValueArray = [];
        const l_blocks: IValueArray = [];
        const l_transactions: IValueArray = [];
        const l_inputs: IValueArray = [];
        const l_outputs: IValueArray = [];
        const l_paymentIds: IValueArray = [];
        const l_transaction_meta: IValueArray = [];

        const rewind = async (): Promise<void> => {
            if (l_heights.length > 0) {
                const startHeight = l_heights.sort()[0];

                Logger.debug('Rewinding database to block %s to keep consistency', startHeight);

                await this.rewind(startHeight);

                Logger.debug('Database rewound to block %s', startHeight);
            }
        };

        const promises: Promise<ILoadedBlock>[] = [];

        for (const block of blocks) {
            promises.push(BlockchainDB.loadRawBlock(block));
        }

        const loadedBlocks = await Promise.all(promises);

        const prepareMultiInsert = async (
            query: string, values: IValueArray, tableName: string): Promise<IBulkQuery[]> => {
            Logger.debug('Preparing insert statements into %s table for %s rows', tableName, values.length);

            const result: IBulkQuery[] = [];

            while (values.length > 0) {
                const records = values.slice(0, 25);

                values = values.slice(25);

                const stmt = this.m_db.prepareMultiInsert(query, records);

                result.push({ query: stmt });
            }

            return result;
        };

        const prepareBlockInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO blocks (hash, data) VALUES %L', values, 'blocks');
        };

        const prepareBlockchainInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO blockchain (height, hash, utctimestamp) VALUES %L', values, 'blockchain');
        };

        const prepareTransactionsInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO transactions (hash, block_hash, coinbase, data) VALUES %L', values, 'transactions');
        };

        const prepareTransactionMetaInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO transaction_meta (hash, fee, amount, size) VALUES %L', values, 'transaction_meta');
        };

        const prepareTransactionInputsInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO transaction_inputs (hash, keyImage) VALUES %L', values, 'transaction_inputs');
        };

        const prepareTransactionOutputsInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO transaction_outputs (hash, idx, amount, outputKey) VALUES %L', values, 'transaction_outputs');
        };

        const prepareTransactionPaymentIDsInsert = async (values: IValueArray): Promise<IBulkQuery[]> => {
            return prepareMultiInsert(
                'INSERT INTO transaction_paymentids (hash, paymentId) VALUES %L', values, 'transaction_paymentids');
        };

        const combine = (a: IBulkQuery[], b: IBulkQuery[]): IBulkQuery[] => {
            return a.concat(b);
        };

        for (const block of loadedBlocks) {
            l_heights.push(block.height);

            l_hashes.push(await block.hash());

            l_blocks.push([await block.hash(), block.toString()]);

            l_blockchain.push([block.height, await block.hash(), block.timestamp.getTime() / 1000]);

            if (block.txns) {
                for (const tx of block.txns) {
                    l_transactions.push([await tx.hash(), await block.hash(), (tx.isCoinbase) ? 1 : 0, tx.toString()]);

                    l_transaction_meta.push([await tx.hash(), tx.fee, tx.amount, tx.size]);

                    for (const input of tx.inputs) {
                        if (input.type === TransactionInputs.InputType.KEY) {
                            l_inputs.push([await tx.hash(), (input as TransactionInputs.KeyInput).keyImage]);
                        }
                    }

                    for (let i = 0; i < tx.outputs.length; i++) {
                        const output = (tx.outputs[i] as TransactionOutputs.KeyOutput);

                        if (output.type === TransactionOutputs.OutputType.KEY) {
                            l_outputs.push([await tx.hash(), i, output.amount.toJSNumber(), output.key]);
                        }
                    }

                    if (tx.paymentId) {
                        l_paymentIds.push([await tx.hash(), tx.paymentId]);
                    }
                }
            }
        }

        let stmts: IBulkQuery[] = [];

        const rows = l_blocks.length +
            l_blockchain.length +
            l_transactions.length +
            l_transaction_meta.length +
            l_inputs.length +
            l_outputs.length +
            l_paymentIds.length;

        // Rewind the database to the lowest height we found in the blocks provided
        await rewind();

        // Prepare the blocks insert statement(s)
        stmts = combine(stmts, await prepareBlockInsert(l_blocks));

        // Prepare the blockchain insert statement(s)
        stmts = combine(stmts, await prepareBlockchainInsert(l_blockchain));

        // Prepare the transactions insert statement(s)
        stmts = combine(stmts, await prepareTransactionsInsert(l_transactions));

        // Prepare the transaction meta insert statement(s)
        stmts = combine(stmts, await prepareTransactionMetaInsert(l_transaction_meta));

        // Prepare the transaction inputs insert statement(s)
        stmts = combine(stmts, await prepareTransactionInputsInsert(l_inputs));

        // Prepare the transaction outputs insert statement(s)
        stmts = combine(stmts, await prepareTransactionOutputsInsert(l_outputs));

        // Prepare the transaction payment IDs insert statement(s)
        stmts = combine(stmts, await prepareTransactionPaymentIDsInsert(l_paymentIds));

        Logger.debug('Executing database transaction to insert %s rows with %s statements',
            rows, stmts.length);

        await this.m_db.transaction(stmts);

        Logger.debug('Database transaction execution completed');

        return [l_heights.sort((a, b) => a - b), l_hashes];
    }

    /**
     * Saves a copy of the raw transaction pool to the database
     * @param transactions the raw transactions in the transaction pool
     */
    public async saveTransactionPool (transactions: string[]): Promise<void> {
        const stmts: IBulkQuery[] = [];

        stmts.push({ query: 'DELETE FROM transaction_pool' });

        for (const transaction of transactions) {
            const tx = await Transaction.from(transaction);

            stmts.push({
                query: 'INSERT INTO transaction_pool VALUES (?,?,?,?,?)',
                values: [await tx.hash(), tx.fee, tx.size, tx.amount, transaction]
            });
        }

        await this.m_db.transaction(stmts);
    }

    /**
     * Saves a transaction output global index to the database
     * @param indexes the transaction indexes returned by the daemon
     */
    public async saveOutputGlobalIndexes (
        indexes: TurtleCoindInterfaces.ITransactionIndexes[]
    ): Promise<void> {
        if (indexes.length === 0) {
            return;
        }

        Logger.debug('Preparing transaction_outputs update statements for global indexes...');

        const stmts: IBulkQuery[] = [];

        for (const tx of indexes) {
            for (let i = 0; i < tx.indexes.length; i++) {
                const globalIdx = tx.indexes[i];

                stmts.push({
                    query: 'UPDATE transaction_outputs SET globalIdx = ? WHERE hash = ? AND idx = ?',
                    values: [globalIdx, tx.hash, i]
                });
            }
        }

        Logger.debug('Executing %s transaction_outputs update statements', stmts.length);

        await this.m_db.transaction(stmts);
    }

    /**
     * Retrieves the transaction hashes that contain the payment ID
     * @param paymentId
     */
    public async transactionHashesByPaymentId (paymentId: string): Promise<string[]> {
        const [count, rows] = await this.m_db.query(
            'SELECT hash FROM transaction_paymentids WHERE paymentId = ?',
            [paymentId]);

        if (!count) throw new Error('Error');

        return rows.map(elem => elem.hash);
    }

    /**
     * STARTS THE BLOCKS THAT MUST BE IMPLEMENTED BY THE ITurtleCoind INTERFACE
     * THESE ARE LISTED HERE FOR EASE OF KEEPING TRACK OF THEM
     */

    /**
     * Retrieves the block information for the specified block
     * Requires the daemon to have the explorer enabled
     * @param block the block height or hash
     */
    public async block (block: string | number): Promise<TurtleCoindInterfaces.IBlock> {
        const header = await this.getBlockHeader(block);

        (header as TurtleCoindInterfaces.IBlock).transactions = await this.getTransactionsMetaByBlock(header.hash);

        return (header as TurtleCoindInterfaces.IBlock);
    }

    /**
     * Retrieves the number of blocks the node has in its chain
     */
    public async blockCount (): Promise<number> {
        const [count, rows] = await this.m_db.query(
            'SELECT COUNT(*) as cnt FROM blockchain');

        if (!count) throw new Error('Error');

        return parseInt(rows[0].cnt, 10);
    }

    /**
     * Retrieves the block information for the last 30 blocks up to the current height
     * Requires the daemon to have the explorer enabled
     * @param height the height to stop at
     */
    public async blockHeaders (height: number): Promise<TurtleCoindInterfaces.IBlock[]> {
        const topBlock = await this.getTopBlockHeight();

        if (height > topBlock) {
            throw new RangeError('Requested height exceeds current blockchain height');
        }

        const results: TurtleCoindInterfaces.IBlock[] = [];

        const headers = await this.getBlockHeaders(height);

        for (const header of headers) {
            (header as TurtleCoindInterfaces.IBlock).transactions = await this.getTransactionsMetaByBlock(header.hash);

            results.push((header as TurtleCoindInterfaces.IBlock));
        }

        return results;
    }

    /**
     * Retrieves a mining block template using the specified address and reserve size
     * THIS METHOD IS NOT AVAILABLE IN THIS IMPLEMENTATION
     * @param address the wallet address that will receive the coinbase outputs
     * @param reserveSize the amount of data to reserve in the miner transaction
     */
    public async blockTemplate (address: string, reserveSize: number): Promise<TurtleCoindInterfaces.IBlockTemplate> {
        UNUSED(address);
        UNUSED(reserveSize);

        throw new Error('Method not available');
    }

    /**
     * Retrieves the node fee information
     */
    public async fee (): Promise<TurtleCoindInterfaces.IFee> {
        return {
            address: process.env.FEE_ADDRESS || '',
            amount: (process.env.FEE_AMOUNT) ? BigInteger(process.env.FEE_AMOUNT) : BigInteger.zero
        };
    }

    /**
     * Retrieves the node height information
     */
    public async height (): Promise<TurtleCoindInterfaces.IHeight> {
        const info = await this.info();

        const topBlockHeight = await this.getTopBlockHeight();

        return {
            height: topBlockHeight,
            networkHeight: info.networkHeight--
        };
    }

    /**
     * Retrieves the global indexes for all transactions contained within the blocks heights specified (non-inclusive)
     * @param startHeight the starting block height
     * @param endHeight the ending block height
     */
    public async indexes (startHeight: number, endHeight: number): Promise<TurtleCoindInterfaces.ITransactionIndexes[]> {
        const [, rows] = await this.m_db.query(
            'SELECT transactions.hash AS hash FROM blockchain LEFT JOIN transactions ON ' +
            'transactions.block_hash = blockchain.hash WHERE height >= ? AND height <= ? ORDER BY height',
            [startHeight, endHeight]);

        const txns = rows.map(row => row.hash);

        const results: TurtleCoindInterfaces.ITransactionIndexes[] = [];

        for (const txn of txns) {
            const [, idxes] = await this.m_db.query(
                'SELECT globalIdx FROM transaction_outputs WHERE hash = ? ORDER BY idx', [txn]);

            results.push({
                hash: txn,
                indexes: idxes.map(elem => parseInt(elem.globalIdx || elem.globalidx, 10))
            });
        }

        return results;
    }

    /**
     * Retrieves the node information
     */
    public async info (): Promise<TurtleCoindInterfaces.IInfo> {
        return await this.getInformation();
    }

    /**
     * Retrieves the block information for the last block available
     */
    public async lastBlock (): Promise<TurtleCoindInterfaces.IBlock> {
        const header = await this.lastBlockHeader();

        (header as TurtleCoindInterfaces.IBlock).transactions = await this.getTransactionsMetaByBlock(header.hash);

        return (header as TurtleCoindInterfaces.IBlock);
    }

    /**
     * Retrieves the node peer information
     */
    public async peers (): Promise<TurtleCoindInterfaces.IPeers> {
        return this.getPeers();
    }

    /**
     * Retrieves random global indexes typically used for mixing operations for the specified
     * amounts and for the number requested (if available)
     * @param amounts an array of amounts for which we need random global indexes
     * @param count the number of global indexes to return for each amount
     */
    public async randomIndexes (amounts: number[], count: number): Promise<TurtleCoindInterfaces.IRandomOutput[]> {
        const maxGlobalIdx = async (amount: number): Promise<number> => {
            const [count, rows] = await this.m_db.query(
                'SELECT MAX(globalIdx) AS maximum FROM transaction_outputs WHERE amount = ?',
                [amount]);

            if (count === 0) throw new Error('Amount not found in database');

            return parseInt(rows[0].maximum, 10);
        };

        const random = (max: number): number => {
            const rnd = Math.random();

            return Math.round(rnd * max);
        };

        const fetch = async (amount: number, idxes: number[]):
            Promise<{amount: number, outputs: {index: number, key: string}[]}> => {
            const clauses: string[] = [];

            for (const idx of idxes) {
                clauses.push('globalIdx = ' + idx);
            }

            const [count, rows] = await this.m_db.query(
                'SELECT globalIdx, outputKey FROM transaction_outputs ' +
                'WHERE amount = ? AND (' + clauses.join(' OR ') + ')',
                [amount]);

            if (count !== idxes.length) {
                throw new Error('Internal consistency error');
            }

            return {
                amount: amount,
                outputs: rows.map(row => {
                    return {
                        index: parseInt(row.globalIdx || row.globalidx, 10),
                        key: row.outputKey || row.outputkey
                    };
                })
            };
        };

        const results: TurtleCoindInterfaces.IRandomOutput[] = [];

        for (const amount of amounts) {
            const idxes: number[] = [];

            const max = await maxGlobalIdx(amount);

            if (max <= count) {
                throw new RangeError('Not enough outputs available to satisfy request');
            }

            while (idxes.length < count) {
                const idx = random(max);

                if (idxes.indexOf(idx) === -1) {
                    idxes.push(idx);
                }
            }

            idxes.sort((a, b) => a - b);

            results.push(await fetch(amount, idxes));
        }

        return results;
    }

    /**
     * Retrieves the RawBlock information from the node for the specified block
     * Requires the daemon to have the explorer enabled
     * @param block the block height or hash
     */
    public async rawBlock (block: string | number): Promise<TurtleCoindInterfaces.IRawBlock> {
        if (typeof block === 'number') {
            const header = await this.getBlockHeader(block);

            block = header.hash;
        }

        const [count, rows] = await this.m_db.query(
            'SELECT data FROM blocks WHERE hash = ?',
            [block]);

        if (count === 0) {
            throw new ReferenceError('Block not found: ' + block);
        }

        const result: TurtleCoindInterfaces.IRawBlock = {
            blob: rows[0].data,
            transactions: []
        };

        const [, txnRows] = await this.m_db.query(
            'SELECT data FROM transactions WHERE block_hash = ? AND coinbase = 0',
            [block]);

        for (const txn of txnRows) {
            const tx = await Transaction.from(txn.data);

            if (!tx.isCoinbase) {
                result.transactions.push(txn.data);
            }
        }

        return result;
    }

    /**
     * Retrieves the RawBlocks & RawTransactions for syncing a wallet (or other utility) against the node
     * @param checkpoints a list of block hashes that we know about in descending height order
     * @param height the height to start syncing from
     * @param timestamp the timestamp to start syncing from
     * @param skipCoinbaseTransactions whether we should skip blocks that only include coinbase transactions
     * @param count the number of blocks to return
     */
    public async rawSync (
        checkpoints: string[] = [],
        height = 0,
        timestamp = 0,
        skipCoinbaseTransactions = false,
        count = 100
    ): Promise<TurtleCoindInterfaces.IRawSync> {
        const startHeight = await this.getSyncHeight(checkpoints, height, timestamp);

        const topBlockHeader = await this.lastBlockHeader();

        const skip = (skipCoinbaseTransactions) ? ' AND transactionsCount > 1 ' : '';

        const [, rows] = await this.m_db.query(
            'SELECT blocks.hash AS hash, data FROM blocks LEFT JOIN blockchain ON ' +
            'blockchain.hash = blocks.hash WHERE height >= ? ' + skip + ' ORDER BY height ASC LIMIT ?',
            [startHeight, count]);

        const blocks: ILoadedRawBlock[] = rows.map(row => {
            return {
                hash: row.hash,
                blob: row.data,
                transactions: []
            };
        });

        for (const block of blocks) {
            const [, txnRows] = await this.m_db.query(
                'SELECT data FROM transactions WHERE block_hash = ? AND coinbase = 0',
                [block.hash]);

            for (const txn of txnRows) {
                block.transactions.push(txn.data);
            }
        }

        const result: TurtleCoindInterfaces.IRawSync = {
            blocks: blocks.map(block => {
                return {
                    blob: block.blob,
                    transactions: block.transactions
                };
            }),
            synced: (blocks.length === 0)
        };

        if (blocks.length === 0) {
            result.topBlock = {
                hash: topBlockHeader.hash,
                height: topBlockHeader.height
            };
        }

        return result;
    }

    /**
     * Retrieves the RawTransaction from the node for the specified transaction
     * Requires the daemon to have the explorer enabled
     * @param hash the transaction hash
     */
    public async rawTransaction (hash: string): Promise<string> {
        const [count, rows] = await this.m_db.query(
            'SELECT data FROM transactions WHERE hash = ?',
            [hash]);

        if (count === 0) {
            throw new ReferenceError('Transaction not found: ' + hash);
        }

        return rows[0].data;
    }

    /**
     * Retrieves the RawTransactions currently in the memory pool
     * Requires the daemon to have the explorer enabled
     */
    public async rawTransactionPool (): Promise<string[]> {
        const [, rows] = await this.m_db.query('SELECT data FROM transaction_pool');

        return rows.map(row => row.data);
    }

    /**
     * Submits a block to the node for processing
     * THIS METHOD IS NOT AVAILABLE IN THIS IMPLEMENTATION
     * @param block the hex representation of the block
     */
    public async submitBlock (block: string): Promise<string> {
        UNUSED(block);

        throw new Error('Method not available');
    }

    /**
     * Submits a transaction to the node for processing.
     * THIS METHOD IS NOT AVAILABLE IN THIS IMPLEMENTATION
     * @param transaction the hex representation of the transaction
     */
    public async submitTransaction (transaction: string): Promise<string> {
        UNUSED(transaction);

        throw new Error('Method not available');
    }

    /**
     * Retrieves the information necessary for syncing a wallet (or other utility) against the node
     * @param checkpoints a list of block hashes that we know about in descending height order
     * @param height the height to start syncing from
     * @param timestamp the timestamp to start syncing from
     * @param skipCoinbaseTransactions whether we should skip blocks that only include coinbase transactions
     * @param count the number of blocks to return
     */
    public async sync (
        checkpoints: string[] = [],
        height = 0,
        timestamp = 0,
        skipCoinbaseTransactions = false,
        count = 100
    ): Promise<TurtleCoindInterfaces.ISync> {
        const startHeight = await this.getSyncHeight(checkpoints, height, timestamp);

        const topBlockHeader = await this.lastBlockHeader();

        const skip = (skipCoinbaseTransactions) ? ' AND transactionsCount > 1 ' : '';

        const blocks: TurtleCoindInterfaces.ISyncBlock[] = [];

        const [, rows] = await this.m_db.query(
            'SELECT blocks.hash AS hash, data FROM blocks LEFT JOIN blockchain ON blockchain.hash = blocks.hash ' +
            'WHERE height >= ? ' + skip + ' ORDER BY height ASC LIMIT ?', [startHeight, count]);

        for (const row of rows) {
            const block = await Block.from(row.data);

            const temp: TurtleCoindInterfaces.ISyncBlock = {
                height: block.height,
                hash: row.hash,
                timestamp: block.timestamp,
                transactions: []
            };

            if (!skipCoinbaseTransactions) {
                temp.coinbaseTX = {
                    hash: await block.minerTransaction.hash(),
                    outputs: block.minerTransaction.outputs.map(elem => {
                        const output = (elem as KeyOutput);

                        return {
                            amount: output.amount.toJSNumber(),
                            key: output.key
                        };
                    }),
                    publicKey: block.minerTransaction.publicKey || '',
                    unlockTime: (typeof block.minerTransaction.unlockTime === 'number')
                        ? BigInteger(block.minerTransaction.unlockTime) : block.minerTransaction.unlockTime
                };
            }

            blocks.push(temp);
        }

        for (const block of blocks) {
            const [, txnRows] = await this.m_db.query(
                'SELECT hash, data FROM transactions WHERE block_hash = ? AND coinbase = 0',
                [block.hash]);

            for (const txn of txnRows) {
                const tx = await Transaction.from(txn.data);

                const temp: TurtleCoindInterfaces.ISyncTransaction = {
                    hash: txn.hash,
                    inputs: tx.inputs.map(elem => {
                        const input = (elem as KeyInput);

                        return {
                            amount: input.amount.toJSNumber(),
                            keyImage: input.keyImage
                        };
                    }),
                    outputs: tx.outputs.map(elem => {
                        const output = (elem as KeyOutput);

                        return {
                            amount: output.amount.toJSNumber(),
                            key: output.key
                        };
                    }),
                    paymentId: tx.paymentId || '',
                    publicKey: tx.publicKey || '',
                    unlockTime: (typeof tx.unlockTime === 'number') ? BigInteger(tx.unlockTime) : tx.unlockTime
                };

                block.transactions.push(temp);
            }
        }

        const result: TurtleCoindInterfaces.ISync = {
            blocks: blocks,
            synced: (blocks.length === 0)
        };

        if (blocks.length === 0) {
            result.topBlock = {
                hash: topBlockHeader.hash,
                height: topBlockHeader.height
            };
        }

        return result;
    }

    /**
     * Retrieves the transaction information for the specified transaction
     * Requires the daemon to have the explorer enabled
     * @param hash the transaction hash
     */
    public async transaction (hash: string): Promise<TurtleCoindInterfaces.ITransaction> {
        const tx = await this.getTransaction(hash);

        const block_hash = await this.getBlockHashByTransaction(hash);

        const block_header = await this.getBlockHeader(block_hash);

        const txn_meta = await this.getTransactionMeta(hash);

        let ringSize = 0;

        for (const sigs of tx.signatures) {
            if (sigs.length > ringSize) {
                ringSize = sigs.length;
            }
        }

        const inputs: TurtleCoindInterfaces.ITransactionPrefixInput[] = [];

        for (const input of tx.inputs) {
            if (input.type === InputType.COINBASE) {
                const _input = (input as CoinbaseInput);

                inputs.push({
                    height: _input.blockIndex,
                    type: 'ff'
                });
            } else if (input.type === InputType.KEY) {
                const _input = (input as KeyInput);

                inputs.push({
                    amount: _input.amount.toJSNumber(),
                    keyImage: _input.keyImage,
                    offsets: _input.keyOffsets.map(elem => elem.toJSNumber()),
                    type: '02'
                });
            }
        }

        const outputs: TurtleCoindInterfaces.ITransactionPrefixOutput[] = [];

        for (const output of tx.outputs) {
            if (output.type === OutputType.KEY) {
                const _output = (output as KeyOutput);

                outputs.push({
                    amount: _output.amount.toJSNumber(),
                    key: _output.key,
                    type: '02'
                });
            }
        }

        return {
            block: block_header,
            prefix: {
                extra: tx.extra.toString('hex'),
                inputs: inputs,
                outputs: outputs,
                unlockTime: (typeof tx.unlockTime === 'number') ? BigInteger(tx.unlockTime) : tx.unlockTime,
                version: tx.version
            },
            meta: {
                amountOut: txn_meta.amountOut,
                fee: tx.fee,
                paymentId: tx.paymentId || '',
                publicKey: tx.publicKey || '',
                ringSize: ringSize,
                size: tx.size
            }
        };
    }

    /**
     * Retrieves the transaction summary information for the transactions currently
     * Requires the daemon to have the explorer enabled
     * in the memory pool
     */
    public async transactionPool (): Promise<TurtleCoindInterfaces.TransactionSummary[]> {
        const [, rows] = await this.m_db.query('SELECT hash, fee, size, amount FROM transaction_pool');

        return rows.map(row => {
            return {
                amountOut: parseInt(row.amount, 10),
                fee: parseInt(row.fee, 10),
                hash: row.hash,
                size: parseInt(row.size, 10)
            };
        });
    }

    /**
     * Gets the transaction memory pool changes given the last known block hash and
     * the transactions we last knew to be in the memory pool
     * @param lastKnownBlock the last known block hash
     * @param transactions an array of transaction hashes we last saw in the memory pool
     */
    public async transactionPoolChanges (
        lastKnownBlock: string,
        transactions: string[]
    ): Promise<TurtleCoindInterfaces.ITransactionPoolDelta> {
        const topBlockHeader = await this.lastBlockHeader();

        const [, rows] = await this.m_db.query('SELECT hash, data FROM transaction_pool');

        const poolHashes: string[] = rows.map(elem => elem.hash);

        const added = rows.filter(row => transactions.indexOf(row.hash) !== -1)
            .map(row => row.data);

        const deleted = transactions.filter(hash => poolHashes.indexOf(hash) === -1);

        return {
            added: added,
            deleted: deleted,
            synced: (lastKnownBlock === topBlockHeader.hash)
        };
    }

    /**
     * Retrieves information on where the specified transactions are located
     * @param transactions an array of transaction hashes
     */
    public async transactionsStatus (transactions: string[]): Promise<TurtleCoindInterfaces.ITransactionsStatus> {
        const result: TurtleCoindInterfaces.ITransactionsStatus = {
            inBlock: [],
            inPool: [],
            notFound: []
        };

        for (const hash of transactions) {
            let [count] = await this.m_db.query(
                'SELECT hash FROM transaction_pool WHERE hash = ?',
                [hash]);

            if (count === 1) {
                result.inPool.push(hash);

                continue;
            }

            [count] = await this.m_db.query(
                'SELECT hash FROM transactions WHERE hash = ?',
                [hash]);

            if (count === 1) {
                result.inBlock.push(hash);

                continue;
            }

            result.notFound.push(hash);
        }

        return result;
    }
}

/** @ignore */
function UNUSED (val: any): any {
    return val || '';
}

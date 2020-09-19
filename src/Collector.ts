// Copyright (c) 2018-2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { TurtleCoind, TurtleCoindTypes as TurtleCoindInterfaces } from 'turtlecoin-utils';
import { BlockchainDB } from './BlockchainDB';
import { IDatabase } from 'db-abstraction';
import { EventEmitter } from 'events';
import { Logger, addLog } from './Logger';
import { Metronome } from 'node-metronome';
import { PerformanceTimer } from './PerformanceTimer';

/**
 * Represents an instance of a blockchain collector
 */
export class Collector extends EventEmitter {
    private readonly database: BlockchainDB;
    private readonly rpc: TurtleCoind;
    private readonly informationTimer: Metronome;
    private readonly transactionPoolTimer: Metronome;
    private readonly syncTimer: Metronome;
    private m_destroyed = false;
    private m_running = false;

    /**
     * Constructs a new instance of the collector
     * @param database the underlying database to use
     * @param daemonHost the daemon host/ip to use for synchronization
     * @param daemonPort the daemon port to use for synchronization
     * @param daemonSSL whether the daemon specified uses SSL/TLS
     */
    constructor (
        database: IDatabase,
        daemonHost = '127.0.0.1',
        daemonPort = 11898,
        daemonSSL = false
    ) {
        super();

        this.database = new BlockchainDB(database);

        this.rpc = new TurtleCoind(daemonHost, daemonPort, undefined, daemonSSL);

        this.informationTimer = new Metronome(5000, true);

        this.transactionPoolTimer = new Metronome(5000, true);

        this.syncTimer = new Metronome(5000, true);
    }

    /**
     * Returns whether the instance is currently running
     */
    public get running (): boolean {
        return this.m_running;
    }

    /**
     * Returns whether the instance is destroyed
     */
    public get destroyed (): boolean {
        return this.m_destroyed;
    }

    /**
     * Starts the collector
     */
    public async init (): Promise<void> {
        if (this.destroyed) {
            throw new Error('Instance has been destroyed. Please initiate a new instance');
        } else if (this.running) {
            throw new Error('Instance is already running');
        }

        await this.database.init();

        this.m_running = true;

        Logger.info('Database connection established...');

        let [consistency, inconsistentRows] = await this.database.checkConsistency();

        while (!consistency) {
            Logger.warn('Database consistency check failed... attempting recovery...');

            let lowestHeight = Number.MAX_SAFE_INTEGER;

            for (const hash of inconsistentRows) {
                const height = await this.database.heightFromHash(hash);

                if (height < lowestHeight) {
                    lowestHeight = height;
                }
            }

            Logger.warn('Attempting rewind of database to: %s', lowestHeight);

            await this.database.rewind(lowestHeight);

            [consistency, inconsistentRows] = await this.database.checkConsistency();

            Logger.debug('Database consistency state is now %s',
                (consistency) ? 'valid' : 'invalid');
        }

        Logger.info('Database consistency verified!');

        if (!await this.database.haveGenesis()) {
            const genesis = await this.rpc.rawBlock(0);

            Logger.debug('Collected genesis block from daemon');

            const genesisMeta = await this.rpc.block(0);

            Logger.debug('Collected genesis block header from daemon');

            const indexes = await this.rpc.indexes(0, 0);

            Logger.debug('Collected genesis transaction output indexes from daemon');

            await this.database.saveRawBlocks([genesis]);

            Logger.debug('Saved the genesis raw block to the database');

            await this.database.saveBlocksMeta([genesisMeta]);

            Logger.debug('Saved the genesis block header to the database');

            await this.database.saveOutputGlobalIndexes(indexes);

            Logger.debug('Saved the genesis transaction output indexes to the database');

            Logger.info('Collected genesis block: %s', genesisMeta.hash);
        }

        this.informationTimer.on('tick', async () => {
            try {
                const info = await this.rpc.info();

                await this.database.saveInformation(info);

                Logger.debug('Saved current daemon /info');
            } catch (e) {
                Logger.warn('Could not save daemon /info: %s', e.toString());
            }
        });

        this.informationTimer.on('tick', async () => {
            try {
                const peers = await this.rpc.peers();

                await this.database.savePeers(peers);

                Logger.debug('Saved current daemon /peers');
            } catch (e) {
                Logger.warn('Could not save daemon /peers: %s', e.toString());
            }
        });

        this.transactionPoolTimer.on('tick', async () => {
            try {
                const transactions = await this.rpc.rawTransactionPool();

                await this.database.saveTransactionPool(transactions);

                Logger.info('Saved current transaction pool: %s transactions', transactions.length);
            } catch (e) {
                Logger.warn('Could not save current transaction pool: %s', e.toString());
            }
        });

        this.syncTimer.on('tick', async () => {
            // Pause while running to prevent overrunning ourselves
            this.syncTimer.paused = true;

            const timer = new PerformanceTimer();

            const checkpoints = await this.database.hashesForSync();

            const lastKnownBlock = await this.database.getBlock(checkpoints[0]);

            let minHeight: number = lastKnownBlock.height;

            Logger.debug('Database last known block height: %s', minHeight);

            let maxHeight = 0;

            Logger.debug('Requesting raw blocks from daemon using %s checkpoints', checkpoints.length);

            const syncResults = await this.rpc.rawSync(checkpoints);

            Logger.debug('Daemon reports that we are currently %s and returned %s blocks',
                (syncResults.synced) ? 'synced' : 'not synced',
                syncResults.blocks.length);

            try {
                const [blockHeights, blockHashes] =
                    await this.database.saveRawBlocks(syncResults.blocks);

                Logger.debug('Saved raw blocks to database: %s', blockHeights.length);

                [minHeight, maxHeight] = (() => {
                    if (blockHeights.length === 0) {
                        return [0, 0];
                    }

                    return [blockHeights[0], blockHeights[blockHeights.length - 1]];
                })();

                Logger.debug('Saved blocks start: %s and end: %s', minHeight, maxHeight);

                /* Sure, we could go get the meta data for the blocks one at a time but lets face it
                   multiple requests in sequence for this data is just a pain to handle */
                const promises = [];

                for (let i = maxHeight; i > minHeight; i -= 30) {
                    const headerHeight = (i < minHeight) ? minHeight : i;

                    promises.push(this.rpc.blockHeaders(headerHeight));

                    Logger.debug('Retrieving block headers to: %s', headerHeight);
                }

                const metaResults = await Promise.all(promises);

                const headers: TurtleCoindInterfaces.IBlock[] = [];

                const headerExists = (hash: string) => {
                    return headers.filter(elem => elem.hash === hash).length !== 0;
                };

                // Loop the meta results into a single dimension
                for (const metaResult of metaResults) {
                    for (const header of metaResult) {
                        if (blockHashes.indexOf(header.hash) !== -1 &&
                            !headerExists(header.hash)) {
                            headers.push(header);
                        }
                    }
                }

                Logger.debug('Received %s block headers from daemon', headers.length);

                await this.database.saveBlocksMeta(headers);

                Logger.debug('Saved %s block headers to database', headers.length);

                const indexes = await this.rpc.indexes(minHeight, maxHeight);

                Logger.debug('Retrieved global indexes for %s transactions', indexes.length);

                await this.database.saveOutputGlobalIndexes(indexes);

                Logger.debug('Saved global indexes for %s transactions to the database', indexes.length);

                Logger.info('Saved %s blocks to database: %s to %s [%ss]',
                    blockHeights.length, minHeight, maxHeight, timer.elapsed.seconds.toFixed(2));
            } catch (e) {
                console.log(e);
                // If anything fails here, rewind it all
                Logger.error('Something broke... to prevent data inconsistency we are ' +
                    'rewinding database to block %s: %s', minHeight, e.toString());

                await this.database.rewind(minHeight);
            } finally {
                // Unpause as this iteration of the loop is done
                this.syncTimer.paused = false;
            }
        });
    }

    /**
     * Stops the collector. Once stopped, a new instance must be created.
     */
    public async stop (): Promise<void> {
        this.syncTimer.destroy();

        this.transactionPoolTimer.destroy();

        this.informationTimer.destroy();

        this.m_destroyed = true;

        return this.database.close();
    }

    /**
     * Allows for adding an additional file based log
     * @param filename the filename to save the log to
     * @param level the minimum level to log
     */
    public addLog (filename: string, level?: string): void {
        addLog(filename, level);
    }
}

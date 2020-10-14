// Copyright (c) 2018-2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { IDatabase } from 'db-abstraction';
import { RabbitMQ, getConnectionParameters } from '@turtlepay/rabbitmq';
import { TurtleCoindTypes as TurtleCoindInterfaces } from 'turtlecoin-utils';
import { Logger } from '@turtlepay/logger';
import { saveRawBlock } from './Statements';

/** @ignore */
export interface SaveRawBlockResponse {
    height: number;
    hash: string;
    txnCount: number;
}

/** @ignore */
export class RawBlockWorker {
    private readonly m_db: IDatabase;
    private m_rabbit?: RabbitMQ;
    private readonly m_queue: string;
    private readonly m_timeout: number = 600;

    constructor (database: IDatabase, queue: string) {
        this.m_db = database;

        this.m_queue = queue;
    }

    /**
     * Sends a raw block to a worker for processing via RabbitMQ
     * @param block the raw block to process
     */
    public async saveRawBlock (block: TurtleCoindInterfaces.IRawBlock): Promise<SaveRawBlockResponse> {
        if (this.m_rabbit) {
            return this.m_rabbit.requestReply<TurtleCoindInterfaces.IRawBlock, SaveRawBlockResponse>(
                this.m_queue, block, this.m_timeout * 1000, true);
        }

        throw new Error('RabbitMQ connection is not initialized');
    }

    /**
     * Attempts to start the processing queues for the RabbitMQ worker
     */
    public async start () {
        if (this.m_rabbit) {
            Logger.warn('Creating queue...');

            await this.m_rabbit.createQueue(this.m_queue, true, false);

            Logger.warn('Created...');

            await this.m_rabbit.registerConsumer<TurtleCoindInterfaces.IRawBlock>(this.m_queue, 1);

            this.m_rabbit.on<TurtleCoindInterfaces.IRawBlock>('message',
                async (queue, message, payload) => {
                    if (queue === this.m_queue && this.m_rabbit) {
                        Logger.debug('Received request to process block...');

                        try {
                            const result = await saveRawBlock(this.m_db, payload);

                            const success = await this.m_rabbit.reply<SaveRawBlockResponse>(message, result);

                            if (success) {
                                return this.m_rabbit.ack(message);
                            }

                            return this.m_rabbit.nack(message);
                        } catch {
                            return this.m_rabbit.nack(message);
                        }
                    }
                });
        }
    }

    /**
     * Initializes the connection to RabbitMQ
     */
    public async init () {
        if (!this.m_rabbit) {
            const rabbit = getConnectionParameters();

            this.m_rabbit = new RabbitMQ(rabbit.host, rabbit.user, rabbit.pass, true);

            this.m_rabbit.on('log', error => Logger.error(error.toString()));

            await this.m_rabbit.connect();
        }
    }
}

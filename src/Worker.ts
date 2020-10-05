// Copyright (c) 2018-2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { IDatabase } from 'db-abstraction';
import { RabbitMQ, getConnectionParameters } from '@turtlepay/rabbitmq';
import { TurtleCoindTypes as TurtleCoindInterfaces } from 'turtlecoin-utils';
import { Logger } from './Logger';
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
    private readonly m_rabbit: RabbitMQ;
    private readonly m_queue: string;
    private readonly m_timeout: number = 600;

    constructor (database: IDatabase, queue: string) {
        this.m_db = database;

        this.m_queue = queue;

        const rabbit = getConnectionParameters();

        this.m_rabbit = new RabbitMQ(rabbit.host, rabbit.user, rabbit.pass, true);

        this.m_rabbit.on('log', error => Logger.error(error.toString()));
    }

    public async saveRawBlock (block: TurtleCoindInterfaces.IRawBlock): Promise<SaveRawBlockResponse> {
        return this.m_rabbit.requestReply<TurtleCoindInterfaces.IRawBlock, SaveRawBlockResponse>(
            this.m_queue, block, this.m_timeout * 1000, true);
    }

    public async start () {
        Logger.warn('Creating queue...');
        await this.m_rabbit.createQueue(this.m_queue, true, false);
        Logger.warn('Created...');

        await this.m_rabbit.registerConsumer<TurtleCoindInterfaces.IRawBlock>(this.m_queue, 1);

        this.m_rabbit.on<TurtleCoindInterfaces.IRawBlock>('message',
            async (queue, message, payload) => {
                if (queue === this.m_queue) {
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

    public async init () {
        await this.m_rabbit.connect();
    }

    public static async init (database: IDatabase, queue: string): Promise<RawBlockWorker> {
        const worker = new RawBlockWorker(database, queue);

        await worker.init();

        return worker;
    }
}

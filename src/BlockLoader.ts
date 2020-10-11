// Copyright (c) 2018-2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import {
    Block,
    Transaction,
    TransactionInputs,
    TransactionOutputs,
    TurtleCoindTypes as TurtleCoindInterfaces
} from 'turtlecoin-utils';
import { Interfaces as DBInterfaces } from 'db-abstraction';
import { PerformanceTimer } from './PerformanceTimer';
import { Logger } from '@turtlepay/logger';

/** @ignore */
import IValueArray = DBInterfaces.IValueArray;

/** @ignore */
export interface ILoadedBlock extends Block {
    txns?: Transaction[];
}

/** @ignore */
export interface ProcessedBlock {
    height: number;
    hash: string;
    blocks: IValueArray;
    blockchain: IValueArray;
    transactions: IValueArray;
    transaction_meta: IValueArray;
    inputs: IValueArray;
    outputs: IValueArray;
    paymentIds: IValueArray;
}

/** @ignore */
export async function loadRawBlock (rawBlock: TurtleCoindInterfaces.IRawBlock): Promise<ILoadedBlock> {
    const block: ILoadedBlock = await Block.from(rawBlock.blob);

    const timer = new PerformanceTimer();

    // calculate the hash so it becomes cached
    await block.hash();

    // calculate the hash so it becomes cached
    await block.minerTransaction.hash();

    Logger.debug('Block %s decoded successfully in %s seconds',
        await block.hash(), timer.elapsed.seconds.toFixed(2));

    block.txns = [block.minerTransaction];

    const loadTransaction = async (txn: string): Promise<Transaction> => {
        const timer = new PerformanceTimer();

        const tx = await Transaction.from(txn);

        await tx.hash();

        Logger.debug('Transaction %s decoded successfully in %s seconds',
            await tx.hash(), timer.elapsed.seconds.toFixed(2));

        return tx;
    };

    const txns = await Promise.all(rawBlock.transactions.map(tx => loadTransaction(tx)));

    for (const tx of txns) {
        block.txns.push(tx);
    }

    Logger.debug('Loaded raw block %s in %s seconds',
        await block.hash(), timer.elapsed.seconds.toFixed(2));

    return block;
}

/** @ignore */
export async function processBlock (block: ILoadedBlock): Promise<ProcessedBlock> {
    const timer = new PerformanceTimer();

    const result: ProcessedBlock = {
        height: block.height,
        hash: await block.hash(),
        blocks: [],
        blockchain: [],
        transactions: [],
        transaction_meta: [],
        inputs: [],
        outputs: [],
        paymentIds: []
    };

    result.blocks.push([await block.hash(), block.toString()]);

    result.blockchain.push([block.height, await block.hash(), block.timestamp.getTime() / 1000]);

    if (block.txns) {
        for (const tx of block.txns) {
            result.transactions.push([
                await tx.hash(),
                await block.hash(),
                (tx.isCoinbase) ? 1 : 0,
                tx.toString()]);

            result.transaction_meta.push([await tx.hash(), tx.fee, tx.amount, tx.size]);

            for (const input of tx.inputs) {
                if (input.type === TransactionInputs.InputType.KEY) {
                    result.inputs.push([
                        await tx.hash(),
                        (input as TransactionInputs.KeyInput).keyImage]);
                }
            }

            for (let i = 0; i < tx.outputs.length; i++) {
                const output = (tx.outputs[i] as TransactionOutputs.KeyOutput);

                if (output.type === TransactionOutputs.OutputType.KEY) {
                    result.outputs.push([
                        await tx.hash(), i, output.amount.toJSNumber(), output.key]);
                }
            }

            if (tx.paymentId) {
                result.paymentIds.push([await tx.hash(), tx.paymentId]);
            }
        }
    }

    Logger.debug('Block %s processed in %s seconds',
        await block.hash(), timer.elapsed.seconds.toFixed(2));

    return result;
}

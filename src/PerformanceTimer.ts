// Copyright (c) 2020, TurtlePay Developers
//
// Please see the included LICENSE file for more information.

import { performance } from 'perf_hooks';

/** @ignore */
export class PerformanceTimer {
    private readonly start = performance.now();

    /**
     * Returns the elapsed time since the instance was created
     */
    public get elapsed (): { milliseconds: number, seconds: number } {
        const delta = Math.round(performance.now() - this.start);

        return {
            milliseconds: delta,
            seconds: parseFloat((delta / 1000).toFixed(2))
        };
    }
}

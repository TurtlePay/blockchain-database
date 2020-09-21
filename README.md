# TurtlePay® Blockchain Database Abstraction Layer

![Prerequisite](https://img.shields.io/badge/node-%3E%3D12-blue.svg) [![Documentation](https://img.shields.io/badge/documentation-yes-brightgreen.svg)](https://github.com/TurtlePay/blockchain-database#readme) [![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/TurtlePay/blockchain-database/graphs/commit-activity) [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-yellow.svg)](https://github.com/TurtlePay/blockchain-database/blob/master/LICENSE) [![Twitter: TurtlePay](https://img.shields.io/twitter/follow/TurtlePay.svg?style=social)](https://twitter.com/TurtlePay)

[![NPM](https://nodeico.herokuapp.com/@turtlepay/database.svg)](https://npmjs.com/package/@turtlepay/database)

#### Master Build Status
[![Build Status](https://github.com/turtlepay/blockchain-database/workflows/CI%20Build%20Tests/badge.svg?branch=master)](https://github.com/turtlepay/blockchain-database/actions)

#### Development Build Status
[![Build Status](https://github.com/turtlepay/blockchain-database/workflows/CI%20Build%20Tests/badge.svg?branch=development)](https://github.com/turtlepay/blockchain-database/actions)

## Overview

Provides a mechanism and interface for storing the TurtleCoin® blockchain in a relational database.

## Prerequisites

- TurtleCoin® >= 1.0.0
- node >= 12
- One of the following DBMS
    - MariaDB/MySQL with InnoDB support
    - Postgres *or* a Postgres compatible SQL interface
    - SQLite (built-in)

## Hardware Requirements

Requirements vary depending on what DBMS you use; however, generally speaking, for the best performance as of **September 15, 2020**, your DBMS must have the minimum of the following:

* 256GB RAM
  * 224GB dedicated to MariaDB/MySQL
* 8 CPU Cores (16 Recommended)
* SSD Storage

**Note**: Its possible and advisable that in lieu of operating large systems that you utilize a DBMS that allows for sharding/clustering and load balancing connections to the system(s). Please refer to your DBMS documentation for more information.

***Warning***: Running the DB on system(s) with less than the minimum hardware requirements above will cause performance issues. If you are experiencing issues please verify that the system you are using meets the minimum requirements above. We cannot assist with performance issues with implementations that do not meet the above minimum requirements.

## Recommended Reading

The help tune your selected DBMS, we recommend that you read the following documents, at a minimum, to tune your DBMS installation for the dataset this package manages.

This list is by no means comprehensive nor do we guarantee the information or suggestions provided in the articles below are accurate. These links are provided solely as a jumping off point to get you started.

* [MySQL 5.7 Performance Tuning After Installation](https://www.percona.com/blog/2016/10/12/mysql-5-7-performance-tuning-immediately-after-installation/)
* [InnoDB Performance Optimization Basics](https://www.percona.com/blog/2013/09/20/innodb-performance-optimization-basics-updated/)
* [Optimizing InnoDB Disk I/O](https://dev.mysql.com/doc/refman/8.0/en/optimizing-innodb-diskio.html)
* [Optimizing InnoDB Configuration Variables](https://dev.mysql.com/doc/refman/8.0/en/optimizing-innodb-configuration-variables.html)
* [15 Useful MySQL/MariaDB Performance Tuning and Optimization Tips](https://www.tecmint.com/mysql-mariadb-performance-tuning-and-optimization/)
* [InnoDB Performance Optimisation](https://www.slideshare.net/MyDBOPS/innodb-performance-optimisation)

**Note**: If using a DBMS other than MySQL/MariaDB, please refer to your DBMS documentation for performance tuning information.

## Documentation

Full library documentation is available at [https://database.turtlepay.io](https://database.turtlepay.io)

## Install

```sh
yarn install turtlepay-blockchain-database
```

## Usage

#### MySQL/MariaDB

1) Set your environment variables and start the service up

```sh
export USE_MYSQL=true
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=yourdbusername
export DB_PASS=yourdbpassword
export DB_NAME=turtlecoin
export NODE_HOST=localhost
export NODE_PORT=11898
export NODE_SSL=0
yarn start
```

#### Postgres

1) Set your environment variables and start the service up

```sh
export USE_POSTGRES=true
export DB_HOST=localhost
export DB_PORT=3306
export DB_USER=yourdbusername
export DB_PASS=yourdbpassword
export DB_NAME=turtlecoin
export NODE_HOST=localhost
export NODE_PORT=11898
export NODE_SSL=0
yarn start
```

#### SQLite

1) Set your environment variables and start the service up

```sh
export USE_SQLITE=true
export SQLITE_PATH=turtlecoin.sqlite3
export NODE_HOST=localhost
export NODE_PORT=11898
export NODE_SSL=0
yarn start
```

## Run tests

```sh
yarn test
```

## Author

👤 **TurtlePay® Development Team**

* Twitter: [@TurtlePay](https://twitter.com/TurtlePay)
* Github: [@TurtlePay](https://github.com/TurtlePay)

## 🤝 Contributing

Contributions, issues and feature requests are welcome!

Feel free to check [issues page](https://github.com/TurtlePay/blockchain-database/issues).

## Show your support

Give a ⭐️ if this project helped you!


## 📝 License

Copyright © 2018-2020 [TurtlePay® Development Team](https://github.com/TurtlePay).

This project is [AGPL-3.0](https://github.com/TurtlePay/blockchain-database/blob/master/LICENSE) licensed.

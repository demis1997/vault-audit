// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

//import 'hardhat/console.sol';   // just for debugging

import './EVaultCampaign.sol';

/**
Wrapper for unit tests to allow setting block number for block reward specific testing
 */
contract TestEVaultCampaign is EVaultCampaign {
    uint256 private blockNumber;
    uint256 private blockTimestamp;

    constructor(address subscriptionNftAddress, uint256 freezingThresholdLimit, uint256 maxFreezableAmount)
        EVaultCampaign(subscriptionNftAddress, freezingThresholdLimit, maxFreezableAmount) {}

    function setBlockNumber(uint256 _blockNumber)
      public {
        blockNumber = _blockNumber;
    }
    
    function getBlockNumber()
      internal virtual override view returns (uint256) {
        if (blockNumber == 0)
            return block.number;

        return blockNumber;
    }

    function GetBlockNumber()
      public view returns (uint256) {
        return getBlockNumber();
    }

    function setBlockTimestamp(uint256 _blockTimestamp)
      public {
        blockTimestamp = _blockTimestamp;
    }

    function getBlockTimestamp()
      internal virtual override view returns (uint256) {
        if (blockTimestamp == 0)
            return block.timestamp;

        return blockTimestamp;
    }

    function GetBlockTimestamp()
      public view returns (uint256) {
        return getBlockTimestamp();
    }
}
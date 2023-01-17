// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

//import 'hardhat/console.sol';   // just for debugging

import './EVaultCampaign.sol';

/**
Wrapper for unit tests to allow setting block number for block reward specific testing
 */
contract TestEVaultCampaignWithReducedLocking is EVaultCampaign {
    uint256 private blockNumber;
    uint256 private freezingPeriodInSeconds;

    constructor(
      address subscriptionNftAddress, 
      uint256 freezingThresholdLimit,
      uint256 maxFreezableAmount,
      uint _freezingPeriodInSeconds)
        EVaultCampaign(subscriptionNftAddress, freezingThresholdLimit, maxFreezableAmount) {
          freezingPeriodInSeconds = _freezingPeriodInSeconds;
        }

    function setBlockNumber(uint256 _blockNumber)
      internal {
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

    function getFreezingPeriodInSeconds()
      internal virtual override view returns (uint256) {
        return freezingPeriodInSeconds;
    }

    function GetFreezingPeriodInSeconds()
      public view returns (uint256) {
        return getFreezingPeriodInSeconds();
    }
}
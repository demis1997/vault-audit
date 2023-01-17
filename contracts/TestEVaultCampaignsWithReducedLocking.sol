// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import './EVaultCampaigns.sol';
import './TestEVaultCampaignWithReducedLocking.sol';

/// @dev Test wrapper for EVaultCampaigns that references TestEVaultCampaign instead of EVaultCampaign for setBlockNumber() support.
contract TestEVaultCampaignsWithReducedLocking is EVaultCampaigns {
    uint private freezingPeriodInSeconds;

    constructor(address _subscriptionNftAddress, uint _freezingPeriodInSeconds)
        EVaultCampaigns(_subscriptionNftAddress) {
        freezingPeriodInSeconds = _freezingPeriodInSeconds;
    }

    function createCampaign(uint256 freezingThresholdLimit, uint256 maxFreezableAmount) 
        internal virtual override returns (address) {
            EVaultCampaign campaign = new TestEVaultCampaignWithReducedLocking(
                subscriptionNftAddress, 
                freezingThresholdLimit,
                maxFreezableAmount,
                freezingPeriodInSeconds);

            return address(campaign);
    }

    function getFreezingPeriodInSeconds()
      public view returns (uint256) {
        return freezingPeriodInSeconds;
    }
}
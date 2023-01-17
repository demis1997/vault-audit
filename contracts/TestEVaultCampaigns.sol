// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import './EVaultCampaigns.sol';
import './TestEVaultCampaign.sol';

/// @dev Test wrapper for EVaultCampaigns that references TestEVaultCampaign instead of EVaultCampaign for setBlockNumber() support.
contract TestEVaultCampaigns is EVaultCampaigns {
    constructor (address _subscriptionNftAddress)
        EVaultCampaigns(_subscriptionNftAddress) { }

    function createCampaign (uint256 freezingThresholdLimit, uint256 maxFreezableAmount) 
        internal virtual override returns (address) {
            EVaultCampaign campaign = new TestEVaultCampaign(subscriptionNftAddress, freezingThresholdLimit, maxFreezableAmount);
            return address(campaign);
    }
}
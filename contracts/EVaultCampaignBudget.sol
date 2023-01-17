// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import '@openzeppelin/contracts/access/Ownable.sol';

//import 'hardhat/console.sol';   // just for debugging

/// @dev Holds the budget funds and acts as the source for the rewards given by a campaign
contract EVaultCampaignBudget is Ownable {
    uint256 private reservedBudget;  // the budget reserved by all freezings of the campaign

    event CampaignFunded(
        uint256 amount
    );

    /// @dev Stores the funds for a campaign. Anyvody can fund a campaign.
    function fund() public payable {
        emit CampaignFunded(msg.value);
    }

    /// @dev Returns the funds currently reserved by all freezings of the campaign
    function getReservedAmount() external view returns (uint256) {
        return reservedBudget;
    }

    /// @dev Returns the funds available of the campaign
    function getAvailableAmount() external view returns (uint256) {
        return address(this).balance - reservedBudget;
    }

    /// @dev Reserves the funds upon freezing in the campaign. Only to be called from theCampaign contract!
    function reserve(uint256 amount) external onlyOwner {
        // reserves the total rewards for one year by marking it as reserved, should be callable only from campaign contract that the budget contract belongs to!
        reservedBudget += amount;
    }

    /// @dev Sends the rewards calculated by Campaign contract to the claimer. Only to be called from the Campaign contract!
    function claimRewards(address payable claimer, uint256 amount) external onlyOwner {
        reservedBudget -= amount;   // we need to substract here so that getAvailableAmount() is not reduced twice due to balance change (paying rewards)!
        claimer.transfer(amount);
    }
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/access/AccessControl.sol";
import './EVaultCampaign.sol';

//import 'hardhat/console.sol';   // just for debugging

/// @dev wrapper for the wallet orchestrating calls to all campaigns
contract EVaultCampaigns is AccessControl {
    bytes32 public constant CAMPAIGN_CREATOR_ROLE = keccak256('CAMPAIGN_CREATOR_ROLE');

    uint private activeCampaignId;
    mapping(uint => address) private campaigns;
    address internal immutable subscriptionNftAddress;

    constructor (address _subscriptionNftAddress) {
        subscriptionNftAddress = _subscriptionNftAddress;

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setRoleAdmin(CAMPAIGN_CREATOR_ROLE, DEFAULT_ADMIN_ROLE);
    }

    /* event fired on every new EVaultCampaign deployment */
    event CampaignDeployed(address contractAddress, address budgetAddress, uint campaignId);

    /// @dev Allows someone having the CAMPAIGN_CREATOR_ROLE to create a new campaign in case the previous campaign is over (budget used).
    function addCampaign(uint256 freezingThresholdLimit, uint256 maxFreezableAmount) external onlyRole(CAMPAIGN_CREATOR_ROLE) {
        // prevent adding new campaign while another one is running!
        address activaCampaignAddress = campaigns[activeCampaignId];
        if (activaCampaignAddress != address(0)) {
            EVaultCampaign activeCampaign = EVaultCampaign(campaigns[activeCampaignId]);
            require(activeCampaign.getAvailableFreezingBudget() < 1 ether, 'addCampaign: there is another campaign still active');    // < 0 with rounding dust
        }

        address campaignAddress = createCampaign(freezingThresholdLimit, maxFreezableAmount);

        uint256 campaignId = activaCampaignAddress == address(0) ? 0 : activeCampaignId + 1;    // first campaign already created?
        campaigns[campaignId] = campaignAddress;
        activeCampaignId = campaignId;

        EVaultCampaign campaign = EVaultCampaign(campaignAddress);
        address budgetAddress = campaign.getBudgetContractAddress();

        emit CampaignDeployed(campaignAddress, budgetAddress, campaignId);
    }

    /// @dev Creates a campaign. Virtual to facilitate unit/ingration testing.
    function createCampaign(uint256 freezingThresholdLimit, uint256 maxFreezableAmount)
        internal virtual returns (address) {
            EVaultCampaign campaign = new EVaultCampaign(subscriptionNftAddress, freezingThresholdLimit, maxFreezableAmount);
            return address(campaign);
    }

    /// @dev Allows to query the contract address of the active campaign.
    function getActiveCampaignContractAddress() external view returns (address) {
        return campaigns[activeCampaignId];
    }

    /// @dev Allows to query the Id of the active campaign.
    function getActiveCampaignId() external view returns (uint256) {
        return activeCampaignId;
    }

    function getActiveCampaign() private view returns (EVaultCampaign) {
        require(campaigns[activeCampaignId] != address(0), 'no campaign created');
        return EVaultCampaign(campaigns[activeCampaignId]);
    }

    function freeze() public payable {
        EVaultCampaign activeCampaign = getActiveCampaign();
        return activeCampaign.freeze{value: msg.value}(msg.sender);
    }

    function getFreezableAmount(address claimer) external view returns (uint256) {
        EVaultCampaign activeCampaign = getActiveCampaign();
        return activeCampaign.getFreezableAmount(claimer);
    }

    /// @dev Provide wallet an opportunity to display "Frozen Balance". 
    function getTotalFrozenAmount(address claimer) external view returns (uint256 totalFrozen) {
        for (uint i; i <= activeCampaignId; i++) {
            EVaultCampaign campaign = EVaultCampaign(campaigns[i]);
            totalFrozen += campaign.getTotalFrozenAmount(claimer);
        }
    }

    function getClaimableAmount(address claimer) external view returns (uint256 totalClaimable) {
        for (uint i; i <= activeCampaignId; i++) {
            EVaultCampaign campaign = EVaultCampaign(campaigns[i]);
            totalClaimable += campaign.calculateRewardDue(claimer);
        }
    }

    function claim() external {
        for (uint i; i <= activeCampaignId; i++) {
            EVaultCampaign campaign = EVaultCampaign(campaigns[i]);
            campaign.claimForSender(msg.sender);
        }
    }

    /// @dev Delegate the getFreezeInfo into all campaigns to see whether it has the info.
    function getFreezeInfo(address claimer, uint256 blockNumber) 
        external view returns (uint256 rate, uint256 rewardDue, uint256 withdrawn) {
        for (uint i; i <= activeCampaignId; i++) {
            EVaultCampaign campaign = EVaultCampaign(campaigns[i]);
            (rate, rewardDue, withdrawn) = campaign.getFreezeInfo(claimer, blockNumber);
            if (rate != 0)  // we found it
                break;
        }
    }

    /// @dev Funds the active campaign. Funding any previous campaign does not make too much sense as wallets are always
    /// working against active campaign when FREEZING (--> only claiming is executed against all registered campaigns)
    function fund() public payable {
        EVaultCampaign activeCampaign = getActiveCampaign();
        activeCampaign.fund{value: msg.value}();
    }
}
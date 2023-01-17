// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import '@openzeppelin/contracts/access/Ownable.sol';
import './EVaultCampaign.sol';
import './EVaultCampaignBudget.sol';
import './SubscriptionNFT.sol';

//import 'hardhat/console.sol';   // just for debugging

contract EVaultCampaign is Ownable {
    uint256 private constant SECONDS_PER_YEAR = 31536000;
    uint256 private constant ONE_PERCENT_ATTO_WEI_REWARD_PER_SECOND = 317097919837646; // 1 % yearly reward for 1 ECS in 1 second. Value in Wei with additional comma for precision (31709791983.7646 Wei) Needs to be converted to wei upon reward calculation.
    uint256 private constant WEI_PRECISION = 10000;

    uint256 private immutable freezingThresholdLimit;  // if total frozen amounts reached (Budget - X ECS) then no freezings possible anymore. Used as offset in getFreezableAmount() calculation to provide some buffer to cope with "freezing" race-conditions once the budget gets close to 0.
    uint256 private immutable maxFreezableAmountPerAddress;      // to limit freezing on a particular address.
    mapping(address => FrozenAmount[]) private frozenAmounts;   // all freezings per address
    mapping(address => uint256) private totalWithdrawnByClaimer; // tracks successfully claimed rewards per address
    EVaultCampaignBudget private budget;
    SubscriptionNFT private subscriptionNFT;

    struct FrozenAmount {
        uint256 amount;
        uint256 blockNumber;
        uint256 timestamp;
        uint256 rate;
        uint256 withdrawn;
        bool returned;
    }

     /* event fired on successful claiming per frozen amount rewarded by the claim */
    event VaultReward(
        uint256 frozenAmountId,
        uint256 amount,
        uint256 rate,
        uint256 subscription
    );

    /* event fired on successful claiming for each frozen amount older than one year (and returned by claim) */
    event VaultReturn(
        uint256 frozenAmountId,
        uint256 amount
    );

    /* event fired on successful freezing */
    event VaultLock(
        uint256 frozenAmountId,
        uint256 amount,
        uint256 rate,
        uint256 subscription
    );

    constructor(address _subscriptionNftAddress, uint256 _freezingThresholdLimit, uint256 _maxFreezableAmount) {
        subscriptionNFT = SubscriptionNFT(_subscriptionNftAddress);
        freezingThresholdLimit = _freezingThresholdLimit;
        maxFreezableAmountPerAddress = _maxFreezableAmount;

        budget = new EVaultCampaignBudget();
    }

    /// @dev For testing - allows to reduce lock period in special test contract to not wait for one year until we can test VaultReturn
    function getFreezingPeriodInSeconds()
      internal virtual view returns (uint256) {
        return SECONDS_PER_YEAR;
    }

    /// @dev For unit testing - allows tests to override block number
    function getBlockNumber()
      internal virtual view returns (uint256) {
        return block.number;
    }

    /// @dev For unit testing - allows tests to override block number
    function getBlockTimestamp()
      internal virtual view returns (uint256) {
        return block.timestamp;
    }

    /// @dev Returns the budget available for freezing considering the freezingThresholdLimit buffer
    function getAvailableFreezingBudget() public view returns (uint256) {
        uint256 notReserved = budget.getAvailableAmount();
        if (notReserved < freezingThresholdLimit)
            return 0;

        return notReserved - freezingThresholdLimit;
    }

    function getBudgetContractAddress() external view returns (address) {
        return address(budget);
    }

    /// @dev To be used for wallet. Calculates the freezable amount for an address based on/considering
    /// 1) maxFreezableAmountPerAddress
    /// 2) already frozen amount of address
    /// 3) campaign budget left
    /// 4) by freezingThresholdLimit as buffer for handling freezes when budget gets closed to consumed
    function getFreezableAmount(address claimer) public view returns (uint256) {
        uint256 claimerFreezable = maxFreezableAmountPerAddress - getTotalFrozenAmount(claimer);
        uint256 budgetLeft = getAvailableFreezingBudget();
        if (budgetLeft == 0)
            return 0;

        //consider rate as it is not guaranteed that the full to-be-reserved budget for claimerFreezable is still available
        (uint256 rate, ) = determineRate(claimer);
        uint256 toReserve = calculateBudgetToReserve(claimerFreezable, rate);

        if (toReserve > budgetLeft) {
            // we cannot reserve the full claimable amount -> lets inverse calculate with the rest
            claimerFreezable = calculateFreezableAmountForBudgetLeft(budgetLeft, rate);
            return claimerFreezable;    // freezingThresholdLimit already considered in budgetLeft, no need to substract!
        }

        return claimerFreezable - freezingThresholdLimit;
    }

    /// @dev Returns sum of all freezings of an address within the campaign. Only not-yet-returned funds should be counted as it should reflect a "balance".
    function getTotalFrozenAmount(address claimer) public view returns (uint256 totalFrozen) {
        FrozenAmount[] storage freezingsByClaimer = frozenAmounts[claimer];
        
        for (uint i; i < freezingsByClaimer.length; i++) {
            if (!freezingsByClaimer[i].returned) {
                totalFrozen += freezingsByClaimer[i].amount;
            }
        }
    }

    function freeze(address sender) public payable onlyOwner {
        require (maxFreezableAmountPerAddress - getTotalFrozenAmount(sender) >= msg.value, 'freeze: msg.value of sender above max freezable amount');
        
        uint256 rate; uint256 subscription;
        (rate, subscription) = determineRate(sender);

        // check if enough reserve for the current call
        uint256 toReserve = calculateBudgetToReserve(msg.value, rate);

        require(toReserve <= budget.getAvailableAmount(), 'freeze: no budget left anymore');
        budget.reserve(toReserve);

        FrozenAmount[] storage frozenSenderAmounts = frozenAmounts[sender];

        // as frozen amounts are added historically in block order we just need to check last element (in order to prevent two freezings in same block by the user)
        if (frozenSenderAmounts.length > 0) {
            require(frozenSenderAmounts[frozenSenderAmounts.length - 1].blockNumber != getBlockNumber(), 'freeze: sender already did a freezing in same block');
        }

        FrozenAmount memory fa = FrozenAmount(msg.value, getBlockNumber(), getBlockTimestamp(), rate, 0, false);
        frozenSenderAmounts.push(fa);
        
        emit VaultLock(fa.blockNumber, msg.value, rate, subscription);
    }

    function calculateBudgetToReserve(uint256 amount, uint rate) private pure returns (uint256) {
        return calculateRewardsForSeconds(amount, rate, SECONDS_PER_YEAR);
    }

    function calculateRewardsForSeconds(uint256 amount, uint256 rate, uint256 sec) private pure returns (uint256) {
        uint256 rewardDueAttoWei = amount * ONE_PERCENT_ATTO_WEI_REWARD_PER_SECOND * sec * rate / 100 / WEI_PRECISION;
        return rewardDueAttoWei / 1 ether;  // atto wei to wei
    }

    /// @dev Returns freezable amount with particular budget left -> inverse calculation logic of calculateRewardsForSeconds()
    function calculateFreezableAmountForBudgetLeft(uint256 budgetLeft, uint256 rate) private pure returns (uint256) {
        uint256 amount = budgetLeft * 100 * WEI_PRECISION / ONE_PERCENT_ATTO_WEI_REWARD_PER_SECOND / SECONDS_PER_YEAR / rate;
        return amount * 1 ether;        
    }

    function determineRate(address sender) private view returns (uint256, uint256) {
        // DEFAULT = 0 -> 2%
        // GOLD = 1 -> 3%
        // PLATINUM = 2 -> 6%
        if (subscriptionNFT.balanceOf(sender, 2) > 0)
            return (6, 2);

        if (subscriptionNFT.balanceOf(sender, 1) > 0)
            return (3, 1);
        
        return (2, 0);
    }

    function mapRateToSubscription(uint256 rate) private pure returns (uint subscription) {
        // DEFAULT = 0 -> 2%
        // GOLD = 1 -> 3%
        // PLATINUM = 2 -> 6%
        assembly {
            switch rate
            case 6 { subscription := 2 }
            case 3 { subscription := 1 }
            default { subscription := 0 }
        }
    }

    /// @dev Returns total reward withdrawn by a claimer
    function getTotalRewardWithdrawn(address claimer) public view returns (uint256) {
        return totalWithdrawnByClaimer[claimer];
    }

    /// @dev Returns total claimable reward of all frozen amounts
    function calculateRewardDue(address claimer) public view returns (uint256) {
        FrozenAmount[] storage frozenSenderAmounts = frozenAmounts[claimer];
        uint256 claimerWithdrawn = totalWithdrawnByClaimer[claimer];
        
        uint256 totalDue = 0;
        for (uint i; i < frozenSenderAmounts.length; i++) {
            FrozenAmount storage fa = frozenSenderAmounts[i];            
            (uint256 rewardWei, uint256 toUnlock) = calculateRewardWei(fa);
            totalDue += rewardWei + toUnlock;   // here we add both rewards and unlocked amount to indicate gross amount to wallet
        }

        return totalDue - claimerWithdrawn;
    }

    /// @dev Calculates the reward claimable for all frozen amounts and updates the withdawn field of frozenAmount (which is required for getFreezeInfo() response)
    function calculateRewardDueAndUpdateStorage(address claimer) private returns (uint256) {
        FrozenAmount[] storage frozenSenderAmounts = frozenAmounts[claimer];
        uint256 claimerWithdrawnBefore = totalWithdrawnByClaimer[claimer];    // get withdrawings to deduct form reward calculated from freezing block
        
        uint256 totalDue = 0;   // the basis to pay from the budget contract
        for (uint i; i < frozenSenderAmounts.length; i++) {
            FrozenAmount storage fa = frozenSenderAmounts[i];            
            
            // rewardWei is the total accumulated reward for the entire duration since freezing. Has to be deducted by the already paid rewards before paying rewards to sender!
            (uint256 rewardWei, uint256 toUnlock) = calculateRewardWei(fa);
            totalDue += rewardWei;  // here we add only rewards - unlocked amounts are paid from the campaign itself!
            if (toUnlock > 0) {
                fa.returned = true;
                payable(claimer).transfer(toUnlock);
                emit VaultReturn(fa.blockNumber, toUnlock);
            }
                        
            uint256 rewardNew = rewardWei - fa.withdrawn;
            totalWithdrawnByClaimer[claimer] += rewardNew;
            fa.withdrawn = rewardWei;
            emit VaultReward(fa.blockNumber, rewardNew, fa.rate, mapRateToSubscription(fa.rate));
        }

        return totalDue - claimerWithdrawnBefore;
    }

    /// @dev Returns info for some particular frozen amount identified by block number
    function getFreezeInfo(address claimer, uint256 blockNumber) 
        external view returns (uint256 rate, uint256 rewardDue, uint256 withdrawn) {
        FrozenAmount[] storage frozenSenderAmounts = frozenAmounts[claimer];

        for (uint i; i < frozenSenderAmounts.length; i++) {
            FrozenAmount storage fa = frozenSenderAmounts[i];
            if (fa.blockNumber == blockNumber) {
                (rewardDue, ) = calculateRewardWei(fa);
                withdrawn = fa.withdrawn;
                rate = fa.rate;
                break;
            }
        }
    }

    /// @dev Calculates the rewards passed on time passed since freezing
    function calculateRewardWei(FrozenAmount memory fa) private view returns (uint256 rewardDue, uint256 toUnlock) {
        uint256 secondsSinceFreezing = getBlockTimestamp() - fa.timestamp;
        uint256 lockPeriod = getFreezingPeriodInSeconds();
        if (secondsSinceFreezing >= lockPeriod) {
            // you cannot earn interest after locking period (of 1 year) is over --> return it in the claim() call!
            secondsSinceFreezing = lockPeriod;
            if (!fa.returned) {
                toUnlock = fa.amount;
            }
        }

       rewardDue = calculateRewardsForSeconds(fa.amount, fa.rate, secondsSinceFreezing);
    }

    /// @dev Allows to fund the budget contract
    function fund() public payable {
        budget.fund{value: msg.value}();
    }

    /// @dev Allows to claim directly on the particular campaign (without going over campaigns)
    function claim() public {
        doClaim(msg.sender);
    }

    /// @dev Allows the campaigns contract to call claim over all campaigns
    function claimForSender(address claimer) public onlyOwner {
        doClaim(claimer); // we don't use it for authorization but to get actuall caller of the campaigns contract
    }

    function doClaim(address claimer) private {
        uint256 rewardDue = calculateRewardDueAndUpdateStorage(claimer);
        if (rewardDue > 0) {       
            budget.claimRewards(payable(claimer), rewardDue);
        }
    }
}
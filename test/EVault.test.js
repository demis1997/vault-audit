const { not } = require('@openzeppelin/test-helpers/src/expectEvent');
const { expect } = require("chai");
const { web3 } = require("hardhat");
const { block } = testUtils;

const SECONDS_PER_MIN = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_WEEK = 604800;
const SECONDS_PER_YEAR = 31536000;

const StandardInterestPerYear = 2;
const GoldInterestPerYear = 3;
const PlatinumInterestPerYear = 6;

const MaxFreezableAmount = 500000;
const FreezingThresholdLimit = 20000;

describe("eVault", () => {
  const InitialBudget = 1000000
  const AmountToFreeze = 100000;
  
  let subscriptionNftAddress;
  let budgetAddress;
  let campaigns;
  let campaignAddress;
  let campaignContract;
  let nftContract;
  
  // no need to set this anymore after migration to block timestamp approach
  /*
  async function setBlockNumber(blockNumber) {
    let currentBlockNumber = await getBlockNumber();
    await campaignContract.setBlockNumber(blockNumber);
    let newCurrentBlockNumber = await getBlockNumber();
    console.log(`Current BlockNumber: ${currentBlockNumber}. Forwarding...New BlockNumber: ${newCurrentBlockNumber}`);
  }
  */

  async function getBlockNumber() {
    let contractBlockNumber = await campaignContract.callStatic.GetBlockNumber();
    return Number(contractBlockNumber != 0 ? contractBlockNumber : await web3.eth.getBlockNumber());
  }

  async function setBlockTimestamp(timestamp) {
    let currentBlockTimestamp = await getBlockTimestamp();
    await campaignContract.setBlockTimestamp(timestamp);
    let newCurrentBlockTimestamp = await getBlockTimestamp();
    console.log(`Current BlockTimestamp: ${currentBlockTimestamp}. Forwarding...New BlockTimestamp: ${newCurrentBlockTimestamp}`);
  }

  async function getBlockTimestamp() {
    let contractBlockNumber = await campaignContract.callStatic.GetBlockTimestamp();
    return Number(contractBlockNumber != 0 ? contractBlockNumber : (await web3.eth.getBlock("latest")).timestamp);
  }

  before(async () => {
    [sce, user1, user2, user3, user4, user5, user6, campaignCreator] = await ethers.getSigners();
    /*
    console.log(`SCE: ${sce.address}`);
    console.log(`user1: ${user1.address}`);
    console.log(`user2: ${user2.address}`);
    console.log(`user3: ${user3.address}`);
    console.log(`user4: ${user4.address}`);
    console.log(`user5: ${user5.address}`);
    console.log(`user6: ${user6.address}`);
    */
  });

  beforeEach(async () => {
    
    let factory = await ethers.getContractFactory("SubscriptionNFT");
    nftContract = await upgrades.deployProxy(factory, [], { initializer: "initialize" });
    await nftContract.deployed();

    subscriptionNftAddress = nftContract.address;

    factory = await ethers.getContractFactory("TestEVaultCampaigns");
    campaigns = await factory.connect(sce).deploy(subscriptionNftAddress);
    campaigns = await campaigns.deployed();
    console.log(`Campaigns address: ${campaigns.address}`);

    let creatorRole = await campaigns.CAMPAIGN_CREATOR_ROLE();
    const res = await campaigns.connect(sce).grantRole(creatorRole, campaignCreator.address);
    await res.wait();
    expect(await campaigns.hasRole(creatorRole, campaignCreator.address)).to.be.true;

    let result = await campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount));
    result = await result.wait();

    let deployedEvent = result.events.filter((x) => x.event == "CampaignDeployed")[0];
    campaignAddress = deployedEvent.args.contractAddress;
    const campaignId = deployedEvent.args.campaignId;
    console.log(`Campaign ${campaignId} address: ${campaignAddress} `);
    expect(await campaigns.getActiveCampaignId()).to.equal(campaignId);

    factory = await ethers.getContractFactory("TestEVaultCampaign");
    campaignContract = factory.attach(campaignAddress);

    budgetAddress = await campaignContract.getBudgetContractAddress();
    console.log(`BudgetContract address of campaign ${campaignId}: ${budgetAddress}`)

    factory = await ethers.getContractFactory("EVaultCampaignBudget");
    budgetContract = factory.attach(budgetAddress);
  });

  it("Should revert funds() and freeze() calls in case no active campaign created", async () => {
    let factory = await ethers.getContractFactory("EVaultCampaigns");
    const campaignsNew = await factory.connect(sce).deploy(subscriptionNftAddress);
    campaigns = await campaignsNew.deployed();
    console.log(`Campaigns address: ${campaigns.address}`);

    let creatorRole = await campaigns.CAMPAIGN_CREATOR_ROLE();
    const res = await campaigns.connect(sce).grantRole(creatorRole, campaignCreator.address);
    await res.wait();
    expect(await campaigns.hasRole(creatorRole, campaignCreator.address)).to.be.true;

    await expect(campaigns.connect(user1).fund({value: toWei(100)})).to.be.revertedWith('no campaign created');
    await expect(campaigns.connect(user1).freeze({value: toWei(1)})).to.be.revertedWith('no campaign created');
  });

  it("Should have campaign contract as owner of budget contract", async () => {
    let factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budgetContract = factory.attach(await campaignContract.getBudgetContractAddress());
    expect(await budgetContract.owner()).to.equal(campaignAddress, "Campaign contract should own the budget contract");
  });

  it("Should allow everybody to fund the budget contract", async () => {
    let factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budget = factory.attach(budgetAddress);

    // fund via concrete campaign
    await budget.connect(user1).fund({value: ethers.utils.parseEther("1.0")});

    // fund via campaigns
    await expect(await campaigns.connect(user2).fund({value: ethers.utils.parseEther("1.0")}))
      .to.emit(budgetContract, 'CampaignFunded')
      .withArgs(ethers.utils.parseEther("1.0"));

    let budgetBalance1 = toEther(await web3.eth.getBalance(budgetAddress));
    console.log(`Budget balance of campaign: ${budgetBalance1}`);
    expect(budgetBalance1).to.equal(2);
  });

  it("Should return 0 for getFreezableAmount() before funding", async () => {
    expect(await campaignContract.getFreezableAmount(user1.address)).to.equal(0);
  });

  it("Should return correct amount for getFreezableAmount() after funding", async () => {
    await fundCampaign(InitialBudget);
    expect(await campaignContract.getFreezableAmount(user1.address)).to.equal(toWei(MaxFreezableAmount - FreezingThresholdLimit));
  });

  it("Should allow everbody to freeze", async () => {
    await fundCampaign(InitialBudget);

    // ACT
    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    const call = campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await expect(await call)
      .to.emit(campaignContract, 'VaultLock')
      .withArgs(await getBlockNumber(), toWei(AmountToFreeze), 2, 0);

    let campaignBalance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign): ${toEther(campaignBalance)}`);
    expect(campaignBalance).to.equal(toWei(AmountToFreeze));

    let freezableAmount = await campaigns.getFreezableAmount(user1.address);
    console.log(`FreezableAmount (user1): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    
    let campaignBudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`New budget balance (campaign): ${toEther(campaignBudgetBalance)}`);
    expect(campaignBudgetBalance).to.equal(toWei(InitialBudget), "Budget should not be affected by the freeze(), only by the claim()");

    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget)).to.equal(toEther(campaignBudgetBalance) - totalInterestToReserve - FreezingThresholdLimit);

    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR);

    let rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);

    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);
  });

  it("Should allow everbody to freeze via campaigns wrapper contract", async () => {
    await fundCampaign(InitialBudget);

    // ACT
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    let freezableAmount = await campaigns.getFreezableAmount(user1.address);
    console.log(`FreezableAmount (user1): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    
    let campaignBudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`New budget balance (campaign): ${toEther(campaignBudgetBalance)}`);
    expect(campaignBudgetBalance).to.equal(toWei(InitialBudget), "Budget should not be affected by the freeze(), only by the claim()");

    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget)).to.equal(toEther(campaignBudgetBalance) - totalInterestToReserve - FreezingThresholdLimit);

    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR);

    let rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);

    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);
  });

  it("Should calculate different rate for SubscriptionNFT holders", async () => {
    let standardUser = user1;
    let goldUser = user2;
    let platinumUser = user3;

    await fundCampaign(InitialBudget);

    await nftContract.connect(sce).mintGold(goldUser.address);
    expect(await nftContract.balanceOf(goldUser.address, nftContract.GOLD())).to.equal(1);

    await nftContract.connect(sce).mintPlatinum(platinumUser.address);
    expect(await nftContract.balanceOf(platinumUser.address, nftContract.PLATINUM())).to.equal(1);

    // ACT
    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await expect(await campaigns.connect(standardUser).freeze({value: toWei(AmountToFreeze) }))
      .to.emit(campaignContract, 'VaultLock')
      .withArgs(await getBlockNumber(), toWei(AmountToFreeze), 2, 0);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await expect(await campaigns.connect(goldUser).freeze({value: toWei(AmountToFreeze) }))
      .to.emit(campaignContract, 'VaultLock')
      .withArgs(await getBlockNumber(), toWei(AmountToFreeze), 3, 1);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await expect(await campaigns.connect(platinumUser).freeze({value: toWei(AmountToFreeze) }))
      .to.emit(campaignContract, 'VaultLock')
      .withArgs(await getBlockNumber(), toWei(AmountToFreeze), 6, 2);

    let campaignBalance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign): ${toEther(campaignBalance)}`);
    expect(campaignBalance).to.equal(toWei(AmountToFreeze * 3));

    let freezableAmount = await campaigns.getFreezableAmount(standardUser.address);
    console.log(`FreezableAmount (standardUser): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    freezableAmount = await campaigns.getFreezableAmount(goldUser.address);
    console.log(`FreezableAmount (goldUser): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    freezableAmount = await campaigns.getFreezableAmount(platinumUser.address);
    console.log(`FreezableAmount (platinumUser): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    const totalStandardInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    const totalGoldInterestToReserve = AmountToFreeze * GoldInterestPerYear / 100;
    const totalPlatinumInterestToReserve = AmountToFreeze * PlatinumInterestPerYear / 100;
    
    let campaignBudgetBalance = await web3.eth.getBalance(budgetAddress);
    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget)).to.equal(toEther(campaignBudgetBalance) - totalStandardInterestToReserve - totalGoldInterestToReserve - totalPlatinumInterestToReserve - FreezingThresholdLimit);
    expect(toEther(availableBudget)).to.equal(toEther(campaignBudgetBalance) - totalStandardInterestToReserve - totalGoldInterestToReserve - totalPlatinumInterestToReserve - FreezingThresholdLimit);

    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR);

    let totalRewardAndReturn = totalStandardInterestToReserve + AmountToFreeze;
    let rewardDue = await campaignContract.calculateRewardDue(standardUser.address);
    console.log(`rewardDue standardUser: ${toEther(rewardDue)}`);
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);

    totalRewardAndReturn = totalGoldInterestToReserve + AmountToFreeze;
    rewardDue = await campaignContract.calculateRewardDue(goldUser.address);
    console.log(`rewardDue goldUser: ${toEther(rewardDue)}`);
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);

    totalRewardAndReturn = totalPlatinumInterestToReserve + AmountToFreeze;
    rewardDue = await campaignContract.calculateRewardDue(platinumUser.address);
    console.log(`rewardDue platinumUser: ${toEther(rewardDue)}`);
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);
  });

  it("Should NOT allow an address to freeze more than MaxFreezableAmount", async () => {
    await fundCampaign(InitialBudget);

    console.log(`Sending MaxFreezableAmount (${MaxFreezableAmount}) to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(MaxFreezableAmount) });

    // ACT
    await expect(campaigns.connect(user1).freeze({value: toWei(1) })).to.be.revertedWith('freeze: msg.value of sender above max freezable amount');
  });

  it("Should consider MaxFreezableAmount correctly in getFreezableAmount() call", async () => {
    await fundCampaign(MaxFreezableAmount * 2);

    let freezable = await campaigns.getFreezableAmount(user1.address);
    console.log(`Freezable campaign: ${freezable}`);
    expect(freezable).to.equal(toWei(MaxFreezableAmount - FreezingThresholdLimit));
  });

  it("Should consider FreezingThresholdLimit correctly in getFreezableAmount() call", async () => {
    await fundCampaign(500000);

    let freezable = await campaigns.getFreezableAmount(user1.address);
    console.log(`Freezable campaign: ${freezable}`);
    expect(freezable).to.equal(toWei(500000 - FreezingThresholdLimit));
  });

  it("Should not produce additional yield after 1 year", async () => {
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    
    let campaignBalance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign): ${toEther(campaignBalance)}`);
    expect(campaignBalance).to.equal(toWei(AmountToFreeze));

    let freezableAmount = await campaignContract.getFreezableAmount(user1.address);
    console.log(`FreezableAmount (user1): ${toEther(freezableAmount)}`);
    expect(freezableAmount).to.equal(toWei(MaxFreezableAmount - AmountToFreeze - FreezingThresholdLimit));

    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    
    let campaignBudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`New budget balance (campaign): ${toEther(campaignBudgetBalance)}`);
    expect(campaignBudgetBalance).to.equal(toWei(InitialBudget), "Budget should not be affected by the freeze(), only by the claim()");

    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget)).to.equal(toEther(campaignBudgetBalance) - totalInterestToReserve - FreezingThresholdLimit);

    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR);

    let rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);

    // ACT
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR * 2);

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);

    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn, "Should only create interest for the first year");
  });

  it("Should consider FreezingThresholdLimit and NOT allow freeze if no budget left", async () => {
    // 10k budget available for freezing as 20k is the threshold 
    //--> 5 feezings of 100k allowed from getFreezableAmount() point of view (each resulting in 2000 yield for a year)
    // rest can be still consumed by direct freeze() call due to FreezingThresholdLimit buffer
    const InitialBudget = 30000;
    const AmountToFreeze = 100000;

    // ARRANGE
    await fundCampaign(InitialBudget);
    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);

    let pureBudget; // campaign budget WITHOUT FreezingThresholdLimit
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    let freezable = await campaigns.getFreezableAmount(user1.address);

    expect(toEther(pureBudget)).to.equal(InitialBudget);
    expect(toEther(availableBudget)).to.equal(InitialBudget - FreezingThresholdLimit);
    expect(toEther(availableBudget)).to.equal(10000);
    expect(toEther(freezable)).to.equal(MaxFreezableAmount - 1); // -1 due to rounding

    // ACT
    console.log(`Sending ${AmountToFreeze} to freeze for user1 to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    freezable = await campaigns.getFreezableAmount(user1.address);
    console.log(`freezable: ${toEther(freezable)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget).toFixed(2)).to.equal("8000.00"); // 7999.999999999999
    expect(toEther(pureBudget)).to.equal(28000);

    console.log(`Sending ${AmountToFreeze} to freeze for user2 to campaign...`);
    await campaigns.connect(user2).freeze({value: toWei(AmountToFreeze) });
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget).toFixed(2)).to.equal("6000.00");  // 5999.999999999998
    expect(toEther(pureBudget)).to.equal(26000);

    console.log(`Sending ${AmountToFreeze} to freeze for user3 to campaign...`);
    await campaigns.connect(user3).freeze({value: toWei(AmountToFreeze) });
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget).toFixed(2)).to.equal("4000.00"); // 3999.9999999999973
    expect(toEther(pureBudget).toFixed(2)).to.equal("24000.00"); // 23999.999999999996

    console.log(`Sending ${AmountToFreeze} to freeze for user4 to campaign...`);
    await campaigns.connect(user4).freeze({value: toWei(AmountToFreeze) });
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget).toFixed(2)).to.equal("2000.00");  // 1999.9999999999966
    expect(toEther(pureBudget).toFixed(2)).to.equal("22000.00"); // 21999.999999999996

    console.log(`Sending ${AmountToFreeze} to freeze for user5 to campaign...`);
    await campaigns.connect(user5).freeze({value: toWei(AmountToFreeze) });
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget)).to.equal(0);
    expect(toEther(pureBudget).toFixed(2)).to.equal("20000.00"); // 19999.999999999996

    console.log(`Sending ${AmountToFreeze} to freeze for user6 to campaign (should succeed even availableBudget == 0 due to freezingThresholdLimit buffer)...`);
    await campaigns.connect(user6).freeze({value: toWei(AmountToFreeze) });
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget)).to.equal(0);
    expect(toEther(pureBudget).toFixed(2)).to.equal("18000.00");  //17999.999999999996

    // freeze rest of budget
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user2).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user2).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user3).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user3).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user4).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user4).freeze({value: toWei(AmountToFreeze)});

    availableBudget = await campaignContract.getAvailableFreezingBudget();
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(availableBudget)).to.equal(0);
    expect(toEther(pureBudget).toFixed(2)).to.equal("2000.00");  //1999.9999999999882

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign): ${toEther(campaign1Balance)}`);
    expect(toEther(campaign1Balance)).to.equal(AmountToFreeze * 14);

    await expect (campaigns.connect(user6).freeze({value: toWei(AmountToFreeze) })).to.be.revertedWith("freeze: no budget left anymore");

    // send additional budget and try to freeze again for user6 --> should work then
    let factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budget = factory.attach(budgetAddress);
    
    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);

    console.log(`Add additional 30000 to campaign to allow user6 to freeze too!`);
    await budget.connect(sce).fund({value: ethers.utils.parseEther("30000")});

    availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget).toFixed(2)).to.equal((2000 + 30000 - FreezingThresholdLimit).toFixed(2));
    pureBudget = await budgetContract.getAvailableAmount();
    console.log(`Pure Budget: ${toEther(pureBudget)}`);
    expect(toEther(pureBudget).toFixed(2)).to.equal((2000 + 30000).toFixed(2));

    // should work now
    await campaigns.connect(user5).freeze({value: toWei(AmountToFreeze)});
  });

  it("Should emit all events successfully for many freezings upon claim()", async () => {
    const InitialBudget = 100000;
    const AmountToFreeze = 1000;
    const countOfFreezings = 50;

    await fundCampaign(InitialBudget);

    for (let i = 0; i < countOfFreezings; i++) {
      console.log(`Freezing on block ${await getBlockNumber()}`);
      await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    }

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze * countOfFreezings));

    console.log(`Claimable before: ${await campaigns.getClaimableAmount(user1.address)}`);
    await setBlockTimestamp(await getBlockTimestamp() + SECONDS_PER_YEAR);
    console.log(`Claimable after 1 year: ${await campaigns.getClaimableAmount(user1.address)}`);
    let tx = await campaigns.connect(user1).claim();
    const {events} = await tx.wait();
    expect(events.filter(x => x.topics[0] === "0x99037f1a4eae86d44efae6305ae40b552081f350a38adc47f9a3c1e828132394").length).to.equal(countOfFreezings); // VaulReturn
    expect(events.filter(x => x.topics[0] === "0xaae3086a0db4b43e8e673f456acc49866003cbfc07e0c3d9cfb18a27402d9e10").length).to.equal(countOfFreezings);  // VaulReward
  });
  
  it("Should correctly calculate rewards for different freezing periods", async () => {
    await fundCampaign(InitialBudget);

    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;

    console.log(`Sending ${AmountToFreeze} to freeze to campaign1...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    // ACT
    campaign1BudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`New budget balance (campaign1): ${toEther(campaign1BudgetBalance)}`);
    expect(campaign1BudgetBalance).to.equal(toWei(InitialBudget), "Budget should not be affected by the freeze(), only by the claim()");

    let availableBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`AvailableBudget (campaign1): ${toEther(availableBudget)}`);
    expect(toEther(availableBudget)).to.equal(toEther(campaign1BudgetBalance) - totalInterestToReserve - FreezingThresholdLimit);

    let yearlyReward = toWei(AmountToFreeze * StandardInterestPerYear / 100);
    console.log(`Total eligible rewards for user per year: ${yearlyReward}`);

    let initialBlockTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(initialBlockTimestamp + 1);
    let rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 SECOND): ${rewardDue}\n`);
    expect(rewardDue).to.equal('63419583967529');

    await setBlockTimestamp(initialBlockTimestamp + 5);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 BLOCK): ${rewardDue}\n`);
    expect(rewardDue).to.equal('317097919837646');

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_MIN);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 MIN): ${rewardDue}\n`);
    expect(rewardDue).to.equal('3805175038051752');

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_HOUR);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 HOUR): ${rewardDue}\n`);
    expect(rewardDue).to.equal('228310502283105120');

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_DAY);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 DAY): ${rewardDue}\n`);
    expect(rewardDue).to.equal('5479452054794522880');

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_WEEK);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 WEEK): ${rewardDue}\n`);
    expect(rewardDue).to.equal('38356164383561660160');

    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_YEAR);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 YEAR): ${rewardDue}\n`);
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn);

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_YEAR * 2);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (2 YEARS): ${rewardDue}\n`);
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn, 'Should not increase claimable rewards after 1 year');
  });

  it("Should correctly send rewards upon claiming for different freezing periods (MONTH)", async () => {
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign1...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    const freezingId = await getBlockNumber();

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));
    
    // ACT
    campaign1BudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`New budget balance (campaign1): ${toEther(campaign1BudgetBalance)}`);
    expect(campaign1BudgetBalance).to.equal(toWei(InitialBudget), "Budget should not be affected by the freeze(), only by the claim()");   

    let weeklyReward = AmountToFreeze / 52 * StandardInterestPerYear / 100;
    console.log(`Total eligible rewards for user per month: ${weeklyReward}`);

    let initialBlockTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_WEEK);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 WEEK): ${rewardDue}\n`);
    expect(toEther(rewardDue)).to.equal(38.35616438356166);

    let user1Balance = await user1.getBalance();
    console.log(`Balance user1 before claim: ${toEther(user1Balance)}\n`);
    let claimCall = campaigns.connect(user1).claim();
    await expect(await claimCall)
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingId, rewardDue, 2, 0)
      .to.changeEtherBalance(user1, rewardDue);

    user1Balance = await user1.getBalance();
    console.log(`Balance user1 after claim: ${toEther(user1Balance)}\n`);
  });

  it("Should allow claiming the rewards", async () => {
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign1...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    const freezingId = await getBlockNumber();
    const userBalanceAfterFreezing = await user1.getBalance();
    console.log(`User1 balance after freezing: ${userBalanceAfterFreezing}`);

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    let budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds (campaign1): ${toEther(budgetBalance1)}`);
    expect(budgetBalance1).to.equal(toWei(InitialBudget));

    // ACT
    let initialBlockTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_DAY);
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 DAY): ${rewardDue}\n`);

    let claimCall = campaigns.connect(user1).claim();
    await expect(await claimCall)
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingId, rewardDue, 2, 0)
      .to.changeEtherBalance(user1, rewardDue);
    
    let user1Balance = await user1.getBalance();
    console.log(`User1 balance after claiming: ${user1Balance}`);
    expect(await campaignContract.getTotalRewardWithdrawn(user1.address)).to.equal(rewardDue);

    campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds after claim (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds after claim (campaign1): ${toEther(budgetBalance1)}`);

    expect(toEther(budgetBalance1)).to.equal((InitialBudget) - toEther(rewardDue.toString()));

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (after claim): ${rewardDue}\n`);
    expect(rewardDue).to.equal(0);

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_DAY * 2);

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (after first claim, before next claim): ${rewardDue}\n`);
  });

  it("Should calculate multiple claims correctly", async () => {
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign1...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    const freezingId = await getBlockNumber();
    const userBalanceAfterFreezing = await user1.getBalance();
    console.log(`User1 balance after freezing: ${userBalanceAfterFreezing}`);

    let campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    let budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds (campaign1): ${toEther(budgetBalance1)}`);
    expect(budgetBalance1).to.equal(toWei(InitialBudget));

    // ACT
    let initialBlockTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_DAY);
    const rewardDue1 = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 DAY): ${rewardDue1}\n`);

    await expect(await campaigns.connect(user1).claim())
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingId, rewardDue1, 2, 0)
      .to.changeEtherBalance(user1, rewardDue1);
    
    let user1Balance = await user1.getBalance();
    console.log(`User1 balance after claim 1: ${user1Balance}`);
    expect(await campaignContract.getTotalRewardWithdrawn(user1.address)).to.equal(rewardDue1);

    campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds after claim 1 (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds after claim 1 (campaign1): ${toEther(budgetBalance1)}`);

    expect(toEther(budgetBalance1)).to.equal((InitialBudget) - toEther(rewardDue1.toString()));
    expect(toEther(user1Balance).toFixed(2)).to.equal(
      (toEther(userBalanceAfterFreezing) + toEther(rewardDue1.toString())).toFixed(2)
    );

    await setBlockTimestamp(initialBlockTimestamp + SECONDS_PER_DAY * 2);

    const rewardDue2 = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (before claim 2): ${rewardDue2}\n`);

    await expect(await campaigns.connect(user1).claim())
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingId, rewardDue2, 2, 0)
      .to.changeEtherBalance(user1, rewardDue2)
      //.to.changeEtherBalances([user1, budgetContract], [rewardDue2, -rewardDue2])
      ;
    
    user1Balance = await user1.getBalance();
    console.log(`User1 balance after claim 2: ${user1Balance}`);
    const expectedWithdrawn = WeiAdd(rewardDue1, rewardDue2);
    expect(await campaignContract.getTotalRewardWithdrawn(user1.address)).to.equal(expectedWithdrawn.toString());

    campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds after claim 2 (campaign1): ${toEther(campaign1Balance)}`);
    expect(campaign1Balance).to.equal(toWei(AmountToFreeze));

    budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds after claim 2 (campaign1): ${toEther(budgetBalance1)}`);

    expect(toEther(budgetBalance1).toFixed(9)).to.equal((InitialBudget - toEther(rewardDue1) - toEther(rewardDue2)).toFixed(9));
    // expect(toEther(user1Balance).toFixed(9)).to.equal(
    //   (toEther(userBalanceAfterFreezing) + toEther(rewardDue1) + toEther(rewardDue2)).toFixed(9)
    // );
    //expect(toEther(user1Balance).toFixed(9)).to.equal(toEther(WeiAdd3(userBalanceAfterFreezing, rewardDue1, rewardDue2).toString()).toFixed(9));
    //expect(user1Balance.toString()).to.equal(WeiAdd3(userBalanceAfterFreezing, rewardDue1, rewardDue2).toString());
  });

  it("Should allow 0 claim without any freezings", async () => {
    await fundCampaign(InitialBudget);
    const user1InitialBalance = await user1.getBalance();

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (1 DAY): ${rewardDue}\n`);
    expect(rewardDue).to.equal(0);
    let claimCall = campaigns.connect(user1).claim();
    await expect(claimCall).to.not.emit(campaignContract, 'VaultReward');

    const user1Balance = await user1.getBalance();
    expect(toEther(user1Balance)).to.lessThan(toEther(user1InitialBalance)); // user paid only for gas

    campaign1Balance = await web3.eth.getBalance(campaignAddress);
    console.log(`Frozen funds after claim (campaign1): ${toEther(campaign1Balance)}`);
    expect(toEther(campaign1Balance)).to.equal(0);

    budgetBalance1 = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget funds after claim (campaign1): ${toEther(budgetBalance1)}`);
    expect(toEther(budgetBalance1)).to.equal(InitialBudget);
  });

  it("Should not allow non-owners to call reserve() on budget contract", async () => { 
    factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budget = factory.attach(budgetAddress);

    await expect(budget.connect(user1).reserve(100)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Should not allow non-owners to call claim() on campaign contract", async () => { 
    factory = await ethers.getContractFactory("EVaultCampaign");
    let campaign = factory.attach(campaignAddress);

    await expect(campaign.connect(user1).freeze(user1.address, {value: 10})).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Should not allow non-owners to call claimForSender() on campaign contract", async () => { 
    factory = await ethers.getContractFactory("EVaultCampaign");
    let campaign = factory.attach(campaignAddress);
    
    await expect(campaign.connect(user1).claimForSender(user1.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it("Should not allow non-owners to call claimRewards() on budget contract", async () => { 
    factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budget= factory.attach(budgetAddress);
    
    await expect(budget.connect(user1).claimRewards(user1.address, 100)).to.be.revertedWith('Ownable: caller is not the owner');
  });

   it("Should return freezings after 1 year automatically", async () => { 
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    
    let freezingBlock = await getBlockNumber();
    console.log(`Freezing block: ${freezingBlock}`);

    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_YEAR);
    
    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);

    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn, 'Reward should contain 1 year interest + initial frozen amount');

    // ACT
    let claimCall = campaigns.connect(user1).claim();
    await expect(claimCall)
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingBlock, rewardDue, 2, 0)
      .to.emit(campaignContract, 'VaultReturn')
      .withArgs(freezingBlock, toBN(toEther(AmountToFreeze)));

      rewardDue = await campaignContract.calculateRewardDue(user1.address);
      expect(rewardDue).to.equal(0);
      expect(await campaignContract.getTotalFrozenAmount(user1.address)).to.equal('0');
      expect(await campaigns.getTotalFrozenAmount(user1.address)).to.equal('0');
  });

  it("Should give rewards and unlocked amount only once if claimed twice after 1 year", async () => {    
    await fundCampaign(InitialBudget);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    
    let freezingBlock = await getBlockNumber();
    console.log(`Freezing block: ${freezingBlock}`);

    let fundedCampaignBalance = await web3.eth.getBalance(campaignAddress);
    console.log(`Campaign funds after freeze (campaign1): ${toEther(fundedCampaignBalance)}`);
    expect(toEther(fundedCampaignBalance)).to.equal(AmountToFreeze);

    let currentBlockTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentBlockTimestamp + SECONDS_PER_YEAR);

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1: ${toEther(rewardDue)}`);
    const totalInterestToReserve = AmountToFreeze * StandardInterestPerYear / 100;
    let totalRewardAndReturn = totalInterestToReserve + AmountToFreeze;
    expect(toEther(rewardDue)).to.equal(totalRewardAndReturn, 'Reward should contain 1 year interest + initial frozen amount');    

    await expect(await campaigns.connect(user1).claim())
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingBlock, rewardDue, 2, 0)
      .to.emit(campaignContract, 'VaultReturn')
      .withArgs(freezingBlock, toBN(toEther(AmountToFreeze)))
      .to.changeEtherBalance(user1, rewardDue)

    let campaignBalance = await web3.eth.getBalance(campaignAddress);
    console.log(`Campaign funds after claim (campaign1): ${toEther(campaignBalance)}`);
    expect(campaignBalance).to.equal('0', "Locked funds should be returned");

    let campaign1BudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget balance (campaign1): ${toEther(campaign1BudgetBalance)}`);

    expect(toEther(campaign1BudgetBalance)).to.equal(InitialBudget - totalInterestToReserve);

    rewardDue = await campaignContract.calculateRewardDue(user1.address);
    expect(rewardDue).to.equal(0, 'No reward right after claiming should be due');

    await setBlockTimestamp(currentBlockTimestamp + SECONDS_PER_YEAR + SECONDS_PER_WEEK);

    let user1Balance = await user1.getBalance();
    console.log(`Balance user1 before claim: ${toEther(user1Balance)}\n`);

    // ACT
    await expect(await campaigns.connect(user1).claim())
      .not.to.emit(campaignContract, 'VaultReward')
      .not.to.emit(campaignContract, 'VaultReturn')
      .to.changeEtherBalance(user1, 0, {includeFee: true});

    user1Balance = await user1.getBalance();
    console.log(`Balance user1 after claim: ${toEther(user1Balance)}\n`);

    expect(await web3.eth.getBalance(campaignAddress)).to.equal('0');
  });

  it("Should return correct values for getFreezeInfo()", async () => { 
    await fundCampaign(InitialBudget);
        
    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    
    let freezingBlock1 = await getBlockNumber();
    console.log(`Freezing block1: ${freezingBlock1}`);

    let freezingBlock1Timestamp = await getBlockTimestamp();
    await setBlockTimestamp(freezingBlock1Timestamp + SECONDS_PER_WEEK);

    let rewardDueBlock1 = await campaignContract.calculateRewardDue(user1.address);
    console.log(`rewardDue user1 (block1): ${toEther(rewardDueBlock1)}`);

    // claim one frozenAmount the check for withdrawn in getFreezeInfo response
    let claimCall = campaigns.connect(user1).claim();
    await expect(await claimCall)
      .to.emit(campaignContract, 'VaultReward')
      .withArgs(freezingBlock1, rewardDueBlock1, 2, 0)
      .to.changeEtherBalance(user1, rewardDueBlock1);

    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    let freezingBlock2 = await getBlockNumber();
    console.log(`Freezing block2: ${freezingBlock2}`);

    let freezingBlock2Timestamp = await getBlockTimestamp();
    await setBlockTimestamp(freezingBlock2Timestamp + SECONDS_PER_WEEK);
    console.log(`Sending ${AmountToFreeze} to freeze to campaign...`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    let freezingBlock3 = await getBlockNumber();
    console.log(`Freezing block3: ${freezingBlock3}`);

    // ACT
    let rate, rewardDue, withdrawn;
    ({rate, rewardDue, withdrawn} = await campaigns.connect(user1).getFreezeInfo(user1.address, freezingBlock1));
    expect(rate).to.equal(2);
    expect(rewardDue).to.be.above(0);
    expect(withdrawn).to.equal(rewardDueBlock1);

    ({rate, rewardDue, withdrawn} = await campaigns.connect(user1).getFreezeInfo(user1.address, freezingBlock2));
    expect(rate).to.equal(2);
    expect(rewardDue).to.be.above(0);
    expect(withdrawn).to.equal(0);

    ({rate, rewardDue, withdrawn} = await campaigns.connect(user1).getFreezeInfo(user1.address, freezingBlock3));
    expect(rate).to.equal(2);
    expect(rewardDue).to.equal(0);
    expect(withdrawn).to.equal(0);
  });

  it("Should prevent multiple campaigns running in parallel as long as there is budget on previous campaign", async () => { 
    // as long as there is freezable budget on ongoing campaign the addCampaign() call will revert
    factory = await ethers.getContractFactory("TestEVaultCampaigns");
    campaigns = factory.attach(campaigns.address);

    await fundCampaign(InitialBudget);

    let call = campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount));
    await expect(call).to.be.revertedWith('addCampaign: there is another campaign still active');
  });
  
  it("Should allow a new campaign if old one ran out of budget", async () => { 
    // as long as there is freezable budget on ongoing campaign the addCampaign() call will revert
    factory = await ethers.getContractFactory("TestEVaultCampaigns");
    campaigns = factory.attach(campaigns.address);
    expect (await campaigns.getActiveCampaignId()).to.equal(0);

    await fundCampaign(FreezingThresholdLimit + 1000);

    await expect(campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount)))
      .to.be.revertedWith('addCampaign: there is another campaign still active');

    await campaigns.connect(user1).freeze({value: toWei(50000)});  // use all the budget to allow new campaign to be added

    await campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount));
    expect (await campaigns.getActiveCampaignId()).to.equal(1);
  });

  it("Should calculate multiple freezings over multiple campaigns correctly", async () => { 
    // one user freezes twice (after 6 moths or so and later), and also in mutliple campaigns
    factory = await ethers.getContractFactory("TestEVaultCampaigns");
    campaigns = factory.attach(campaigns.address);
    
    expect(await campaigns.getActiveCampaignId()).to.equal(0);

    await fundCampaign(FreezingThresholdLimit + 2); // 2 -> 100 freezable

    let freezable = await campaigns.getFreezableAmount(user1.address);
    console.log(`Freezable campaign1: ${freezable}`);
    console.log('Freezing...');
    await campaigns.connect(user1).freeze({value: freezable});
    let freezableNew = await campaigns.getFreezableAmount(user1.address);
    console.log(`Freezable campaign1 new: ${freezableNew}`);
    expect(freezableNew).to.equal(0);
    
    let currentTimestamp = await getBlockTimestamp();
    await setBlockTimestamp(currentTimestamp + SECONDS_PER_WEEK);

    let user1Claimable1 = await campaigns.getClaimableAmount(user1.address);
    console.log(`Claimable 1 user1: ${user1Claimable1}`);

    await expect(await campaigns.connect(user1).claim())
      .to.changeEtherBalance(user1, user1Claimable1);

    await setBlockTimestamp(currentTimestamp + SECONDS_PER_WEEK * 2);

    let user1Claimable2 = await campaigns.getClaimableAmount(user1.address);
    console.log(`Claimable 2 user1: ${user1Claimable2}`);

    let availableFreezingBudget = await campaignContract.getAvailableFreezingBudget();
    console.log(`availableFreezingBudget: ${availableFreezingBudget}`);

    let result = await campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount));
    result = await result.wait();

    let deployedEvent = result.events.filter((x) => x.event == "CampaignDeployed")[0];
    let campaign2Address = deployedEvent.args.contractAddress;
    console.log(`Campaign2 address: ${campaign2Address}`);
    console.log(`Campaign2 id: ${deployedEvent.args.campaignId}`);
    let campaign2 = factory.attach(campaign2Address);
    
    expect (await campaigns.getActiveCampaignId()).to.equal(1);

    await fundCampaign2(campaign2Address, FreezingThresholdLimit + 10000);

    let freezable2 = await campaign2.getFreezableAmount(user1.address);
    console.log(`Freezable campaign2: ${freezable2}`);

    await campaigns.connect(user1).freeze({value: freezable2});

    await setBlockTimestamp(currentTimestamp + SECONDS_PER_WEEK * 3);
    
    // 2 months Freezing1 (campaign 1) + 1 month Freezing2 (campaign 1) + 1 month Freezing 3 in campaign 2
    let claimable3 = await campaigns.getClaimableAmount(user1.address); 
    console.log(`Claimable 3 user1: ${claimable3} (${toEther(claimable3.toString())} ECS)`);

    const userBalance1 = await user1.getBalance();
    console.log(`User balance before claim: ${userBalance1}`);
    await campaigns.connect(user1).claim();

    const userBalance2 = await user1.getBalance();
    console.log(`User balance after claim: ${userBalance2}`);

    const diff = WeiSub(userBalance2, userBalance1);
    console.log(`User balance diff: +${toEther(diff.toString())} ECS`);

    const totalFrozen = await campaigns.getTotalFrozenAmount(user1.address); 
    console.log(`Total frozen: ${toEther(totalFrozen)} ECS`);
    const expectedTotalFrozen = WeiAdd(freezable, freezable2);
    expect(totalFrozen).to.equal(expectedTotalFrozen.toString());
  });

  it("Should prevent freezings of same sender in same block", async () => { 
    // should not be possible to freeze for same sender in the same block as (address, block) is PK for freezings!
    await fundCampaign(InitialBudget);

    // do another freezing before
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });
    
    // stop automining and make to freeze calls in very same block
    await block.setAutomine(false);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    // enable automining with next call again
    expect(await block.setAutomine(true)).to.equal(true);

    // ACT
    await expect(campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) }))
      .to.be.revertedWith('freeze: sender already did a freezing in same block');
  });

  it("Should allow freezings of different senders in same block", async () => { 
    await fundCampaign(InitialBudget);
        
    // stop automining and make to freeze calls in very same block
    await block.setAutomine(false);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze) });

    // enable automining with next call again
    expect(await block.setAutomine(true)).to.equal(true);

    // ACT
    await campaigns.connect(user2).freeze({value: toWei(AmountToFreeze) });
  });

  it("test claim with reduced locking", async () => {
    // test only for debugging!

    factory = await ethers.getContractFactory("TestEVaultCampaignsWithReducedLocking");
    campaigns = await factory.connect(sce).deploy(subscriptionNftAddress, 15);
    campaigns = await campaigns.deployed();
    console.log(`Campaigns address: ${campaigns.address}`);
    console.log(`Freezing period: ${await campaigns.getFreezingPeriodInSeconds()} sec`);

    let creatorRole = await campaigns.CAMPAIGN_CREATOR_ROLE();
    const res = await campaigns.connect(sce).grantRole(creatorRole, campaignCreator.address);
    await res.wait();
    expect(await campaigns.hasRole(creatorRole, campaignCreator.address)).to.be.true;

    let result = await campaigns.connect(campaignCreator).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount));
    result = await result.wait();

    let deployedEvent = result.events.filter((x) => x.event == "CampaignDeployed")[0];
    campaignAddress = deployedEvent.args.contractAddress;
    console.log(`Campaign ${deployedEvent.args.campaignId} address: ${campaignAddress}`);
    expect(await campaigns.getActiveCampaignId()).to.equal(deployedEvent.args.campaignId);

    factory = await ethers.getContractFactory("TestEVaultCampaignWithReducedLocking");
    campaignContract = factory.attach(campaignAddress);
    
    budgetAddress = await campaignContract.getBudgetContractAddress();
    console.log(`BudgetContract address of campaign: ${budgetAddress}`)

    factory = await ethers.getContractFactory("TestEVaultCampaignsWithReducedLocking");
    campaigns = factory.attach(campaigns.address);
    
    expect (await campaigns.getActiveCampaignId()).to.equal(0);

    await fundCampaign(500000);

    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    let currentHeight = await getBlockNumber();
    console.log(`Current block height: ${currentHeight}`);
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});
    await campaigns.connect(user1).freeze({value: toWei(AmountToFreeze)});

    currentHeight = await getBlockNumber();
    console.log(`Current block height: ${currentHeight}`);
    
    let claimable3 = await campaigns.getClaimableAmount(user1.address); 
    console.log(`Claimable user1: ${claimable3} (${toEther(claimable3.toString())} ECS)`);

    const userBalance1 = await user1.getBalance();
    console.log(`User balance before claim: ${userBalance1}`);
    await campaigns.connect(user1).claim();

    const userBalance2 = await user1.getBalance();
    console.log(`User balance after claim: ${userBalance2}`);

    const diff = WeiSub(userBalance2, userBalance1);
    console.log(`User balance diff: +${toEther(diff.toString())} ECS`);
  });

  function toWei(amount) {
    return web3.utils.toWei(amount.toString());
  }

  function toEther(amount) {
    return +ethers.utils.formatEther(amount);
  }

  function toBN(s) {
    return new web3.utils.BN(s);
  }

  function WeiAdd(wei1, wei2) {
    return toBN(wei1.toString()).add(toBN(wei2.toString()));
  }

  function WeiAdd3(wei1, wei2, wei3) {
    return toBN(wei1.toString()).add(toBN(wei2.toString())).add(toBN(wei3.toString()));
  }

  function WeiSub(wei1, wei2) {
    return toBN(wei1.toString()).sub(toBN(wei2.toString()));
  }
  
  async function fundCampaign(initialBudget) {
    await campaigns.connect(sce).fund({value: ethers.utils.parseEther(initialBudget.toString())});

    let campaignBudgetBalance = await web3.eth.getBalance(budgetAddress);
    console.log(`Budget balance: ${toEther(campaignBudgetBalance)}`);
    expect(campaignBudgetBalance).to.equal(toWei(initialBudget));
  }

  async function fundCampaign2(campaignAddress, initialBudget) {   
    let factory = await ethers.getContractFactory("EVaultCampaign");
    let campaign = factory.attach(campaignAddress);
    
    factory = await ethers.getContractFactory("EVaultCampaignBudget");
    let budget = factory.attach(await campaign.getBudgetContractAddress());
    await budget.connect(sce).fund({value: ethers.utils.parseEther(initialBudget.toString())});

    let campaignBudgetBalance = await web3.eth.getBalance(budget.address);
    console.log(`Budget balance ${campaignAddress}: ${toEther(campaignBudgetBalance)}`);
    expect(campaignBudgetBalance).to.equal(toWei(initialBudget));    
  }
});

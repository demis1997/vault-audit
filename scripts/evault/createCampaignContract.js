// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");

async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  const FreezingThresholdLimit = 10;
  const MaxFreezableAmount = 500000;

  [sce] = await hre.ethers.getSigners();
  let sceKey = process.env.SCE_KEY;
  if (sceKey) sce = new hre.ethers.Wallet(sceKey);
  console.log(`SCE: ${sce.address}`);

  let campaignsContractAddress = process.env.CAMPAIGNS_CONTRACT_ADDRESS;
  console.log(`Campaigns contract: ${campaignsContractAddress}`);

  if (!campaignsContractAddress) 
    throw "Configure contract address as CAMPAIGNS_CONTRACT_ADDRESS environment variable!";

  let factory = await hre.ethers.getContractFactory("EVaultCampaigns");
  const campaignsContract = factory.attach(campaignsContractAddress)

  console.log(`Current active campaign Id: ${await campaignsContract.getActiveCampaignId()}`);
  
  const toWei = (amount) => {
    return web3.utils.toWei(amount.toString());
  };

  let result = await campaignsContract.connect(sce).addCampaign(toWei(FreezingThresholdLimit), toWei(MaxFreezableAmount))
  result = await result.wait();

  let deployedEvent = result.events.filter((x) => x.event == "CampaignDeployed")[0];
  let campaignAddress = deployedEvent.args.contractAddress;
  console.log(`New Campaign created! Id: ${deployedEvent.args.campaignId}, address: ${campaignAddress}`);
  console.log(`New active campaign Id: ${await campaignsContract.getActiveCampaignId()}`);

  console.log(`Current active campaign Id: ${await campaignsContract.getActiveCampaignId()}`);

  factory = await hre.ethers.getContractFactory("EVaultCampaign");
  let campaignContract = factory.attach(campaignAddress);
  let budgetAddress = await campaignContract.getBudgetContractAddress();

  console.log(`Budget address: ${budgetAddress}`);

  // pass contract address to Azure DevOps
  console.log(`##vso[task.setvariable variable=campaignContract;isOutput=true]${campaignAddress}`);
  console.log(`##vso[task.setvariable variable=campaignBudgetContract;isOutput=true]${budgetAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

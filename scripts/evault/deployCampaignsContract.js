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

  let sce;
  [sce] = await hre.ethers.getSigners();
  
  let sceKey = process.env.ECR_SCE_KEY;
  if (sceKey) sce = new hre.ethers.Wallet(sceKey);

  console.log(`SCE: ${sce.address}`);

  let nftAddress = process.env.SUBSCRIPTION_NFT_CONTRACT_ADDRESS;
  console.log(`SubscriptionNFT contract: ${nftAddress}`);

  if (!nftAddress)
    throw "Configure subscription contract address as SUBSCRIPTION_NFT_CONTRACT_ADDRESS environment variable!";

  // deploy campaigns as sce
  let factory = await ethers.getContractFactory("EVaultCampaigns");
  const campaigns = await factory.connect(sce).deploy(nftAddress);
  await campaigns.deployed();
  console.log(`Campaigns contract: ${campaigns.address}`);
  
  // pass contract addresses to Azure DevOps
  console.log(`##vso[task.setvariable variable=campaignsContract;isOutput=true]${campaigns.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

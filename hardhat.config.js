require("@nomiclabs/hardhat-waffle");
require("solidity-coverage");
require("@nomiclabs/hardhat-web3");
require("@openzeppelin/hardhat-upgrades");
require('hardhat-test-utils');

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

const sce = "4663c222787e30c1994b59044aa5045377a6e79193a8ead88293926b535c722d";
const user1 = "0f46fba61453239b8e7f2d1bbc391adfb183d4cdef70c782f3da2789ffbf589c";
const user2 = "5cde2a3f56e63c1580b26596ac974da3c386f97f56fbc4b8ae7c3bcef9796f6f";
const user3 = "ef9dd15f68a55c658292fd0ee6c1e63e0795eb27b13d1275e29e3b8659307088";
const user4 = "63f4b89dfe8dc87df57e2f023d6e4518ae254bb7e2cecaba2e739398b16cc630";
const user5 = "1e2ad751375bcbcea0914c80655a76f1e63ecbef9fa9635aeaf51467f35c5e5f";
const user6 = "da7f6d2d7d1687c0a6167e4cea5ebefccd2a650dbedac7f47d7189eb023b7bf2";
const user7 = "b0b71f4d79458d8a77d90db12238822c18ecdb36a61b32fc59f05781286d0910";

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.2",
  networks: {
    hardhat: {
      accounts: [
        {privateKey: sce,   balance: '100000000000000000000000000'},
        {privateKey: user1, balance: '10000000000000000000000000'},
        {privateKey: user2, balance: '10000000000000000000000000'},
        {privateKey: user3, balance: '10000000000000000000000000'},
        {privateKey: user4, balance: '10000000000000000000000000'},
        {privateKey: user5, balance: '10000000000000000000000000'},
        {privateKey: user6, balance: '10000000000000000000000000'},
        {privateKey: user7, balance: '10000000000000000000000000'}
      ],
    },
    ganache: {
      url: "HTTP://127.0.0.1:7545",
      accounts: [`0x${sce}`, `0x${user1}`, `0x${user2}`, `0x${user3}`, `0x${user4}`, `0x${user5}`, `0x${user6}`, `0x${user7}`],
      gas: 5000000,
      gasMultiplier: 1.5,
    }
  },
  mocha: {
    timeout: 60000,
  },
};

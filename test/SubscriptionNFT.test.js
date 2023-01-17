const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("SubscriptionNFT contract", () => {
  let tokenContract, sce, user1, user2;

  before(async () => {
    [sce, user1, user2] = await ethers.getSigners();
  });

  beforeEach(async () => {
    let factory = await ethers.getContractFactory("SubscriptionNFT");
    tokenContract = await upgrades.deployProxy(factory, [], { initializer: "initialize" });
    await tokenContract.deployed();
  });

  it("Should set the owner correctly", async () => {
    expect(await tokenContract.owner()).to.equal(sce.address);
  });

  describe("mint", () => {
    it("Non-owner of the contract cannot mint", async () => {
      await expect(tokenContract.connect(user1).mintGold(user1.address)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(tokenContract.connect(user1).mintPlatinum(user1.address)).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("User receives Gold token", async () => {
      await tokenContract.connect(sce).mintGold(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);
    });

    it("User cannot mint Gold token twice", async () => {
      await tokenContract.connect(sce).mintGold(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);

      await expect(tokenContract.connect(sce).mintGold(user1.address)).to.be.revertedWith("_mintToken: token already minted for receiver");
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);
    });

    it("User receives Platinum token", async () => {
      await tokenContract.connect(sce).mintPlatinum(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.PLATINUM())).to.equal(1);
    });

    it("User cannot mint Platinum token twice", async () => {
      await tokenContract.connect(sce).mintPlatinum(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.PLATINUM())).to.equal(1);
      
      await expect(tokenContract.connect(sce).mintPlatinum(user1.address)).to.be.revertedWith("_mintToken: token already minted for receiver");
      expect(await tokenContract.balanceOf(user1.address, tokenContract.PLATINUM())).to.equal(1);
    });

    it("User with Gold token receives Platinum token", async () => {
      await tokenContract.connect(sce).mintGold(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);

      // act
      await tokenContract.connect(sce).mintPlatinum(user1.address);

      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(0);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.PLATINUM())).to.equal(1);
    });

    it("User with Platinum token cannot mint Gold token", async () => {
      await tokenContract.connect(sce).mintPlatinum(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.PLATINUM())).to.equal(1);
      
      await expect(tokenContract.connect(sce).mintGold(user1.address)).to.be.revertedWith("mintGold: already Platinum token holder");
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(0);
    });

    it("Tokens cannot be transfered", async () => {
      await tokenContract.connect(sce).mintGold(user1.address);
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);
      
      await expect(tokenContract.connect(user1).safeTransferFrom(user1.address, user2.address, tokenContract.GOLD(), 1, [])).to.be.revertedWith("_beforeTokenTransfer: token transfer not allowed");
      expect(await tokenContract.balanceOf(user1.address, tokenContract.GOLD())).to.equal(1);
    });
  });
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import '@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol';

//import "hardhat/console.sol"; // just for debugging

contract SubscriptionNFT is ERC1155Upgradeable, AccessControlUpgradeable {
    uint256 private constant ONE_YEAR_EXPIRATION = 31536000; // 1 year (in seconds based on 365 days)
    uint256 public constant GOLD = 1;
    uint256 public constant PLATINUM = 2;
    bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');

    //      user address   => (tokenId => current block timestamp + 1 year)
    mapping(address => mapping(uint256 => uint256)) expirations;    // contains expiration timestamps of all tokens of a particular user

    function initialize() public initializer {
        __AccessControl_init();
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        grantRole(MINTER_ROLE, _msgSender());
    }

    /// @dev For unit testing - allows tests to override block number
    function getBlockTimestamp()
      internal virtual view returns (uint256) {
        return block.timestamp;
    }

    function balanceOf(address account, uint256 id) public view virtual override returns (uint256) {
        if (isExpired(account, id))
            return 0;

        return super.balanceOf(account, id);
    }

    function isExpired(address account, uint256 id) private view returns (bool) {
        return getBlockTimestamp() > expirations[account][id];
    }
    
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC1155Upgradeable, AccessControlUpgradeable)
    returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function mintGold(address to) external onlyRole(MINTER_ROLE) {
        require(balanceOf(to, PLATINUM) == 0, 'mintGold: already Platinum token holder');

        _mintToken(to, GOLD);
    } 

    function mintPlatinum(address to) external onlyRole(MINTER_ROLE) {
        // in case GOLD already issued --> migrate: burn old Gold token before issuing Platinum token
        if (balanceOf(to, GOLD) > 0) {
            _burn(to, GOLD, 1);
        }
        
        _mintToken(to, PLATINUM);
    }

    function _mintToken(address to, uint256 token) private {
        require(balanceOf(to, token) == 0, '_mintToken: token already minted for receiver');

        // only mint it in case there is no expired token yet
        expirations[to][token] = getBlockTimestamp() + ONE_YEAR_EXPIRATION;
        if (balanceOf(to, token) == 0) {
            _mint(to, token, 1, '');
        }
    }

    function burnGold(address from) external onlyRole(MINTER_ROLE) {
        _burnToken(from, GOLD);
        expirations[from][GOLD] = 0;
    } 

    function burnPlatinum(address from) external onlyRole(MINTER_ROLE) {
        _burnToken(from, PLATINUM);
        expirations[from][PLATINUM] = 0;
    } 

    function _burnToken(address from, uint256 token) private {
        require(balanceOf(from, token) > 0, '_burnToken: token not minted for address');

        _burn(from, token, 1);
    }

    function extendExpiration(address account, uint256 id) external onlyRole(MINTER_ROLE) {
        require(balanceOf(account, id) > 0, 'extendExpiration: sender not a token holder');

        uint256 currentExpiration = expirations[account][id];
        expirations[account][id] = currentExpiration + ONE_YEAR_EXPIRATION;
    }

    function getExpiration(address account, uint256 id) external view returns (uint256) {
        return expirations[account][id];
    }

    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal override(ERC1155Upgradeable) {
        require(
            from == address(0) || to == address(0),
            '_beforeTokenTransfer: token transfer not allowed'
        );

        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }
}
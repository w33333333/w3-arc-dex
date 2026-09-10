// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal metadata renderer for ARC testnet V3 position NFTs.
contract W3V3PositionDescriptor {
    function tokenURI(address, uint256 tokenId) external pure returns (string memory) {
        return string.concat("data:application/json,{\"name\":\"W3 ARC V3 Position #", _toString(tokenId), "\",\"description\":\"Concentrated liquidity position on W3 ARC DEX testnet\"}");
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 n = value; uint256 digits;
        while (n != 0) { digits++; n /= 10; }
        bytes memory out = new bytes(digits);
        while (value != 0) { out[--digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
        return string(out);
    }
}

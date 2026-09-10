// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessagingParams, MessagingFee, MessagingReceipt, Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

// LOCAL TESTS ONLY. This endpoint deliberately allows forged messages for negative tests.
interface ITestReceiver { function lzReceive(Origin calldata, bytes32, bytes calldata, address, bytes calldata) external payable; }
contract TestEndpoint {
    struct Packet { address sender; uint32 dstEid; bytes message; bytes32 guid; }
    Packet[] public packets;
    function setDelegate(address) external {}
    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) { return MessagingFee(1000, 0); }
    function send(MessagingParams calldata p, address) external payable returns (MessagingReceipt memory) {
        require(msg.value == 1000, "Test fee");
        bytes32 guid = keccak256(abi.encode(address(this), packets.length, p.message));
        packets.push(Packet(msg.sender, p.dstEid, p.message, guid));
        return MessagingReceipt(guid, uint64(packets.length), MessagingFee(1000, 0));
    }
    function deliver(address receiver, uint32 srcEid, bytes32 sender, uint64 seq, bytes32 guid, bytes calldata message) external {
        ITestReceiver(receiver).lzReceive(Origin(srcEid, sender, seq), guid, message, address(0), "");
    }
}
contract TestToken is ERC20 {
    uint8 private immutable precision;
    bool public taxed;
    constructor(uint8 d) ERC20("Test token", "TEST") { precision = d; }
    function decimals() public view override returns (uint8) { return precision; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setTaxed(bool value) external { taxed = value; }
    function _update(address from, address to, uint256 value) internal override {
        if (taxed && from != address(0) && to != address(0) && value > 100) {
            super._update(from, address(0), value / 100);
            super._update(from, to, value - value / 100);
        } else super._update(from, to, value);
    }
}

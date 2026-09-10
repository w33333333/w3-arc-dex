// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {OApp, Origin, MessagingFee} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Experimental two-chain inventory exchange; NOT an OFT or Stargate pool.
/// @dev No timeout refund: only an authenticated destination rejection releases escrow.
///      Destination claims do not depend on the result message being delivered.
contract InventoryBridge is OApp, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using OptionsBuilder for bytes;

    enum OutState { None, Pending, Settled, Refundable, Refunded }
    enum InState { None, Reserved, Rejected, Claimed }
    struct Outbound { address user; uint256 amount; OutState state; }
    struct Inbound { address user; uint256 amount; InState state; }

    IERC20 public immutable token;
    uint32 public immutable remoteEid;
    uint256 public immutable scale;
    uint256 public constant MAX_SD = 1_000_000; // one whole token per test swap
    uint256 public freeLiquidity;
    uint256 public escrowed;
    uint256 public reserved;
    uint256 public refundable;
    uint256 public nonce;
    bool public paused = true;
    mapping(bytes32 => Outbound) public outbound;
    mapping(bytes32 => Inbound) public inbound;

    event SwapRequested(bytes32 indexed id, address indexed user, uint256 amount, bytes32 guid);
    event Decision(bytes32 indexed id, bool accepted);
    event ResultSent(bytes32 indexed id, bytes32 guid);
    event Settled(bytes32 indexed id, bool accepted);
    event Claimed(bytes32 indexed id, address to, bool refund);
    event LiquidityChanged(uint256 freeLiquidity);
    event Paused(bool value);

    constructor(address token_, address endpoint_, address owner_, uint32 remoteEid_)
        OApp(endpoint_, owner_) Ownable(owner_)
    {
        require(token_.code.length > 0 && remoteEid_ != 0, "Invalid config");
        uint8 decimals = IERC20Metadata(token_).decimals();
        require(decimals >= 6 && decimals <= 18, "Unsupported decimals");
        token = IERC20(token_);
        scale = 10 ** (decimals - 6);
        remoteEid = remoteEid_;
    }

    /// @dev One permanent peer, preventing route changes while requests are in flight.
    function setPeer(uint32 eid, bytes32 peer) public override onlyOwner {
        require(eid == remoteEid && peer != bytes32(0) && peers[eid] == bytes32(0), "Peer fixed");
        require(uint256(peer) <= type(uint160).max, "EVM peer only");
        _setPeer(eid, peer);
    }

    function setPaused(bool value) external onlyOwner {
        if (!value) require(peers[remoteEid] != bytes32(0), "Missing peer");
        paused = value;
        emit Paused(value);
    }

    function fund(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Zero amount");
        _pull(msg.sender, amount);
        freeLiquidity += amount;
        emit LiquidityChanged(freeLiquidity);
    }

    /// @notice Only free inventory can be withdrawn; pending swaps and claims are protected.
    function withdrawFree(uint256 amount, address to) external onlyOwner nonReentrant {
        require(amount > 0 && amount <= freeLiquidity, "Insufficient free liquidity");
        freeLiquidity -= amount;
        _push(to, amount);
        emit LiquidityChanged(freeLiquidity);
    }

    function options() public pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(250_000, 0);
    }

    function _request(bytes32 id, address user, uint256 amount, uint64 deadline) private view returns (bytes memory) {
        require(amount > 0 && amount % scale == 0 && amount / scale <= MAX_SD, "Amount: 0.000001 to 1");
        return abi.encode(uint8(1), id, user, amount / scale, deadline);
    }

    function nextId(address user) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), nonce, user));
    }

    function quoteSwap(address user, uint256 amount, uint64 deadline) external view returns (MessagingFee memory) {
        return _quote(remoteEid, _request(nextId(user), user, amount, deadline), options(), false);
    }

    function swap(uint256 amount, uint64 deadline) external payable nonReentrant returns (bytes32 id) {
        require(!paused, "Paused");
        require(deadline > block.timestamp && deadline <= block.timestamp + 7 days, "Deadline");
        id = nextId(msg.sender);
        bytes memory message = _request(id, msg.sender, amount, deadline);
        nonce++;
        _pull(msg.sender, amount);
        outbound[id] = Outbound(msg.sender, amount, OutState.Pending);
        escrowed += amount;
        bytes32 guid = _lzSend(remoteEid, message, options(), MessagingFee(msg.value, 0), payable(msg.sender)).guid;
        emit SwapRequested(id, msg.sender, amount, guid);
    }

    function _result(bytes32 id) private view returns (bytes memory) {
        InState state = inbound[id].state;
        require(state != InState.None, "Request not received");
        return abi.encode(uint8(2), id, state != InState.Rejected);
    }

    function quoteResult(bytes32 id) external view returns (MessagingFee memory) {
        return _quote(remoteEid, _result(id), options(), false);
    }

    function quoteResultFee() external view returns (MessagingFee memory) {
        return _quote(remoteEid, abi.encode(uint8(2), bytes32(0), true), options(), false);
    }

    /// @notice Anyone may pay destination-chain gas to relay the fixed result. Safe to repeat.
    function relayResult(bytes32 id) external payable nonReentrant {
        bytes32 guid = _lzSend(remoteEid, _result(id), options(), MessagingFee(msg.value, 0), payable(msg.sender)).guid;
        emit ResultSent(id, guid);
    }

    function claim(bytes32 id, address to) external nonReentrant {
        Inbound storage item = inbound[id];
        require(item.user == msg.sender && item.state == InState.Reserved, "Not claimable");
        item.state = InState.Claimed;
        reserved -= item.amount;
        _push(to, item.amount);
        emit Claimed(id, to, false);
    }

    function claimRefund(bytes32 id, address to) external nonReentrant {
        Outbound storage item = outbound[id];
        require(item.user == msg.sender && item.state == OutState.Refundable, "Not refundable");
        item.state = OutState.Refunded;
        refundable -= item.amount;
        _push(to, item.amount);
        emit Claimed(id, to, true);
    }

    function _lzReceive(Origin calldata origin, bytes32, bytes calldata message, address, bytes calldata)
        internal override nonReentrant
    {
        require(origin.srcEid == remoteEid, "Wrong chain");
        uint8 kind = abi.decode(message, (uint8));
        if (kind == 1) {
            (, bytes32 id, address user, uint256 amountSD, uint64 deadline) =
                abi.decode(message, (uint8, bytes32, address, uint256, uint64));
            if (inbound[id].state != InState.None) return;
            require(user != address(0) && amountSD > 0 && amountSD <= MAX_SD, "Bad request");
            uint256 amount = amountSD * scale;
            bool accepted = !paused && block.timestamp <= deadline && freeLiquidity >= amount;
            inbound[id] = Inbound(user, amount, accepted ? InState.Reserved : InState.Rejected);
            if (accepted) { freeLiquidity -= amount; reserved += amount; }
            emit Decision(id, accepted);
        } else {
            require(kind == 2, "Bad message");
            (, bytes32 id, bool accepted) = abi.decode(message, (uint8, bytes32, bool));
            Outbound storage item = outbound[id];
            require(item.state != OutState.None, "Unknown request");
            if (item.state != OutState.Pending) return;
            escrowed -= item.amount;
            if (accepted) { item.state = OutState.Settled; freeLiquidity += item.amount; }
            else { item.state = OutState.Refundable; refundable += item.amount; }
            emit Settled(id, accepted);
        }
    }

    function _pull(address from, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 fromBalance = token.balanceOf(from);
        token.safeTransferFrom(from, address(this), amount);
        require(token.balanceOf(address(this)) == beforeBalance + amount && token.balanceOf(from) + amount == fromBalance,
            "Lossy token unsupported");
    }

    function _push(address to, uint256 amount) private {
        require(to != address(0) && to != address(this), "Invalid recipient");
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 toBalance = token.balanceOf(to);
        token.safeTransfer(to, amount);
        require(token.balanceOf(address(this)) + amount == beforeBalance && token.balanceOf(to) == toBalance + amount,
            "Lossy token unsupported");
    }
}

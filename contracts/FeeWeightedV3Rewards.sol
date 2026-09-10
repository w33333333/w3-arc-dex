// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IFWToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFWFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IFWPool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool);
}

interface IFWPositionManager {
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external;
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator, address token0, address token1, uint24 fee,
        int24 tickLower, int24 tickUpper, uint128 liquidity,
        uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
        uint128 tokensOwed0, uint128 tokensOwed1
    );
}

contract FeeWeightedV3Rewards {
    uint256 public constant DURATION = 7 days;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q192 = 1 << 192;

    struct Campaign {
        uint64 start;
        uint64 end;
        uint64 finalizeCursor;
        bool finalized;
        uint256 reward;
        uint256 claimed;
        uint256 totalScore;
    }
    struct Deposit {
        address owner;
        address pool;
        uint64 campaignId;
        uint128 fee0Start;
        uint128 fee1Start;
        uint256 score;
        bool active;
        bool checkpointed;
        bool claimed;
    }

    IFWToken public immutable w3;
    address public immutable usdc;
    IFWFactory public immutable factory;
    IFWPositionManager public immutable positionManager;
    mapping(address => uint64) public currentCampaignId;
    mapping(address => mapping(uint64 => Campaign)) public campaigns;
    mapping(address => mapping(uint64 => uint256[])) private campaignTokenIds;
    mapping(uint256 => Deposit) public deposits;
    uint256 private locked = 1;

    event IncentiveAdded(address indexed pool, uint64 indexed campaignId, address indexed funder, uint256 amount, uint256 end);
    event PositionStaked(address indexed pool, uint64 indexed campaignId, uint256 indexed tokenId, address owner);
    event PositionCheckpointed(address indexed pool, uint64 indexed campaignId, uint256 indexed tokenId, uint256 score);
    event RewardClaimed(uint256 indexed tokenId, address indexed owner, uint256 amount);
    event PositionWithdrawn(uint256 indexed tokenId, address indexed owner);

    modifier nonReentrant() { require(locked == 1, "REENTRANT"); locked = 2; _; locked = 1; }

    constructor(address w3_, address usdc_, address factory_, address positionManager_) {
        w3 = IFWToken(w3_); usdc = usdc_; factory = IFWFactory(factory_); positionManager = IFWPositionManager(positionManager_);
    }

    function addIncentive(address pool, uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        uint64 id = currentCampaignId[pool];
        Campaign storage campaign = campaigns[pool][id];
        if (id == 0 || campaign.finalized) {
            id += 1;
            currentCampaignId[pool] = id;
            campaign = campaigns[pool][id];
            campaign.start = uint64(block.timestamp);
        } else {
            require(block.timestamp < campaign.end || campaign.finalizeCursor == 0, "FINALIZING");
        }
        campaign.end = uint64(block.timestamp + DURATION);
        campaign.reward += amount;
        require(w3.transferFrom(msg.sender, address(this), amount), "TRANSFER_FROM");
        emit IncentiveAdded(pool, id, msg.sender, amount, campaign.end);
    }

    function stake(uint256 tokenId) external nonReentrant {
        require(deposits[tokenId].owner == address(0), "ALREADY_STAKED");
        (, , address token0, address token1, uint24 fee, , , uint128 liquidity, , , , ) = positionManager.positions(tokenId);
        require(liquidity > 0 && token0 == usdc && token1 == address(w3), "UNSUPPORTED_POSITION");
        address pool = factory.getPool(token0, token1, fee);
        uint64 id = currentCampaignId[pool];
        Campaign storage campaign = campaigns[pool][id];
        require(id != 0 && block.timestamp < campaign.end, "NO_ACTIVE_CAMPAIGN");
        positionManager.safeTransferFrom(msg.sender, address(this), tokenId);
        _poke(tokenId);
        (, , , , , , , , , , uint128 owed0, uint128 owed1) = positionManager.positions(tokenId);
        deposits[tokenId] = Deposit(msg.sender, pool, id, owed0, owed1, 0, true, false, false);
        campaignTokenIds[pool][id].push(tokenId);
        emit PositionStaked(pool, id, tokenId, msg.sender);
    }

    function finalize(address pool, uint256 maxPositions) external nonReentrant {
        uint64 id = currentCampaignId[pool];
        Campaign storage campaign = campaigns[pool][id];
        require(id != 0 && block.timestamp >= campaign.end && !campaign.finalized, "NOT_FINALIZABLE");
        uint256[] storage ids = campaignTokenIds[pool][id];
        uint256 cursor = campaign.finalizeCursor;
        uint256 end = cursor + maxPositions;
        if (end > ids.length) end = ids.length;
        for (; cursor < end; cursor++) _checkpoint(ids[cursor], campaign);
        campaign.finalizeCursor = uint64(cursor);
        if (cursor == ids.length) campaign.finalized = true;
    }

    function claim(uint256 tokenId) external nonReentrant returns (uint256 amount) {
        Deposit storage deposit = deposits[tokenId];
        require(deposit.owner == msg.sender && !deposit.claimed, "NOT_CLAIMABLE");
        Campaign storage campaign = campaigns[deposit.pool][deposit.campaignId];
        require(campaign.finalized && campaign.totalScore > 0, "NOT_FINALIZED");
        deposit.claimed = true;
        amount = campaign.reward * deposit.score / campaign.totalScore;
        campaign.claimed += amount;
        require(w3.transfer(msg.sender, amount), "TRANSFER");
        emit RewardClaimed(tokenId, msg.sender, amount);
    }

    function withdraw(uint256 tokenId) external nonReentrant {
        Deposit storage deposit = deposits[tokenId];
        require(deposit.owner == msg.sender, "NOT_OWNER");
        Campaign storage campaign = campaigns[deposit.pool][deposit.campaignId];
        require(campaign.finalized, "FINALIZE_FIRST");
        deposit.active = false;
        positionManager.safeTransferFrom(address(this), msg.sender, tokenId);
        emit PositionWithdrawn(tokenId, msg.sender);
    }

    function campaignInfo(address pool) external view returns (uint64 id, Campaign memory campaign, uint256 positionCount) {
        id = currentCampaignId[pool]; campaign = campaigns[pool][id]; positionCount = campaignTokenIds[pool][id].length;
    }

    function pendingReward(uint256 tokenId) external view returns (uint256) {
        Deposit memory deposit = deposits[tokenId];
        Campaign memory campaign = campaigns[deposit.pool][deposit.campaignId];
        if (!campaign.finalized || campaign.totalScore == 0 || deposit.claimed) return 0;
        return campaign.reward * deposit.score / campaign.totalScore;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(positionManager), "ONLY_NFPM");
        return this.onERC721Received.selector;
    }

    function _poke(uint256 tokenId) internal {
        positionManager.collect(IFWPositionManager.CollectParams(tokenId, address(this), 0, 0));
    }

    function _checkpoint(uint256 tokenId, Campaign storage campaign) internal {
        Deposit storage deposit = deposits[tokenId];
        if (deposit.checkpointed) return;
        if (deposit.active) _poke(tokenId);
        (, , , , , , , , , , uint128 owed0, uint128 owed1) = positionManager.positions(tokenId);
        uint256 fee0 = uint256(owed0) - deposit.fee0Start;
        uint256 fee1 = uint256(owed1) - deposit.fee1Start;
        deposit.score = fee0 + _w3ToUsdc(deposit.pool, fee1);
        deposit.checkpointed = true;
        campaign.totalScore += deposit.score;
        emit PositionCheckpointed(deposit.pool, deposit.campaignId, tokenId, deposit.score);
    }

    function _w3ToUsdc(address pool, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        (uint160 sqrtPriceX96, , , , , , ) = IFWPool(pool).slot0();
        uint256 first = Q192 / uint256(sqrtPriceX96);
        require(amount <= type(uint256).max / first, "PRICE_OVERFLOW");
        return amount * first / uint256(sqrtPriceX96);
    }
}

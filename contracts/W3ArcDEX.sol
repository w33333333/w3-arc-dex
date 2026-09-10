// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

library SafeTransfer {
    error TransferFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}

contract LPToken {
    string public constant name = "W3 Arc LP";
    string public constant symbol = "W3-LP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "ZERO_TO");
        balanceOf[from] -= value;
        unchecked { balanceOf[to] += value; }
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }
}

contract W3Pool is LPToken {
    using SafeTransfer for address;
    uint256 private constant MINIMUM_LIQUIDITY = 1_000;
    uint256 private constant FEE_DENOMINATOR = 1_000_000;

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable feePpm;
    uint112 public reserve0;
    uint112 public reserve1;

    error Locked();
    error InvalidTo();
    error InsufficientLiquidity();
    error InvalidInvariant();
    uint256 private unlocked = 1;
    modifier lock() { if (unlocked != 1) revert Locked(); unlocked = 0; _; unlocked = 1; }

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address token0_, address token1_, uint24 feePpm_) {
        factory = msg.sender;
        token0 = token0_;
        token1 = token1_;
        feePpm = feePpm_;
    }

    function mint(address to) external lock returns (uint256 liquidity) {
        (uint112 r0, uint112 r1) = (reserve0, reserve1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 a0 = b0 - r0;
        uint256 a1 = b1 - r1;
        if (totalSupply == 0) {
            liquidity = _sqrt(a0 * a1) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = _min(a0 * totalSupply / r0, a1 * totalSupply / r1);
        }
        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);
        _update(b0, b1);
        emit Mint(msg.sender, a0, a1, to);
    }

    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        if (to == token0 || to == token1) revert InvalidTo();
        uint256 liquidity = balanceOf[address(this)];
        uint256 supply = totalSupply;
        amount0 = liquidity * IERC20(token0).balanceOf(address(this)) / supply;
        amount1 = liquidity * IERC20(token1).balanceOf(address(this)) / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();
        _burn(address(this), liquidity);
        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external lock {
        if ((amount0Out == 0 && amount1Out == 0) || amount0Out >= reserve0 || amount1Out >= reserve1) revert InsufficientLiquidity();
        if (to == token0 || to == token1) revert InvalidTo();
        if (amount0Out != 0) token0.safeTransfer(to, amount0Out);
        if (amount1Out != 0) token1.safeTransfer(to, amount1Out);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = b0 > reserve0 - amount0Out ? b0 - (reserve0 - amount0Out) : 0;
        uint256 amount1In = b1 > reserve1 - amount1Out ? b1 - (reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientLiquidity();
        uint256 adjusted0 = b0 * FEE_DENOMINATOR - amount0In * feePpm;
        uint256 adjusted1 = b1 * FEE_DENOMINATOR - amount1In * feePpm;
        if (adjusted0 * adjusted1 < uint256(reserve0) * reserve1 * FEE_DENOMINATOR ** 2) revert InvalidInvariant();
        _update(b0, b1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    function _update(uint256 b0, uint256 b1) private {
        require(b0 <= type(uint112).max && b1 <= type(uint112).max, "OVERFLOW");
        reserve0 = uint112(b0); reserve1 = uint112(b1);
        emit Sync(reserve0, reserve1);
    }
    function _min(uint256 x, uint256 y) private pure returns (uint256) { return x < y ? x : y; }
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y == 0) return 0;
        z = y; uint256 x = y / 2 + 1;
        while (x < z) { z = x; x = (y / x + x) / 2; }
    }
}

contract W3PoolFactory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;
    mapping(address => bool) public isPool;
    address[] public allPools;
    event PoolCreated(address indexed token0, address indexed token1, uint24 indexed feePpm, address pool);

    function isSupportedFee(uint24 feePpm) public pure returns (bool) {
        return feePpm == 100 || feePpm == 500 || feePpm == 3_000;
    }

    function createPool(address tokenA, address tokenB, uint24 feePpm) external returns (address pool) {
        require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "INVALID_TOKENS");
        require(isSupportedFee(feePpm), "UNSUPPORTED_FEE");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(getPool[token0][token1][feePpm] == address(0), "POOL_EXISTS");
        bytes32 salt = keccak256(abi.encode(token0, token1, feePpm));
        pool = address(new W3Pool{salt: salt}(token0, token1, feePpm));
        getPool[token0][token1][feePpm] = pool;
        getPool[token1][token0][feePpm] = pool;
        isPool[pool] = true;
        allPools.push(pool);
        emit PoolCreated(token0, token1, feePpm, pool);
    }

    function allPoolsLength() external view returns (uint256) { return allPools.length; }
}

contract W3Router {
    using SafeTransfer for address;
    uint256 private constant FEE_DENOMINATOR = 1_000_000;
    W3PoolFactory public immutable factory;
    error Expired();
    error Slippage();

    constructor(address factory_) { factory = W3PoolFactory(factory_); }
    modifier ensure(uint256 deadline) { if (block.timestamp > deadline) revert Expired(); _; }

    function addLiquidity(address tokenA, address tokenB, uint24 feePpm, uint256 amountA, uint256 amountB, uint256 minLiquidity, address to, uint256 deadline) external ensure(deadline) returns (uint256 liquidity) {
        address pool = factory.getPool(tokenA, tokenB, feePpm);
        if (pool == address(0)) pool = factory.createPool(tokenA, tokenB, feePpm);
        tokenA.safeTransferFrom(msg.sender, pool, amountA);
        tokenB.safeTransferFrom(msg.sender, pool, amountB);
        liquidity = W3Pool(pool).mint(to);
        if (liquidity < minLiquidity) revert Slippage();
    }

    function removeLiquidity(address tokenA, address tokenB, uint24 feePpm, uint256 liquidity, uint256 minA, uint256 minB, address to, uint256 deadline) external ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pool = factory.getPool(tokenA, tokenB, feePpm);
        require(pool != address(0), "NO_POOL");
        pool.safeTransferFrom(msg.sender, pool, liquidity);
        (uint256 a0, uint256 a1) = W3Pool(pool).burn(to);
        (amountA, amountB) = tokenA == W3Pool(pool).token0() ? (a0, a1) : (a1, a0);
        if (amountA < minA || amountB < minB) revert Slippage();
    }

    function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut, uint24 feePpm) public view returns (uint256) {
        address pool = factory.getPool(tokenIn, tokenOut, feePpm);
        require(pool != address(0), "NO_POOL");
        (uint112 r0, uint112 r1) = (W3Pool(pool).reserve0(), W3Pool(pool).reserve1());
        (uint256 reserveIn, uint256 reserveOut) = tokenIn == W3Pool(pool).token0() ? (r0, r1) : (r1, r0);
        uint256 amountInAfterFee = amountIn * (FEE_DENOMINATOR - feePpm);
        return amountInAfterFee * reserveOut / (reserveIn * FEE_DENOMINATOR + amountInAfterFee);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address tokenIn, address tokenOut, uint24 feePpm, address to, uint256 deadline) external ensure(deadline) returns (uint256 amountOut) {
        address pool = factory.getPool(tokenIn, tokenOut, feePpm);
        amountOut = getAmountOut(amountIn, tokenIn, tokenOut, feePpm);
        if (amountOut < minOut) revert Slippage();
        tokenIn.safeTransferFrom(msg.sender, pool, amountIn);
        bool zeroForOne = tokenIn == W3Pool(pool).token0();
        W3Pool(pool).swap(zeroForOne ? 0 : amountOut, zeroForOne ? amountOut : 0, to);
    }
}

contract W3Gauge {
    using SafeTransfer for address;
    uint256 private constant PRECISION = 1e18;
    address public immutable stakingToken;
    address public immutable rewardToken;
    uint256 public totalSupply;
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    constructor(address stakingToken_, address rewardToken_) { stakingToken = stakingToken_; rewardToken = rewardToken_; }
    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken(); lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) { rewards[account] = earned(account); userRewardPerTokenPaid[account] = rewardPerTokenStored; }
        _;
    }
    function lastTimeRewardApplicable() public view returns (uint256) { return block.timestamp < periodFinish ? block.timestamp : periodFinish; }
    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + (lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * PRECISION / totalSupply;
    }
    function earned(address account) public view returns (uint256) { return balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account]) / PRECISION + rewards[account]; }
    function deposit(uint256 amount) external updateReward(msg.sender) { require(amount != 0, "ZERO_AMOUNT"); totalSupply += amount; balanceOf[msg.sender] += amount; stakingToken.safeTransferFrom(msg.sender, address(this), amount); }
    function withdraw(uint256 amount) external updateReward(msg.sender) { totalSupply -= amount; balanceOf[msg.sender] -= amount; stakingToken.safeTransfer(msg.sender, amount); }
    function getReward() external updateReward(msg.sender) { uint256 reward = rewards[msg.sender]; rewards[msg.sender] = 0; rewardToken.safeTransfer(msg.sender, reward); }
    function notifyRewardAmount(uint256 reward, uint256 duration) external updateReward(address(0)) {
        require(reward != 0 && duration != 0, "INVALID_REWARD");
        require(block.timestamp >= periodFinish, "ACTIVE_PERIOD");
        rewardToken.safeTransferFrom(msg.sender, address(this), reward);
        rewardRate = reward / duration;
        require(rewardRate != 0 && rewardRate * duration <= IERC20(rewardToken).balanceOf(address(this)), "BAD_RATE");
        lastUpdateTime = block.timestamp; periodFinish = block.timestamp + duration;
    }
}

contract W3GaugeFactory {
    W3PoolFactory public immutable poolFactory;
    address public immutable w3;
    mapping(address => address) public gaugeForPool;
    event GaugeCreated(address indexed pool, address indexed gauge);
    constructor(address poolFactory_, address w3_) { poolFactory = W3PoolFactory(poolFactory_); w3 = w3_; }
    function createGauge(address pool) external returns (address gauge) {
        require(poolFactory.isPool(pool), "NOT_POOL"); require(gaugeForPool[pool] == address(0), "GAUGE_EXISTS");
        gauge = address(new W3Gauge(pool, w3)); gaugeForPool[pool] = gauge; emit GaugeCreated(pool, gauge);
    }
}

contract TestW3 {
    string public constant name = "W3 Test Token";
    string public constant symbol = "W3";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    constructor(address to, uint256 supply) { totalSupply = supply; balanceOf[to] = supply; emit Transfer(address(0), to, supply); }
    function approve(address spender, uint256 value) external returns (bool) { allowance[msg.sender][spender] = value; emit Approval(msg.sender, spender, value); return true; }
    function transfer(address to, uint256 value) external returns (bool) { balanceOf[msg.sender] -= value; balanceOf[to] += value; emit Transfer(msg.sender, to, value); return true; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) { uint256 allowed = allowance[from][msg.sender]; if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - value; balanceOf[from] -= value; balanceOf[to] += value; emit Transfer(from, to, value); return true; }
}

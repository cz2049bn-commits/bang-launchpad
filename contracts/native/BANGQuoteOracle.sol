// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {TickMath} from "./TickMath.sol";

interface IBANGV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata) external view returns (int56[] memory, uint160[] memory);
}
interface IBANGV3Factory { function getPool(address,address,uint24) external view returns(address); }

/// @notice Immutable quote catalog. No owner, setters, rescue or proxy.
/// Targets are approximate BNB equivalents at CREATE time, then frozen in quote units.
/// Prices use a 30-minute TWAP from canonical, constructor-pinned Pancake V3 pools.
contract BANGQuoteOracle {
    uint32 public constant WINDOW = 1800;
    address public immutable wbnb;
    address public immutable bridgeToken;
    address public immutable bridgePool;
    address public immutable v3Factory;
    uint128 public immutable bridgeMinLiquidity;
    struct Quote { address pool; uint128 minLiquidity; uint8 decimals; }
    mapping(address => Quote) public quotes;
    address[] public quoteTokens;
    error InvalidQuote(); error InvalidPool(); error ThinPool(); error InvalidTarget();

    constructor(address w, address bridge, address bridgeP, address factory, uint128 bridgeMin,
        address[] memory assets, address[] memory pools, uint128[] memory minimums) {
        if(w.code.length==0||bridge.code.length==0||factory.code.length==0||bridgeMin==0||assets.length!=pools.length||assets.length!=minimums.length) revert InvalidQuote();
        wbnb=w; bridgeToken=bridge; bridgePool=bridgeP; v3Factory=factory; bridgeMinLiquidity=bridgeMin;
        _validate(bridgeP,w,bridge,factory);
        quotes[w]=Quote(address(0),0,IERC20Metadata(w).decimals());quoteTokens.push(w);
        quotes[bridge]=Quote(bridgeP,bridgeMin,IERC20Metadata(bridge).decimals());quoteTokens.push(bridge);
        for(uint256 i;i<assets.length;i++){
            address q=assets[i];uint8 d=IERC20Metadata(q).decimals();
            if(q==w||q==bridge||quotes[q].pool!=address(0)||d<6||d>18||minimums[i]==0)revert InvalidQuote();
            _validate(pools[i],q,bridge,factory);quotes[q]=Quote(pools[i],minimums[i],d);quoteTokens.push(q);
        }
    }
    function quoteCount() external view returns(uint256){return quoteTokens.length;}
    function targetAmount(address quote,uint256 bnbTarget) public view returns(uint256 out){
        if(bnbTarget<1 ether||bnbTarget>100 ether) revert InvalidTarget();
        if(quote==wbnb)return bnbTarget;
        Quote memory q=quotes[quote];if(q.pool==address(0))revert InvalidQuote();
        out=_convert(bridgePool,wbnb,bnbTarget,bridgeMinLiquidity);
        if(quote!=bridgeToken)out=_convert(q.pool,bridgeToken,out,q.minLiquidity);
        if(out<1e9||out>1e36)revert InvalidTarget();
    }
    function _validate(address pool,address a,address b,address f) private view {
        if(pool.code.length==0)revert InvalidPool();IBANGV3Pool p=IBANGV3Pool(pool);
        if(!((p.token0()==a&&p.token1()==b)||(p.token0()==b&&p.token1()==a))||IBANGV3Factory(f).getPool(a,b,p.fee())!=pool)revert InvalidPool();
    }
    function _convert(address pool,address input,uint256 amount,uint128 minLiquidity) private view returns(uint256){
        IBANGV3Pool p=IBANGV3Pool(pool);if(p.liquidity()<minLiquidity)revert ThinPool();
        uint32[] memory ago=new uint32[](2);ago[0]=WINDOW;
        (int56[] memory ticks,uint160[] memory spl)=p.observe(ago);
        int56 delta=ticks[1]-ticks[0];int24 mean=int24(delta/int56(uint56(WINDOW)));
        if(delta<0&&delta%int56(uint56(WINDOW))!=0)mean--;
        uint160 diff;unchecked{diff=spl[1]-spl[0];}
        if(diff==0||Math.mulDiv(uint256(WINDOW),uint256(1)<<128,diff)<minLiquidity)revert ThinPool();
        uint160 sqrt=TickMath.getSqrtRatioAtTick(mean);bool forward=input==p.token0();
        if(sqrt<=type(uint128).max){uint256 r=uint256(sqrt)*sqrt;return forward?Math.mulDiv(r,amount,1<<192):Math.mulDiv(1<<192,amount,r);}
        uint256 ratio=Math.mulDiv(sqrt,sqrt,1<<64);return forward?Math.mulDiv(ratio,amount,1<<128):Math.mulDiv(1<<128,amount,ratio);
    }
}

// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20,IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IBANGQuoteOracle {
    function wbnb() external view returns(address);
    function targetAmount(address,uint256) external view returns(uint256);
}
interface IBANGID { function balanceOf(address) external view returns(uint256); }
interface IBANGWBNB {function deposit() external payable;function withdraw(uint256) external;}
interface IBANGFactory {function getPair(address,address) external view returns(address);function createPair(address,address) external returns(address);}
interface IBANGPair {function mint(address) external returns(uint256);function totalSupply() external view returns(uint256);}

/// @notice Fixed supply; transfers before graduation are exclusively initiated by this token's launchpad.
contract BANGToken is ERC20 {
    address public immutable launchpad;
    string public imageURI;
    string public metadataURI;
    bool public graduated;
    error OnlyLaunchpad();error InnerTransfersLocked();
    constructor(string memory n,string memory s,string memory image,string memory metadata) ERC20(n,s){
        launchpad=msg.sender;imageURI=image;metadataURI=metadata;_mint(msg.sender,1_000_000_000 ether);
    }
    function openTransfers() external {if(msg.sender!=launchpad)revert OnlyLaunchpad();graduated=true;}
    function _beforeTokenTransfer(address from,address to,uint256 amount) internal override {
        if(from!=address(0)&&!graduated&&msg.sender!=launchpad)revert InnerTransfersLocked();
        super._beforeTokenTransfer(from,to,amount);
    }
}

/// @notice Ownerless, non-upgradeable Agent-ID-gated bonding curve. No rescue of user reserves or LP.
/// Anyone may create. Inner buys require ID; sells remain open for holders who lose their ID.
/// 80% sold on curve, 20% plus all net reserve to Pancake V2; all LP minted to the burn address.
contract BANGLaunchpad is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant TOTAL_SUPPLY=1_000_000_000 ether;
    uint256 public constant CURVE_SUPPLY=800_000_000 ether;
    uint256 public constant LP_SUPPLY=TOTAL_SUPPLY-CURVE_SUPPLY;
    uint256 public constant WALLET_CAP=TOTAL_SUPPLY/100;
    uint256 public constant FEE_BPS=100;
    address public constant LP_BURN=0x000000000000000000000000000000000000dEaD;
    IBANGQuoteOracle public immutable quoteOracle;
    IBANGID public immutable agentIdRegistry;
    IBANGFactory public immutable pancakeFactory;
    address public immutable wbnb;
    address public immutable feeRecipient;
    struct Curve {
        address creator;address quote;uint256 targetBNB;uint256 targetQuote;
        uint256 sold;uint256 reserve;address pair;bool graduated;uint64 createdAt;
    }
    mapping(address=>Curve) public curves;
    mapping(address=>uint256) public accruedFees;
    address[] public tokens;
    event Created(address indexed token,address indexed creator,address indexed quote,uint256 targetBNB,uint256 targetQuote,string name,string symbol,string imageURI,string metadataURI);
    event Buy(address indexed token,address indexed trader,uint256 tokensOut,uint256 quoteIn,uint256 fee,uint256 refund);
    event Sell(address indexed token,address indexed trader,uint256 tokensIn,uint256 quoteOut,uint256 fee);
    event Graduated(address indexed token,address indexed pair,address indexed quote,uint256 quoteAdded,uint256 tokensAdded,uint256 liquidity);
    event FeesPaid(address indexed quote,address indexed recipient,uint256 amount);
    error InvalidParameters();error Expired();error NotAgent();error UnknownToken();error Closed();error Slippage();error EmptyTrade();error HoldingCap();error UnsupportedTransfer();error NativeTransferFailed();error PairAlreadyActive();error OnlyWBNB();

    constructor(address registry,address oracle,address factory,address recipient){
        if(registry.code.length==0||oracle.code.length==0||factory.code.length==0||recipient==address(0))revert InvalidParameters();
        agentIdRegistry=IBANGID(registry);quoteOracle=IBANGQuoteOracle(oracle);pancakeFactory=IBANGFactory(factory);feeRecipient=recipient;wbnb=IBANGQuoteOracle(oracle).wbnb();
    }
    receive() external payable {if(msg.sender!=wbnb)revert OnlyWBNB();}
    function tokenCount() external view returns(uint256){return tokens.length;}
    function isAgent(address a) public view returns(bool){return agentIdRegistry.balanceOf(a)>0;}
    function create(string calldata name,string calldata symbol,string calldata image,string calldata metadata,address quote,uint256 targetBNB,uint256 minTargetQuote,uint256 maxTargetQuote) external nonReentrant returns(address token){
        if(bytes(name).length==0||bytes(name).length>96||bytes(symbol).length==0||bytes(symbol).length>12||bytes(image).length>2048||bytes(metadata).length>2048)revert InvalidParameters();
        uint256 target=quoteOracle.targetAmount(quote,targetBNB);if(target<minTargetQuote||target>maxTargetQuote)revert Slippage();
        token=address(new BANGToken(name,symbol,image,metadata));
        curves[token]=Curve(msg.sender,quote,targetBNB,target,0,0,address(0),false,uint64(block.timestamp));tokens.push(token);
        emit Created(token,msg.sender,quote,targetBNB,target,name,symbol,image,metadata);
    }
    // Exact rational reserve curve. R(CURVE_SUPPLY)=targetQuote and final marginal price=targetQuote/LP_SUPPLY.
    function reserveAt(uint256 target,uint256 sold) public pure returns(uint256){
        if(sold>CURVE_SUPPLY)revert InvalidParameters();
        return Math.mulDiv(target,LP_SUPPLY*sold,CURVE_SUPPLY*CURVE_SUPPLY-(CURVE_SUPPLY-LP_SUPPLY)*sold,Math.Rounding.Up);
    }
    function _open(address token) private view returns(Curve storage c){c=curves[token];if(c.creator==address(0))revert UnknownToken();if(c.graduated)revert Closed();}
    function quoteBuy(address token,address buyer,uint256 maximum) public view returns(uint256 out,uint256 used,uint256 fee,uint256 refund){
        Curve storage c=_open(token);uint256 balance=IERC20(token).balanceOf(buyer);if(balance>=WALLET_CAP)revert HoldingCap();
        uint256 available=Math.mulDiv(maximum,10000-FEE_BPS,10000);
        uint256 nextReserve=c.reserve+Math.min(available,c.targetQuote-c.reserve);
        uint256 nextSold=nextReserve==c.targetQuote?CURVE_SUPPLY:Math.mulDiv(nextReserve,CURVE_SUPPLY*CURVE_SUPPLY,c.targetQuote*LP_SUPPLY+nextReserve*(CURVE_SUPPLY-LP_SUPPLY));
        nextSold=Math.min(nextSold,c.sold+WALLET_CAP-balance);
        if(nextSold<=c.sold)return(0,0,0,maximum);
        out=nextSold-c.sold;uint256 net=reserveAt(c.targetQuote,nextSold)-c.reserve;
        fee=Math.mulDiv(net,FEE_BPS,10000-FEE_BPS,Math.Rounding.Up);used=net+fee;
        if(used>maximum)revert InvalidParameters();refund=maximum-used;
    }
    function quoteSell(address token,uint256 amount) public view returns(uint256 out,uint256 fee){
        Curve storage c=_open(token);if(amount==0||amount>c.sold)revert EmptyTrade();
        uint256 gross=c.reserve-reserveAt(c.targetQuote,c.sold-amount);fee=Math.mulDiv(gross,FEE_BPS,10000,Math.Rounding.Up);out=gross-fee;
    }
    function buyNative(address token,uint256 minimum,uint256 deadline) external payable nonReentrant returns(uint256){
        if(_open(token).quote!=wbnb)revert OnlyWBNB();return _buy(token,msg.value,minimum,deadline,true);
    }
    function buy(address token,uint256 maximum,uint256 minimum,uint256 deadline) external nonReentrant returns(uint256){return _buy(token,maximum,minimum,deadline,false);}
    function _buy(address token,uint256 maximum,uint256 minimum,uint256 deadline,bool native) private returns(uint256 out){
        if(block.timestamp>deadline)revert Expired();if(!isAgent(msg.sender))revert NotAgent();
        Curve storage c=_open(token);uint256 used;uint256 fee;uint256 refund;(out,used,fee,refund)=quoteBuy(token,msg.sender,maximum);
        if(out==0)revert EmptyTrade();if(out<minimum)revert Slippage();
        if(native)IBANGWBNB(wbnb).deposit{value:used}();else _pull(c.quote,msg.sender,used);
        c.sold+=out;c.reserve+=used-fee;accruedFees[c.quote]+=fee;
        IERC20(token).safeTransfer(msg.sender,out);emit Buy(token,msg.sender,out,used,fee,refund);
        if(c.sold==CURVE_SUPPLY)_graduate(token,c);
        if(native&&refund>0)_native(msg.sender,refund);
    }
    function sell(address token,uint256 amount,uint256 minimum,uint256 deadline,bool receiveNative) external nonReentrant returns(uint256 out){
        if(block.timestamp>deadline)revert Expired();Curve storage c=_open(token);uint256 fee;(out,fee)=quoteSell(token,amount);
        if(out==0)revert EmptyTrade();if(out<minimum)revert Slippage();if(receiveNative&&c.quote!=wbnb)revert OnlyWBNB();
        _pull(token,msg.sender,amount);c.sold-=amount;c.reserve-=out+fee;accruedFees[c.quote]+=fee;
        if(receiveNative){IBANGWBNB(wbnb).withdraw(out);_native(msg.sender,out);}else IERC20(c.quote).safeTransfer(msg.sender,out);
        emit Sell(token,msg.sender,amount,out,fee);
    }
    function _graduate(address token,Curve storage c) private {
        address pair=pancakeFactory.getPair(token,c.quote);if(pair==address(0))pair=pancakeFactory.createPair(token,c.quote);
        // Before graduation only the pad can move this token, so no third party can seed a live pair.
        if(IBANGPair(pair).totalSupply()!=0)revert PairAlreadyActive();
        uint256 raised=c.reserve;c.graduated=true;c.pair=pair;c.reserve=0;
        BANGToken(token).openTransfers();IERC20(token).safeTransfer(pair,LP_SUPPLY);
        uint256 before=IERC20(c.quote).balanceOf(pair);IERC20(c.quote).safeTransfer(pair,raised);
        if(IERC20(c.quote).balanceOf(pair)-before!=raised)revert UnsupportedTransfer();
        uint256 liquidity=IBANGPair(pair).mint(LP_BURN);
        emit Graduated(token,pair,c.quote,raised,LP_SUPPLY,liquidity);
    }
    /// @notice Anyone can trigger payment, exclusively of earned protocol fees to the immutable recipient.
    function payFees(address quote) external nonReentrant {
        uint256 amount=accruedFees[quote];if(amount==0)revert EmptyTrade();accruedFees[quote]=0;
        IERC20(quote).safeTransfer(feeRecipient,amount);emit FeesPaid(quote,feeRecipient,amount);
    }
    function _pull(address token,address from,uint256 amount) private {
        uint256 before=IERC20(token).balanceOf(address(this));IERC20(token).safeTransferFrom(from,address(this),amount);
        if(IERC20(token).balanceOf(address(this))-before!=amount)revert UnsupportedTransfer();
    }
    function _native(address to,uint256 amount) private { (bool ok,)=to.call{value:amount}("");if(!ok)revert NativeTransferFailed(); }
}

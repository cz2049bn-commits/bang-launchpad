// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {VaultBaseV3} from './flap/VaultBaseV3.sol';
import {VaultFactoryBaseV2} from './flap/VaultFactoryBaseV2.sol';
import {IVaultFactoryValidationV2} from './flap/IVaultFactory.sol';
import {IPortalTypes} from './flap/IPortal.sol';
import {VaultUISchema,VaultMethodSchema,FieldDescriptor,VaultDataSchema,FactoryPolicy} from './flap/IVaultSchemasV1.sol';

interface IBANGERC20 {
    function balanceOf(address account) external view returns(uint256);
    function decimals() external view returns(uint8);
    function transfer(address recipient,uint256 amount) external returns(bool);
}

/// @title BANGVaultV3
/// @notice Creator-controlled revenue treasury. No staking, investor claims, guaranteed return or platform tax cut.
/// @dev Non-upgradeable. The token creator is dev; the canonical Flap Guardian is an independent backup.
/// Both can spend treasury funds and immediately rescue ALL held assets. This is explicitly managed custody.
/// Tax settings and protocol deductions are determined upstream by Flap. Native and pre-approved standard ERC20 quotes only.
contract BANGVaultV3 is VaultBaseV3 {
    error Unauthorized(); error InvalidAddress(); error InvalidAmount(); error Paused();
    error TransferFailed(); error Reentered(); error InvalidToken(); error NoLoss();
    address public immutable factory;
    address public immutable taxToken;
    address public immutable creator;
    address private immutable quote;
    uint8 public immutable quoteDecimals;
    address public dev;
    address public treasury;
    bool public paused;
    uint256 public accountedQuote;
    uint256 public totalRecognized;
    uint256 public totalSpent;
    uint256 public totalRescuedQuote;
    uint256 public totalRecognizedLoss;
    uint256 private entered=1;

    event RevenueRecognized(uint256 amount,uint256 accountedBalance);
    event TreasuryPayment(address indexed operator,address indexed recipient,uint256 amount,bytes32 indexed memo);
    event AssetRescued(address indexed operator,address indexed asset,address indexed recipient,uint256 amount);
    event PauseChanged(address indexed operator,bool paused);
    event DevChanged(address indexed operator,address indexed previous,address indexed next);
    event TreasuryChanged(address indexed operator,address indexed previous,address indexed next);
    event BalanceLossRecognized(address indexed operator,uint256 loss,uint256 remaining);

    modifier onlyManager(){if(msg.sender!=dev && msg.sender!=_getGuardian())revert Unauthorized();_;}
    modifier nonReentrant(){if(entered!=1)revert Reentered();entered=2;_;entered=1;}

    /// @dev Called by BANGFactoryV3 before taxToken exists. NEVER calls taxToken here.
    constructor(address taxToken_,address quote_,address creator_,address treasury_) {
        if(taxToken_==address(0)||creator_==address(0)||treasury_==address(0)||treasury_==address(this)||creator_==address(this)||quote_==taxToken_)revert InvalidAddress();
        if(block.chainid!=56 && block.chainid!=97)revert UnsupportedChain(block.chainid);
        factory=msg.sender;taxToken=taxToken_;quote=quote_;creator=creator_;dev=creator_;treasury=treasury_;
        if(quote_!=address(0)){
            if(quote_.code.length==0)revert InvalidToken();
            uint8 d=IBANGERC20(quote_).decimals();if(d>36)revert InvalidToken();quoteDecimals=d;
        }else quoteDecimals=18;
    }
    function bangVersion() external pure returns(string memory){return 'BANG/1.0.0';}
    function guardian() external view returns(address){return _getGuardian();}
    function vaultQuoteToken() public view override returns(address){return quote;}
    function quoteBalance() public view returns(uint256){return _balance(quote);}
    function pendingRevenue() external view returns(uint256){uint256 b=quoteBalance();return b>accountedQuote?b-accountedQuote:0;}

    /// @dev Accounting only: no distribution, loop or external transfer. ERC20 pings may be duplicated or absent.
    /// A return transfer during an outbound operation is recognized on the next public sync.
    receive() external payable {if(entered==1)_sync();}
    function sync() external nonReentrant {_sync();}
    function _sync() private {
        uint256 b=quoteBalance();if(b<=accountedQuote)return;
        uint256 delta=b-accountedQuote;accountedQuote=b;totalRecognized+=delta;
        emit RevenueRecognized(delta,b);
    }
    function spend(address recipient,uint256 amount,bytes32 memo) external onlyManager nonReentrant {
        if(paused)revert Paused();if(recipient==address(0)||recipient==address(this))revert InvalidAddress();
        _sync();if(amount==0||amount>accountedQuote||amount>quoteBalance())revert InvalidAmount();
        accountedQuote-=amount;totalSpent+=amount;
        _send(quote,recipient,amount);
        emit TreasuryPayment(msg.sender,recipient,amount,memo);
    }
    function setPaused(bool value) external onlyManager nonReentrant {paused=value;emit PauseChanged(msg.sender,value);}
    function setDev(address next) external onlyManager nonReentrant {
        if(next==address(0)||next==address(this))revert InvalidAddress();
        address previous=dev;dev=next;emit DevChanged(msg.sender,previous,next);
    }
    function setTreasury(address next) external onlyManager nonReentrant {
        if(next==address(0)||next==address(this))revert InvalidAddress();
        address previous=treasury;treasury=next;emit TreasuryChanged(msg.sender,previous,next);
    }
    /// @notice Pauses normal spending and rescues native, quote and the served tax token in one transaction.
    /// No timelock; pays the currently published treasury address. Extra assets use rescueAsset.
    function rescueAll() external onlyManager nonReentrant {
        _pauseForRescue();
        // A tax-token transfer may dispatch quote revenue. Sweep it before quote/native.
        if(taxToken!=quote && taxToken.code.length>0)_rescue(taxToken);
        if(quote!=address(0))_rescue(quote);
        _rescue(address(0));
    }
    function rescueAsset(address asset) external onlyManager nonReentrant {
        if(asset!=address(0)&&asset.code.length==0)revert InvalidToken();
        _pauseForRescue();_rescue(asset);
    }
    function _pauseForRescue() private {if(!paused){paused=true;emit PauseChanged(msg.sender,true);}}
    function _rescue(address asset) private {
        if(asset==quote){_sync();uint256 b=quoteBalance();if(b<accountedQuote)_loss(b);}
        uint256 amount=_balance(asset);if(amount==0)return;
        if(asset==quote){accountedQuote-=amount;totalRescuedQuote+=amount;}
        _send(asset,treasury,amount);emit AssetRescued(msg.sender,asset,treasury,amount);
    }
    /// @notice Explicit recovery for an externally reduced quote balance; pauses spending and preserves history.
    /// Rebasing and sender-extra-fee quote tokens are not supported economic assets.
    function reconcileLoss() external onlyManager nonReentrant {
        uint256 b=quoteBalance();if(b>=accountedQuote)revert NoLoss();_pauseForRescue();_loss(b);
    }
    function _loss(uint256 b) private {
        uint256 loss=accountedQuote-b;accountedQuote=b;totalRecognizedLoss+=loss;
        emit BalanceLossRecognized(msg.sender,loss,b);
    }
    function _balance(address asset) private view returns(uint256){return asset==address(0)?address(this).balance:IBANGERC20(asset).balanceOf(address(this));}
    function _send(address asset,address recipient,uint256 amount) private {
        if(asset==address(0)){(bool ok,)=recipient.call{value:amount}('');if(!ok)revert TransferFailed();}
        else{
            uint256 beforeBalance=_balance(asset);
            (bool ok,bytes memory result)=asset.call(abi.encodeCall(IBANGERC20.transfer,(recipient,amount)));
            if(!ok||(result.length!=0&&(result.length!=32||!abi.decode(result,(bool)))))revert TransferFailed();
            uint256 afterBalance=_balance(asset);
            if(afterBalance>beforeBalance||beforeBalance-afterBalance!=amount)revert TransferFailed();
        }
    }
    function treasuryState() external view returns(address manager,address recipient,address asset,uint8 decimals_,bool isPaused,uint256 balance,uint256 accounted,uint256 received,uint256 spent,uint256 rescued,uint256 losses){
        return(dev,treasury,quote,quoteDecimals,paused,quoteBalance(),accountedQuote,totalRecognized,totalSpent,totalRescuedQuote,totalRecognizedLoss);
    }
    function description() public view override returns(string memory){
        if(paused)return unicode'BANG V3: spending paused. Creator/dev and Flap Guardian retain immediate rescue permission. No holder yield. / 支出已暂停；dev 与官方 Guardian 仍可即时救援全部资产，不承诺持币收益。';
        if(totalRecognized==0)return unicode'BANG V3: awaiting recognized revenue. Creator-managed treasury; all balances and payments are public. / 尚无已记账收入；创建者管理金库，余额与支出公开。';
        return unicode'BANG V3: revenue recorded; managers can pay or rescue funds. No staking or guaranteed returns. / 已记录收入；管理者可支出或救援资金，无质押及保底收益。';
    }
    function vaultUISchema() public pure override returns(VaultUISchema memory s){
        s.vaultType='BANGVaultV3';
        s.description=unicode'创建者管理的收入金库。dev 与 Flap Guardian 可立即转出全部资产，平台不额外抽成，无持币分红承诺。金额为原始单位，请读取 quoteDecimals。';
        s.methods=new VaultMethodSchema[](10);
        s.methods[0].name='treasuryState';s.methods[0].description=unicode'查看管理者、收款方、币种、精度、暂停状态及累计收支。';
        s.methods[0].outputs=new FieldDescriptor[](11);
        s.methods[0].outputs[0]=FieldDescriptor('manager','address',unicode'dev 管理地址',0);
        s.methods[0].outputs[1]=FieldDescriptor('recipient','address',unicode'救援收款地址',0);
        s.methods[0].outputs[2]=FieldDescriptor('asset','address',unicode'收入币种，零地址为 BNB',0);
        s.methods[0].outputs[3]=FieldDescriptor('decimals_','uint8',unicode'币种精度',0);
        s.methods[0].outputs[4]=FieldDescriptor('isPaused','bool',unicode'普通支出是否暂停',0);
        s.methods[0].outputs[5]=FieldDescriptor('balance','uint256',unicode'实际余额（原始单位）',0);
        s.methods[0].outputs[6]=FieldDescriptor('accounted','uint256',unicode'已记账余额（原始单位）',0);
        s.methods[0].outputs[7]=FieldDescriptor('received','uint256',unicode'累计收入（原始单位）',0);
        s.methods[0].outputs[8]=FieldDescriptor('spent','uint256',unicode'累计支出（原始单位）',0);
        s.methods[0].outputs[9]=FieldDescriptor('rescued','uint256',unicode'累计收入币种救援额（原始单位）',0);
        s.methods[0].outputs[10]=FieldDescriptor('losses','uint256',unicode'已核对余额损失（原始单位）',0);
        s.methods[1].name='sync';s.methods[1].description=unicode'任何人同步新到账收入，重复调用不会重复记账。';s.methods[1].isWriteMethod=true;
        s.methods[2].name='spend';s.methods[2].description=unicode'仅 dev 或官方 Guardian：支付指定金额并记录用途摘要哈希。';s.methods[2].isWriteMethod=true;s.methods[2].inputs=new FieldDescriptor[](3);
        s.methods[2].inputs[0]=FieldDescriptor('recipient','address',unicode'收款地址',0);s.methods[2].inputs[1]=FieldDescriptor('amount','uint256',unicode'金额（按实际精度换算为原始单位）',0);s.methods[2].inputs[2]=FieldDescriptor('memo','bytes32',unicode'公开用途说明的哈希',0);
        s.methods[3].name='setPaused';s.methods[3].description=unicode'仅管理者：暂停或恢复普通支出；不会阻止收入和救援。';s.methods[3].isWriteMethod=true;s.methods[3].inputs=new FieldDescriptor[](1);s.methods[3].inputs[0]=FieldDescriptor('value','bool',unicode'是否暂停',0);
        s.methods[4].name='setDev';s.methods[4].description=unicode'仅管理者：立即更换 dev，官方 Guardian 权限不会撤销。';s.methods[4].isWriteMethod=true;s.methods[4].inputs=new FieldDescriptor[](1);s.methods[4].inputs[0]=FieldDescriptor('next','address',unicode'新的 dev',0);
        s.methods[5].name='setTreasury';s.methods[5].description=unicode'仅管理者：更换救援收款地址。';s.methods[5].isWriteMethod=true;s.methods[5].inputs=new FieldDescriptor[](1);s.methods[5].inputs[0]=FieldDescriptor('next','address',unicode'新的收款地址',0);
        s.methods[6].name='rescueAll';s.methods[6].description=unicode'仅管理者：立即转出全部 BNB、收入币和本税币至 treasury，并暂停普通支出。';s.methods[6].isWriteMethod=true;
        s.methods[7].name='rescueAsset';s.methods[7].description=unicode'仅管理者：立即救援指定资产的全部余额至 treasury，包括误转资产。';s.methods[7].isWriteMethod=true;s.methods[7].inputs=new FieldDescriptor[](1);s.methods[7].inputs[0]=FieldDescriptor('asset','address',unicode'资产地址，零地址为 BNB',0);
        s.methods[8].name='reconcileLoss';s.methods[8].description=unicode'仅管理者：余额异常减少时核对损失并暂停，保留历史记录。';s.methods[8].isWriteMethod=true;
        s.methods[9].name='guardian';s.methods[9].description=unicode'查看不可被 dev 撤销的官方 Guardian 地址。';s.methods[9].outputs=new FieldDescriptor[](1);s.methods[9].outputs[0]=FieldDescriptor('guardian','address',unicode'官方 Guardian',0);
    }
}

/// @notice Deploy THIS contract in Remix. The factory creates a vault before Flap creates its tax token.
/// @dev No upgrade path, platform commission or administrator role at factory level. Each vault belongs to its creator.
contract BANGFactoryV3 is VaultFactoryBaseV2 {
    error InvalidQuote();error DuplicateVault();error InvalidData();
    mapping(address=>bool) private supported;
    mapping(address=>address) public vaultForToken;
    mapping(address=>bool) public isBANGVault;
    address[] private quotes;
    event BANGVaultCreated(address indexed token,address indexed vault,address indexed creator,address quote,address treasury);
    constructor(address[] memory erc20Quotes){
        if(block.chainid!=56&&block.chainid!=97)revert UnsupportedChain(block.chainid);
        supported[address(0)]=true;quotes.push(address(0));
        if(erc20Quotes.length>16)revert InvalidQuote();
        for(uint256 i;i<erc20Quotes.length;i++){
            address q=erc20Quotes[i];if(q==address(0)||q.code.length==0||supported[q])revert InvalidQuote();
            if(IBANGERC20(q).decimals()>36)revert InvalidQuote();
            IBANGERC20(q).balanceOf(address(this));supported[q]=true;quotes.push(q);
        }
    }
    function bangVersion() external pure returns(string memory){return 'BANG/1.0.0';}
    function supportedQuotes() external view returns(address[] memory){return quotes;}
    function vaultPortal() external view returns(address){return _getVaultPortal();}
    function factorySpecVersion() public pure override returns(string memory){return 'v2.3';}
    function isQuoteTokenSupported(address q) external view override returns(bool){return supported[q];}
    function newVault(address token,address quote,address creator,bytes calldata data) external override returns(address vault){
        if(msg.sender!=_getVaultPortal())revert OnlyVaultPortal();
        if(token==address(0)||creator==address(0))revert ZeroAddress();
        if(!supported[quote]||token==quote)revert InvalidQuote();
        if(vaultForToken[token]!=address(0))revert DuplicateVault();
        if(data.length!=0&&data.length!=32)revert InvalidData();
        address treasury=data.length==0?creator:abi.decode(data,(address));if(treasury==address(0))revert ZeroAddress();
        vault=address(new BANGVaultV3(token,quote,creator,treasury));
        vaultForToken[token]=vault;isBANGVault[vault]=true;
        emit BANGVaultCreated(token,vault,creator,quote,treasury);
    }
    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory d) internal view override returns(bool,string memory){
        if(!supported[d.quoteToken])return(false,'Unsupported quote token');
        if(d.tokenVersion!=IPortalTypes.TokenVersion.TOKEN_TAXED_V3)return(false,'Use Tax Token V3');
        if(d.buyTaxRate>1000||d.sellTaxRate>1000||d.buyTaxRate+d.sellTaxRate==0)return(false,'Tax must be 0..1000 bps, not both zero');
        if(d.vaultBps!=10000||d.deflationBps!=0||d.dividendBps!=0||d.lpBps!=0)return(false,'Allocate 100% of project tax revenue to this creator-managed vault');
        return(true,'');
    }
    function vaultDataSchema() public pure override returns(VaultDataSchema memory s){
        s.description=unicode'BANG V3 创建者收入金库。先创建 Vault、再创建 Token；creator 为 dev。全部项目税收分配给本 Vault，协议费用仍适用。dev/Guardian 能立即支出和救援全部资产，无持币分红或保底收益。';
        s.fields=new FieldDescriptor[](1);s.fields[0]=FieldDescriptor('treasury','address',unicode'救援收款地址，通常填创建者钱包。编码为 abi.encode(address)；空 0x 默认 creator。',0);
    }
    function tokenCreationPolicies() public pure override returns(FactoryPolicy[] memory p){
        p=new FactoryPolicy[](4);
        p[0]=FactoryPolicy('tokenVersion','eq',abi.encode(uint8(6)),unicode'使用 Tax Token V3');
        p[1]=FactoryPolicy('vaultBps','eq',abi.encode(uint16(10000)),unicode'项目税收分配 100% 进入创建者金库，平台不另抽成');
        p[2]=FactoryPolicy('buyTaxRate','lte',abi.encode(uint16(1000)),unicode'买入税不超过 10%');
        p[3]=FactoryPolicy('sellTaxRate','lte',abi.encode(uint16(1000)),unicode'卖出税不超过 10%');
    }
}

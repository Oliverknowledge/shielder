// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ShieldVault: a self-custodial commitment vault for traders.
/// @notice One contract, one vault per authority. Money leaves a vault only
///         through five paths, each governed by rules the authority set while
///         calm: instant top-up (floor, 24h velocity, large-amount pause,
///         cooldown), matured top-up, instant cold transfer (capped), matured
///         cold transfer, matured full exit. Tightening a rule is instant and
///         bumps configVersion; loosening waits and must be positively
///         reconfirmed after the delay. A pinned risk verifier may extend a
///         cooldown, never shorten one, and only when the attested realised
///         loss meets the authority's own trigger. There is no owner, no
///         admin and no upgrade path.
///
///         Top-ups to a destination registered with ROUTE_HYPERCORE are
///         delivered straight into that address's Hyperliquid perps account
///         via Circle's CoreDepositWallet.depositFor on HyperEVM; ROUTE_EVM
///         destinations receive a plain ERC-20 transfer (any EVM chain).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface ICoreDepositWallet {
    function depositFor(address recipient, uint256 amount, uint32 destinationDex) external;
}

contract ShieldVault {
    // ------------------------------------------------------------------
    // Constants (identical to the Solana program)
    // ------------------------------------------------------------------
    uint256 public constant NUM_VELOCITY_BUCKETS = 6;
    uint64 public constant BUCKET_LEN_SECS = 4 hours;
    uint64 public constant DEFAULT_TOP_UP_COOLDOWN_SECS = 30 minutes;
    uint64 public constant DEFAULT_LOOSEN_COOLDOWN_SECS = 24 hours;
    uint64 public constant DEFAULT_FULL_EXIT_COOLDOWN_SECS = 7 days;
    uint64 public constant PROPOSAL_EXECUTION_GRACE_SECS = 7 days;
    uint64 public constant MIN_LOOSEN_COOLDOWN_SECS = 1 hours;
    uint64 public constant MIN_FULL_EXIT_COOLDOWN_SECS = 1 hours;
    uint64 public constant MAX_LOSS_COOLDOWN_SECS = 30 days;
    uint64 public constant MAX_SELF_PAUSE_SECS = 30 days;
    uint64 public constant VERDICT_CLOCK_SKEW_SECS = 5 minutes;
    uint256 public constant BPS_DENOM = 10_000;

    uint8 public constant KIND_EXECUTION = 0;
    uint8 public constant KIND_COLD = 1;
    uint8 public constant ROUTE_EVM = 0;
    uint8 public constant ROUTE_HYPERCORE = 1;
    uint32 public constant HYPERCORE_PERPS_DEX = 0;

    uint8 public constant CATEGORY_RULE_CHANGE = 0;
    uint8 public constant CATEGORY_TOP_UP = 1;
    uint8 public constant CATEGORY_FULL_EXIT = 2;

    uint8 public constant ACTION_LOOSEN = 0;
    uint8 public constant ACTION_TOP_UP = 1;
    uint8 public constant ACTION_UNINSTALL = 2;
    uint8 public constant ACTION_COLD_ABOVE_CAP = 3;

    uint8 public constant COOLDOWN_REASON_NONE = 0;
    uint8 public constant COOLDOWN_REASON_SELF_PAUSE = 1;
    uint8 public constant COOLDOWN_REASON_RISK_VERDICT = 2;

    // ------------------------------------------------------------------
    // Errors (same names as the Solana program)
    // ------------------------------------------------------------------
    error Unauthorized();
    error ZeroAmount();
    error InvalidParameter();
    error VaultExists();
    error NoVault();
    error AlreadyRegisteredDifferentType();
    error VaultFundedUseDelayedPath();
    error DestinationNotExecution();
    error DestinationNotCold();
    error AmountExceedsEmergencyCap();
    error VelocityThresholdExceeded();
    error CooldownActive();
    error ProtectedFloorBreached();
    error AmountRequiresGatedTopUp();
    error ProposalNotMatured();
    error ProposalExpired();
    error ProposalStale();
    error NoPendingProposal();
    error ProposalSlotOccupied();
    error NoRiskVerifier();
    error InvalidVerifier();
    error VerdictExpired();
    error VerdictNotYetValid();
    error VerdictReplayed();
    error VerdictBelowLossTrigger();
    error NotATightening();
    error NotALoosening();
    error PauseTooLong();
    error FullExitDestinationNotRegisteredCold();
    error TransferFailed();
    error Reentrancy();

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    struct Vault {
        bool exists;
        address riskVerifier;
        uint64 protectedFloor;
        uint16 topUpThresholdBps;
        uint64 emergencyCap;
        uint64 velocityThreshold;
        uint64 lossTriggerUsdc;
        uint64 lossCooldownSecs;
        uint64 topUpCooldownSecs;
        uint64 loosenCooldownSecs;
        uint64 fullExitCooldownSecs;
        uint64 cooldownUntil;
        uint8 cooldownReason;
        uint64 cooldownSetAt;
        uint64 lastVerdictNonce;
        uint8 lastVerdictReason;
        bytes32 lastVerdictEvidence;
        uint64[6] velocityBuckets;
        uint64 bucketStart;
        uint8 currentBucketIndex;
        uint64 configVersion;
        uint64 proposalNonceCounter;
        uint64 createdAt;
        uint64 balance;
    }

    struct RegistryEntry {
        uint8 kind;
        uint8 route;
        bool active;
        uint64 registeredAt;
        bytes24 label;
    }

    /// Optional fields are expressed as (has, value) pairs.
    struct TightenParams {
        bool hasProtectedFloor; uint64 protectedFloor;
        bool hasTopUpThresholdBps; uint16 topUpThresholdBps;
        bool hasEmergencyCap; uint64 emergencyCap;
        bool hasVelocityThreshold; uint64 velocityThreshold;
        bool hasLossTriggerUsdc; uint64 lossTriggerUsdc;
        bool hasLossCooldownSecs; uint64 lossCooldownSecs;
        bool hasTopUpCooldownSecs; uint64 topUpCooldownSecs;
        bool hasLoosenCooldownSecs; uint64 loosenCooldownSecs;
        bool hasFullExitCooldownSecs; uint64 fullExitCooldownSecs;
        bool hasPauseTopUpsUntil; uint64 pauseTopUpsUntil;
        bool hasRiskVerifier; address riskVerifier;
    }

    struct LoosenParams {
        bool hasProtectedFloor; uint64 protectedFloor;
        bool hasTopUpThresholdBps; uint16 topUpThresholdBps;
        bool hasEmergencyCap; uint64 emergencyCap;
        bool hasVelocityThreshold; uint64 velocityThreshold;
        bool hasLossTriggerUsdc; uint64 lossTriggerUsdc;
        bool hasLossCooldownSecs; uint64 lossCooldownSecs;
        bool hasTopUpCooldownSecs; uint64 topUpCooldownSecs;
        bool hasLoosenCooldownSecs; uint64 loosenCooldownSecs;
        bool hasFullExitCooldownSecs; uint64 fullExitCooldownSecs;
        bool hasRiskVerifier; address riskVerifier; // address(0) removes the monitor
        address registerOwner; // address(0) = none
        uint8 registerKind;
        uint8 registerRoute;
        bytes24 registerLabel;
    }

    struct Proposal {
        bool exists;
        uint8 category;
        uint8 action;
        uint64 nonce;
        uint64 createdAt;
        uint64 executeAfter;
        uint64 expiry;
        uint64 configVersionAtCreation;
        address destinationOwner;
        uint64 amount;
        uint8 reservedBucketIndex;
        LoosenParams loosen;
    }

    struct InitParams {
        address riskVerifier;
        uint64 protectedFloor;
        uint16 topUpThresholdBps;
        uint64 emergencyCap;
        uint64 velocityThreshold;
        uint64 lossTriggerUsdc;
        uint64 lossCooldownSecs;
    }

    /// EIP-712 verdict. `vault` is the authority address the verdict binds to.
    struct RiskVerdict {
        address vault;
        uint64 nonce;
        uint64 issuedAt;
        uint64 expiry;
        uint8 reasonCode;
        uint64 realizedLossUsdc;
        bytes32 evidenceHash;
    }

    IERC20 public immutable usdc;
    ICoreDepositWallet public immutable coreDeposit; // address(0) disables ROUTE_HYPERCORE

    mapping(address => Vault) internal vaults;
    mapping(address => mapping(address => RegistryEntry)) internal registry;
    mapping(address => address[]) internal registryOwners; // enumeration for clients
    mapping(address => mapping(uint8 => Proposal)) internal proposals;

    uint256 private _lock = 1;

    bytes32 public constant VERDICT_TYPEHASH = keccak256(
        "RiskVerdict(address vault,uint64 nonce,uint64 issuedAt,uint64 expiry,uint8 reasonCode,uint64 realizedLossUsdc,bytes32 evidenceHash)"
    );
    bytes32 private immutable _DOMAIN_SEPARATOR;

    // ------------------------------------------------------------------
    // Events (same names and meaning as the Solana program)
    // ------------------------------------------------------------------
    event VaultInitialized(address indexed vault, address indexed authority, address usdc, uint64 protectedFloor, uint64 velocityThreshold);
    event Deposited(address indexed vault, address indexed depositor, uint64 amount, uint64 newBalance);
    event RegistrationChanged(address indexed vault, address indexed owner, uint8 kind, uint8 route, bool active, bytes24 label);
    event PolicyTightened(address indexed vault, uint64 configVersion, uint64 cooldownUntil, uint64 protectedFloor, uint64 velocityThreshold, uint16 topUpThresholdBps, uint64 lossTriggerUsdc, uint64 lossCooldownSecs);
    event LoosenProposed(address indexed vault, uint64 nonce, uint64 executeAfter);
    event LoosenExecuted(address indexed vault, uint64 nonce);
    event ProposalCancelled(address indexed vault, uint8 category, uint64 nonce);
    event TopUpExecuted(address indexed vault, address indexed destinationOwner, uint64 amount, bool instant, uint64 nonce, uint64 velocityAfter, uint64 balanceAfter, uint8 route);
    event TopUpProposed(address indexed vault, address indexed destinationOwner, uint64 amount, uint64 nonce, uint64 executeAfter);
    event ColdTransferExecuted(address indexed vault, address indexed destinationOwner, uint64 amount, bool instant);
    event FullExitProposed(address indexed vault, address indexed destinationOwner, uint64 nonce, uint64 executeAfter, bool uninstall, uint64 amount);
    event FullExitExecuted(address indexed vault, address indexed destinationOwner, uint64 amount);
    event RiskVerdictApplied(address indexed vault, uint64 nonce, uint8 reasonCode, uint64 realizedLossUsdc, uint64 cooldownUntil, bool extended, bytes32 evidenceHash);

    constructor(address usdc_, address coreDeposit_) {
        usdc = IERC20(usdc_);
        coreDeposit = ICoreDepositWallet(coreDeposit_);
        _DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ShieldVault"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function getVault(address authority) external view returns (Vault memory) {
        return vaults[authority];
    }

    function getRegistryEntry(address authority, address owner) external view returns (RegistryEntry memory) {
        return registry[authority][owner];
    }

    function getRegistryOwners(address authority) external view returns (address[] memory) {
        return registryOwners[authority];
    }

    function getProposal(address authority, uint8 category) external view returns (Proposal memory) {
        return proposals[authority][category];
    }

    function domainSeparator() external view returns (bytes32) {
        return _DOMAIN_SEPARATOR;
    }

    /// Rolling 24h velocity as it would be right now (buckets rolled virtually).
    function velocityNow(address authority) external view returns (uint64) {
        Vault storage v = vaults[authority];
        if (v.bucketStart == 0) return 0;
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < v.bucketStart) return _velocitySum(v);
        uint64 elapsed = (nowTs - v.bucketStart) / BUCKET_LEN_SECS;
        if (elapsed >= NUM_VELOCITY_BUCKETS) return 0;
        uint64 sum = 0;
        for (uint256 i = 0; i < NUM_VELOCITY_BUCKETS; i++) {
            bool stale = false;
            for (uint64 k = 1; k <= elapsed; k++) {
                if ((uint64(v.currentBucketIndex) + k) % NUM_VELOCITY_BUCKETS == i) stale = true;
            }
            if (!stale) sum += v.velocityBuckets[i];
        }
        return sum;
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    function initializeVault(InitParams calldata p) external {
        Vault storage v = vaults[msg.sender];
        if (v.exists) revert VaultExists();
        if (p.topUpThresholdBps > BPS_DENOM) revert InvalidParameter();
        if (p.lossCooldownSecs > MAX_LOSS_COOLDOWN_SECS) revert InvalidParameter();
        v.exists = true;
        v.riskVerifier = p.riskVerifier;
        v.protectedFloor = p.protectedFloor;
        v.topUpThresholdBps = p.topUpThresholdBps;
        v.emergencyCap = p.emergencyCap;
        v.velocityThreshold = p.velocityThreshold;
        v.lossTriggerUsdc = p.lossTriggerUsdc;
        v.lossCooldownSecs = p.lossCooldownSecs;
        v.topUpCooldownSecs = DEFAULT_TOP_UP_COOLDOWN_SECS;
        v.loosenCooldownSecs = DEFAULT_LOOSEN_COOLDOWN_SECS;
        v.fullExitCooldownSecs = DEFAULT_FULL_EXIT_COOLDOWN_SECS;
        v.configVersion = 1;
        v.createdAt = uint64(block.timestamp);
        emit VaultInitialized(msg.sender, msg.sender, address(usdc), p.protectedFloor, p.velocityThreshold);
    }

    /// Anyone may deposit into any vault. Deposits are never gated.
    function deposit(address authority, uint64 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = vaults[authority];
        if (!v.exists) revert NoVault();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        v.balance += amount;
        emit Deposited(authority, msg.sender, amount, v.balance);
    }

    /// Instant only while the vault is empty; afterwards adding a destination is a weakening change.
    function registerOwner(address owner, uint8 kind, uint8 route, bytes24 label) external {
        Vault storage v = _own();
        if (v.balance != 0) revert VaultFundedUseDelayedPath();
        _applyRegistration(msg.sender, owner, kind, route, label);
    }

    /// Removing a destination is a tightening: instant, and it supersedes pending weakening changes.
    function removeRegistration(address owner) external {
        Vault storage v = _own();
        RegistryEntry storage e = registry[msg.sender][owner];
        if (e.registeredAt == 0) revert InvalidParameter();
        e.active = false;
        v.configVersion += 1;
        emit RegistrationChanged(msg.sender, owner, e.kind, e.route, false, e.label);
    }

    // ------------------------------------------------------------------
    // Tighten fast
    // ------------------------------------------------------------------
    function tighten(TightenParams calldata p) external {
        Vault storage v = _own();
        uint64 nowTs = uint64(block.timestamp);
        bool changed = false;
        if (p.hasProtectedFloor) { if (p.protectedFloor < v.protectedFloor) revert NotATightening(); v.protectedFloor = p.protectedFloor; changed = true; }
        if (p.hasTopUpThresholdBps) { if (p.topUpThresholdBps > v.topUpThresholdBps) revert NotATightening(); v.topUpThresholdBps = p.topUpThresholdBps; changed = true; }
        if (p.hasEmergencyCap) { if (p.emergencyCap > v.emergencyCap) revert NotATightening(); v.emergencyCap = p.emergencyCap; changed = true; }
        if (p.hasVelocityThreshold) { if (p.velocityThreshold > v.velocityThreshold) revert NotATightening(); v.velocityThreshold = p.velocityThreshold; changed = true; }
        if (p.hasLossTriggerUsdc) { if (p.lossTriggerUsdc > v.lossTriggerUsdc) revert NotATightening(); v.lossTriggerUsdc = p.lossTriggerUsdc; changed = true; }
        if (p.hasLossCooldownSecs) {
            if (p.lossCooldownSecs < v.lossCooldownSecs) revert NotATightening();
            if (p.lossCooldownSecs > MAX_LOSS_COOLDOWN_SECS) revert InvalidParameter();
            v.lossCooldownSecs = p.lossCooldownSecs; changed = true;
        }
        if (p.hasTopUpCooldownSecs) { if (p.topUpCooldownSecs < v.topUpCooldownSecs) revert NotATightening(); v.topUpCooldownSecs = p.topUpCooldownSecs; changed = true; }
        if (p.hasLoosenCooldownSecs) { if (p.loosenCooldownSecs < v.loosenCooldownSecs) revert NotATightening(); v.loosenCooldownSecs = p.loosenCooldownSecs; changed = true; }
        if (p.hasFullExitCooldownSecs) { if (p.fullExitCooldownSecs < v.fullExitCooldownSecs) revert NotATightening(); v.fullExitCooldownSecs = p.fullExitCooldownSecs; changed = true; }
        if (p.hasPauseTopUpsUntil) {
            if (p.pauseTopUpsUntil <= nowTs) revert NotATightening();
            if (p.pauseTopUpsUntil <= v.cooldownUntil) revert NotATightening();
            if (p.pauseTopUpsUntil > nowTs + MAX_SELF_PAUSE_SECS) revert PauseTooLong();
            v.cooldownUntil = p.pauseTopUpsUntil;
            v.cooldownReason = COOLDOWN_REASON_SELF_PAUSE;
            v.cooldownSetAt = nowTs;
            changed = true;
        }
        if (p.hasRiskVerifier) {
            if (v.riskVerifier != address(0)) revert NotATightening();
            if (p.riskVerifier == address(0)) revert InvalidParameter();
            v.riskVerifier = p.riskVerifier; changed = true;
        }
        if (!changed) revert NotATightening();
        v.configVersion += 1;
        emit PolicyTightened(msg.sender, v.configVersion, v.cooldownUntil, v.protectedFloor, v.velocityThreshold, v.topUpThresholdBps, v.lossTriggerUsdc, v.lossCooldownSecs);
    }

    // ------------------------------------------------------------------
    // Loosen slowly
    // ------------------------------------------------------------------
    function proposeLoosen(LoosenParams calldata p) external {
        Vault storage v = _own();
        bool touched = false;
        if (p.hasProtectedFloor) { if (p.protectedFloor > v.protectedFloor) revert NotALoosening(); touched = true; }
        if (p.hasTopUpThresholdBps) { if (p.topUpThresholdBps < v.topUpThresholdBps) revert NotALoosening(); if (p.topUpThresholdBps > BPS_DENOM) revert InvalidParameter(); touched = true; }
        if (p.hasEmergencyCap) { if (p.emergencyCap < v.emergencyCap) revert NotALoosening(); touched = true; }
        if (p.hasVelocityThreshold) { if (p.velocityThreshold < v.velocityThreshold) revert NotALoosening(); touched = true; }
        if (p.hasLossTriggerUsdc) { if (p.lossTriggerUsdc < v.lossTriggerUsdc) revert NotALoosening(); touched = true; }
        if (p.hasLossCooldownSecs) { if (p.lossCooldownSecs > v.lossCooldownSecs) revert NotALoosening(); touched = true; }
        if (p.hasTopUpCooldownSecs) { if (p.topUpCooldownSecs > v.topUpCooldownSecs) revert NotALoosening(); touched = true; }
        if (p.hasLoosenCooldownSecs) { if (p.loosenCooldownSecs > v.loosenCooldownSecs) revert NotALoosening(); if (p.loosenCooldownSecs < MIN_LOOSEN_COOLDOWN_SECS) revert InvalidParameter(); touched = true; }
        if (p.hasFullExitCooldownSecs) { if (p.fullExitCooldownSecs > v.fullExitCooldownSecs) revert NotALoosening(); if (p.fullExitCooldownSecs < MIN_FULL_EXIT_COOLDOWN_SECS) revert InvalidParameter(); touched = true; }
        if (p.hasRiskVerifier) touched = true;
        if (p.registerOwner != address(0)) { if (p.registerKind > 1 || p.registerRoute > 1) revert InvalidParameter(); touched = true; }
        if (!touched) revert NotALoosening();

        Proposal storage pr = proposals[msg.sender][CATEGORY_RULE_CHANGE];
        if (pr.exists) revert ProposalSlotOccupied();
        uint64 nowTs = uint64(block.timestamp);
        uint64 nonce = ++v.proposalNonceCounter;
        uint64 executeAfter = nowTs + v.loosenCooldownSecs;
        pr.exists = true;
        pr.category = CATEGORY_RULE_CHANGE;
        pr.action = ACTION_LOOSEN;
        pr.nonce = nonce;
        pr.createdAt = nowTs;
        pr.executeAfter = executeAfter;
        pr.expiry = executeAfter + PROPOSAL_EXECUTION_GRACE_SECS;
        pr.configVersionAtCreation = v.configVersion;
        pr.loosen = p;
        emit LoosenProposed(msg.sender, nonce, executeAfter);
    }

    /// Positive reconfirmation: nothing applies by itself when the delay ends.
    function executeRuleChange() external {
        Vault storage v = _own();
        Proposal storage pr = proposals[msg.sender][CATEGORY_RULE_CHANGE];
        if (!pr.exists || pr.action != ACTION_LOOSEN) revert NoPendingProposal();
        _checkMaturityAndStaleness(v, pr);
        LoosenParams memory p = pr.loosen;
        if (p.registerOwner != address(0)) {
            _applyRegistration(msg.sender, p.registerOwner, p.registerKind, p.registerRoute, p.registerLabel);
        }
        if (p.hasProtectedFloor) v.protectedFloor = p.protectedFloor;
        if (p.hasTopUpThresholdBps) v.topUpThresholdBps = p.topUpThresholdBps;
        if (p.hasEmergencyCap) v.emergencyCap = p.emergencyCap;
        if (p.hasVelocityThreshold) v.velocityThreshold = p.velocityThreshold;
        if (p.hasLossTriggerUsdc) v.lossTriggerUsdc = p.lossTriggerUsdc;
        if (p.hasLossCooldownSecs) v.lossCooldownSecs = p.lossCooldownSecs;
        if (p.hasTopUpCooldownSecs) v.topUpCooldownSecs = p.topUpCooldownSecs;
        if (p.hasLoosenCooldownSecs) v.loosenCooldownSecs = p.loosenCooldownSecs;
        if (p.hasFullExitCooldownSecs) v.fullExitCooldownSecs = p.fullExitCooldownSecs;
        if (p.hasRiskVerifier) v.riskVerifier = p.riskVerifier;
        uint64 nonce = pr.nonce;
        delete proposals[msg.sender][CATEGORY_RULE_CHANGE];
        emit LoosenExecuted(msg.sender, nonce);
    }

    /// Cancelling is always instant and never gated.
    function cancelProposal(uint8 category) external {
        Vault storage v = _own();
        Proposal storage pr = proposals[msg.sender][category];
        if (!pr.exists) revert NoPendingProposal();
        if (pr.action == ACTION_TOP_UP) _refundVelocity(v, pr.amount, pr.reservedBucketIndex);
        uint64 nonce = pr.nonce;
        delete proposals[msg.sender][category];
        emit ProposalCancelled(msg.sender, category, nonce);
    }

    // ------------------------------------------------------------------
    // Top-ups: the only way capital reaches trading
    // ------------------------------------------------------------------
    function instantTopUp(address destinationOwner, uint64 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = _own();
        RegistryEntry storage e = registry[msg.sender][destinationOwner];
        if (!(e.active && e.kind == KIND_EXECUTION)) revert DestinationNotExecution();
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < v.cooldownUntil) revert CooldownActive();
        _checkFloor(v, amount);
        _rollBuckets(v, nowTs);
        _checkVelocity(v, amount);
        uint256 threshold = (uint256(v.balance) * v.topUpThresholdBps) / BPS_DENOM;
        if (uint256(amount) >= threshold) revert AmountRequiresGatedTopUp();
        _reserveVelocity(v, amount);
        v.balance -= amount;
        _deliver(destinationOwner, e.route, amount);
        emit TopUpExecuted(msg.sender, destinationOwner, amount, true, 0, _velocitySum(v), v.balance, e.route);
    }

    function proposeTopUp(address destinationOwner, uint64 amount) external {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = _own();
        RegistryEntry storage e = registry[msg.sender][destinationOwner];
        if (!(e.active && e.kind == KIND_EXECUTION)) revert DestinationNotExecution();
        Proposal storage pr = proposals[msg.sender][CATEGORY_TOP_UP];
        if (pr.exists) revert ProposalSlotOccupied();
        uint64 nowTs = uint64(block.timestamp);
        _checkFloor(v, amount);
        _rollBuckets(v, nowTs);
        _checkVelocity(v, amount);
        _reserveVelocity(v, amount);
        uint64 nonce = ++v.proposalNonceCounter;
        uint64 staticAfter = nowTs + v.topUpCooldownSecs;
        uint64 executeAfter = staticAfter > v.cooldownUntil ? staticAfter : v.cooldownUntil;
        pr.exists = true;
        pr.category = CATEGORY_TOP_UP;
        pr.action = ACTION_TOP_UP;
        pr.nonce = nonce;
        pr.createdAt = nowTs;
        pr.executeAfter = executeAfter;
        pr.expiry = executeAfter + PROPOSAL_EXECUTION_GRACE_SECS;
        pr.configVersionAtCreation = v.configVersion;
        pr.destinationOwner = destinationOwner;
        pr.amount = amount;
        pr.reservedBucketIndex = v.currentBucketIndex;
        emit TopUpProposed(msg.sender, destinationOwner, amount, nonce, executeAfter);
    }

    function executeTopUp() external nonReentrant {
        Vault storage v = _own();
        Proposal storage pr = proposals[msg.sender][CATEGORY_TOP_UP];
        if (!pr.exists || pr.action != ACTION_TOP_UP) revert NoPendingProposal();
        _checkMaturityAndStaleness(v, pr);
        if (uint64(block.timestamp) < v.cooldownUntil) revert CooldownActive();
        RegistryEntry storage e = registry[msg.sender][pr.destinationOwner];
        if (!(e.active && e.kind == KIND_EXECUTION)) revert DestinationNotExecution();
        uint64 amount = pr.amount;
        address dest = pr.destinationOwner;
        uint64 nonce = pr.nonce;
        _checkFloor(v, amount);
        delete proposals[msg.sender][CATEGORY_TOP_UP];
        v.balance -= amount;
        _deliver(dest, e.route, amount);
        emit TopUpExecuted(msg.sender, dest, amount, false, nonce, _velocitySum(v), v.balance, e.route);
    }

    // ------------------------------------------------------------------
    // Risk verdict: may only extend a cooldown
    // ------------------------------------------------------------------
    function applyRiskVerdict(RiskVerdict calldata rv, bytes calldata signature) external {
        Vault storage v = vaults[rv.vault];
        if (!v.exists) revert NoVault();
        if (v.riskVerifier == address(0)) revert NoRiskVerifier();
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs > rv.expiry) revert VerdictExpired();
        if (rv.issuedAt > nowTs + VERDICT_CLOCK_SKEW_SECS) revert VerdictNotYetValid();
        if (rv.nonce <= v.lastVerdictNonce) revert VerdictReplayed();
        if (rv.realizedLossUsdc < v.lossTriggerUsdc) revert VerdictBelowLossTrigger();
        if (_recoverVerdictSigner(rv, signature) != v.riskVerifier) revert InvalidVerifier();

        v.lastVerdictNonce = rv.nonce;
        v.lastVerdictReason = rv.reasonCode;
        v.lastVerdictEvidence = rv.evidenceHash;
        uint64 target = nowTs + v.lossCooldownSecs;
        bool extended = target > v.cooldownUntil;
        if (extended) {
            v.cooldownUntil = target;
            v.cooldownReason = COOLDOWN_REASON_RISK_VERDICT;
            v.cooldownSetAt = nowTs;
        }
        emit RiskVerdictApplied(rv.vault, rv.nonce, rv.reasonCode, rv.realizedLossUsdc, v.cooldownUntil, extended, rv.evidenceHash);
    }

    function hashVerdict(RiskVerdict calldata rv) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(VERDICT_TYPEHASH, rv.vault, rv.nonce, rv.issuedAt, rv.expiry, rv.reasonCode, rv.realizedLossUsdc, rv.evidenceHash));
        return keccak256(abi.encodePacked("\x19\x01", _DOMAIN_SEPARATOR, structHash));
    }

    function _recoverVerdictSigner(RiskVerdict calldata rv, bytes calldata sig) internal view returns (address) {
        if (sig.length != 65) revert InvalidVerifier();
        bytes32 r; bytes32 s; uint8 vv;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            vv := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (vv < 27) vv += 27;
        if (vv != 27 && vv != 28) revert InvalidVerifier();
        // reject high-s malleable signatures
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert InvalidVerifier();
        address signer = ecrecover(hashVerdict(rv), vv, r, s);
        if (signer == address(0)) revert InvalidVerifier();
        return signer;
    }

    // ------------------------------------------------------------------
    // Moving toward safety: always instant within the cap
    // ------------------------------------------------------------------
    function instantColdTransfer(address destinationOwner, uint64 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Vault storage v = _own();
        RegistryEntry storage e = registry[msg.sender][destinationOwner];
        if (!(e.active && e.kind == KIND_COLD)) revert DestinationNotCold();
        if (amount > v.emergencyCap) revert AmountExceedsEmergencyCap();
        uint64 nowTs = uint64(block.timestamp);
        _checkFloor(v, amount);
        _rollBuckets(v, nowTs);
        _checkVelocity(v, amount);
        _reserveVelocity(v, amount);
        v.balance -= amount;
        if (!usdc.transfer(destinationOwner, amount)) revert TransferFailed();
        emit ColdTransferExecuted(msg.sender, destinationOwner, amount, true);
    }

    function proposeColdTransferAboveCap(address destinationOwner, uint64 amount) external {
        if (amount == 0) revert ZeroAmount();
        _proposeFullExit(destinationOwner, ACTION_COLD_ABOVE_CAP, amount);
    }

    function proposeUninstallVault(address destinationOwner) external {
        _proposeFullExit(destinationOwner, ACTION_UNINSTALL, 0);
    }

    function executeFullExit() external nonReentrant {
        Vault storage v = _own();
        Proposal storage pr = proposals[msg.sender][CATEGORY_FULL_EXIT];
        if (!pr.exists) revert NoPendingProposal();
        _checkMaturityAndStaleness(v, pr);
        RegistryEntry storage e = registry[msg.sender][pr.destinationOwner];
        if (!(e.active && e.kind == KIND_COLD)) revert FullExitDestinationNotRegisteredCold();
        uint64 amount = pr.action == ACTION_UNINSTALL ? v.balance : pr.amount;
        if (amount == 0) revert ZeroAmount();
        if (amount > v.balance) revert ProtectedFloorBreached();
        address dest = pr.destinationOwner;
        delete proposals[msg.sender][CATEGORY_FULL_EXIT];
        v.balance -= amount;
        if (!usdc.transfer(dest, amount)) revert TransferFailed();
        emit FullExitExecuted(msg.sender, dest, amount);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------
    function _own() internal view returns (Vault storage v) {
        v = vaults[msg.sender];
        if (!v.exists) revert Unauthorized();
    }

    function _deliver(address destinationOwner, uint8 route, uint64 amount) internal {
        if (route == ROUTE_HYPERCORE && address(coreDeposit) != address(0)) {
            if (!usdc.approve(address(coreDeposit), amount)) revert TransferFailed();
            coreDeposit.depositFor(destinationOwner, amount, HYPERCORE_PERPS_DEX);
        } else {
            if (!usdc.transfer(destinationOwner, amount)) revert TransferFailed();
        }
    }

    function _applyRegistration(address authority, address owner, uint8 kind, uint8 route, bytes24 label) internal {
        if (kind > 1 || route > 1) revert InvalidParameter();
        RegistryEntry storage e = registry[authority][owner];
        if (e.registeredAt != 0) {
            if (e.kind != kind) revert AlreadyRegisteredDifferentType();
            e.active = true;
            e.label = label;
            e.route = route;
        } else {
            e.kind = kind;
            e.route = route;
            e.active = true;
            e.registeredAt = uint64(block.timestamp);
            e.label = label;
            registryOwners[authority].push(owner);
        }
        emit RegistrationChanged(authority, owner, kind, route, true, label);
    }

    function _proposeFullExit(address destinationOwner, uint8 action, uint64 amount) internal {
        Vault storage v = _own();
        RegistryEntry storage e = registry[msg.sender][destinationOwner];
        if (!(e.active && e.kind == KIND_COLD)) revert FullExitDestinationNotRegisteredCold();
        Proposal storage pr = proposals[msg.sender][CATEGORY_FULL_EXIT];
        if (pr.exists) revert ProposalSlotOccupied();
        uint64 nowTs = uint64(block.timestamp);
        uint64 nonce = ++v.proposalNonceCounter;
        uint64 executeAfter = nowTs + v.fullExitCooldownSecs;
        pr.exists = true;
        pr.category = CATEGORY_FULL_EXIT;
        pr.action = action;
        pr.nonce = nonce;
        pr.createdAt = nowTs;
        pr.executeAfter = executeAfter;
        pr.expiry = executeAfter + PROPOSAL_EXECUTION_GRACE_SECS;
        pr.configVersionAtCreation = v.configVersion;
        pr.destinationOwner = destinationOwner;
        pr.amount = amount;
        emit FullExitProposed(msg.sender, destinationOwner, nonce, executeAfter, action == ACTION_UNINSTALL, amount);
    }

    function _checkMaturityAndStaleness(Vault storage v, Proposal storage pr) internal view {
        uint64 nowTs = uint64(block.timestamp);
        if (nowTs < pr.executeAfter) revert ProposalNotMatured();
        if (nowTs > pr.expiry) revert ProposalExpired();
        if (pr.configVersionAtCreation != v.configVersion) revert ProposalStale();
    }

    function _checkFloor(Vault storage v, uint64 amount) internal view {
        if (amount > v.balance) revert ProtectedFloorBreached();
        if (v.balance - amount < v.protectedFloor) revert ProtectedFloorBreached();
    }

    function _rollBuckets(Vault storage v, uint64 nowTs) internal {
        if (v.bucketStart == 0) {
            v.bucketStart = nowTs;
            v.currentBucketIndex = 0;
            return;
        }
        if (nowTs < v.bucketStart) return;
        uint64 elapsed = (nowTs - v.bucketStart) / BUCKET_LEN_SECS;
        if (elapsed == 0) return;
        if (elapsed >= NUM_VELOCITY_BUCKETS) {
            for (uint256 i = 0; i < NUM_VELOCITY_BUCKETS; i++) v.velocityBuckets[i] = 0;
            elapsed = uint64(NUM_VELOCITY_BUCKETS);
        } else {
            for (uint64 i = 0; i < elapsed; i++) {
                uint256 idx = (uint256(v.currentBucketIndex) + 1 + i) % NUM_VELOCITY_BUCKETS;
                v.velocityBuckets[idx] = 0;
            }
            v.currentBucketIndex = uint8((uint256(v.currentBucketIndex) + elapsed) % NUM_VELOCITY_BUCKETS);
        }
        v.bucketStart += elapsed * BUCKET_LEN_SECS;
    }

    function _velocitySum(Vault storage v) internal view returns (uint64 s) {
        for (uint256 i = 0; i < NUM_VELOCITY_BUCKETS; i++) s += v.velocityBuckets[i];
    }

    function _checkVelocity(Vault storage v, uint64 amount) internal view {
        if (uint256(_velocitySum(v)) + amount > v.velocityThreshold) revert VelocityThresholdExceeded();
    }

    function _reserveVelocity(Vault storage v, uint64 amount) internal {
        v.velocityBuckets[v.currentBucketIndex] += amount;
    }

    function _refundVelocity(Vault storage v, uint64 amount, uint8 bucketIndex) internal {
        uint256 idx = uint256(bucketIndex) % NUM_VELOCITY_BUCKETS;
        uint64 cur = v.velocityBuckets[idx];
        v.velocityBuckets[idx] = cur > amount ? cur - amount : 0;
    }
}

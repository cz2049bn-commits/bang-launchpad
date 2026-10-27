// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
// BANG 1.0.0; canonical Flap interfaces: 5949cc7eb99bcb5ac5f679cc710ae456e627f12a
// Deploy BANGFactoryV3. Do not treat this new source as an already-deployed contract.

// File: contracts/flap/VaultBase.sol



/// @title VaultBase
/// @notice Abstract base contract for all vault implementations
/// @author The Flap Team
/// @dev How to implement your own vault contract:
///
/// 1. **Inherit from this base contract**
///    - All vault implementations must extend this contract
///
/// 2. **Implement the description() method**
///    - This method should return a dynamic string describing the vault's current state
///    - The description should change based on vault state (e.g., balance, streaming status, etc.)
///    - Example: "Flap Tax Vault for TOKEN, this vault automatically buyback tokens, we have bought back 3.2M tokens. Developed by Alice (twitter.com/alice)"
///
/// 3. **Use _getPortal() for Portal interactions**
///    - Call this internal method to get the Portal address for the current chain
///    - The method reverts if the current chain is not supported
///    - Currently only BNB Chain (chain ID 56) and BNB Testnet (chain ID 97) are supported
///
/// 4. **Use _getGuardian() for Guardian address**
///    - Call this internal method to get the Guardian address for the current chain
///    - The Guardian is a privileged address that can always call permissioned functions if you have any
///    - The method reverts if the current chain is not supported
///    - Currently only BNB Chain (chain ID 56) and BNB Testnet (chain ID 97) are supported
///
/// 5. **Handle tax token revenue**
///    - Implement a receive() function to accept BNB from the tax token
///    - Process the revenue according to your vault's logic (accumulate, stream, buyback, etc.)
///
/// 6. **MANDATE: Guardian access to permissioned functions**
///    - If you have any permissioned functions that should be triggered by an external address,
///      and it is not suitable to make them public (e.g. buyback which may be sandwich attacked),
///      you MUST ALSO give the guardian address the permissions alongside other allowed addresses as a backup.
///    - The guardian can always call permissioned functions and must have the necessary roles/permissions.
///    - The guardian's role MUST NOT be revocable by any other account — only the guardian itself
///      may renounce its own access.
///
///    When using OpenZeppelin's `AccessControl`, override `revokeRole()` to enforce this:
///
///      ```
///      function revokeRole(bytes32 role, address account)
///          public
///          override
///          onlyRole(getRoleAdmin(role))
///      {
///          address guardian = _getGuardian();
///          if (account == guardian) {
///              revert CannotRevokeGuardianRole();
///          }
///          super.revokeRole(role, account);
///      }
///      ```
///
///    This ensures that the Guardian always retains a backup path to call
///    permissioned functions, regardless of any admin action.
///
abstract contract VaultBase {
    /// @notice Error thrown when the current chain is not supported
    error UnsupportedChain(uint256 chainId);

    /// @notice Get the Portal address for the current chain
    /// @dev Currently supports:
    ///        - BNB Chain      (chain ID 56)
    ///        - BNB Testnet    (chain ID 97)
    ///        - Robinhood Chain(chain ID 4663 / 46630)
    ///      All other chains use the same addresses (Base, X Layer, ...).
    /// @return portal The Portal contract address
    function _getPortal() internal view returns (address portal) {
        uint256 chainId = block.chainid;
        if (chainId == 56) {
            // BNB Chain Portal
            return 0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0;
        } else if (chainId == 97) {
            // BNB Testnet Portal
            return 0x5bEacaF7ABCbB3aB280e80D007FD31fcE26510e9;
        } else if (chainId == 4663 || chainId == 46630) {
            // Robinhood Chain Portal
            return 0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09;
        } else {
            // Base / X Layer / any other chain
            return 0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000;
        }
    }

    /// @notice Get the Guardian address for the current chain
    /// @dev Currently supports:
    ///        - BNB Chain      (chain ID 56)
    ///        - BNB Testnet    (chain ID 97)
    ///        - Robinhood Chain(chain ID 4663 / 46630)
    ///      All other chains use the same addresses (Base, X Layer, ...).
    /// @return guardian The Guardian contract address
    function _getGuardian() internal view returns (address guardian) {
        uint256 chainId = block.chainid;
        if (chainId == 56) {
            // BNB Chain Guardian address
            return 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;
        } else if (chainId == 97) {
            // BNB Testnet Guardian address
            return 0x76Fa8C526f8Bc27ba6958B76DeEf92a0dbE46950;
        } else if (chainId == 4663 || chainId == 46630) {
            // Robinhood Chain Guardian address
            return 0x0000b48720d3B4ED6BC5031768B07F2b59270000;
        } else {
            // Base / X Layer / any other chain
            return 0x00004d58290854c5E9880F4b5B1993c6Ad8b0000;
        }
    }

    /// @notice Returns a description of the vault
    /// @dev This method should be overridden by implementing contracts to provide
    ///      a dynamic description based on the vault's current state
    /// @return A string describing the vault's current state and configuration
    function description() public view virtual returns (string memory);
}

// File: contracts/flap/IVaultSchemasV1.sol



/// @title IVaultSchemasV1
/// @author The Flap Team
/// @notice Shared struct definitions used by VaultFactory and Vault UI schema methods.
///
/// @dev  ── WHY THIS FILE EXISTS ──────────────────────────────────────────────
///
/// The Flap protocol allows anyone to create new vault factories.  Any
/// contract that implements `VaultFactoryBaseV2` can be used to launch
/// tokens via VaultPortal — no on-chain registration is required.
/// Each factory decodes the opaque `vaultData` bytes in
/// `newVault()` differently, and each vault exposes a unique set of
/// user-facing view and write methods.
///
/// Existing vault types (FlapXVault, SplitVault, SnowBallVault,
/// BlackHoleVault) already have purpose-built UIs.  However, the protocol
/// is designed to be extended — any third-party developer can create a new
/// vault factory and vault implementation without modifying the core
/// contracts or the UI codebase.
///
/// Without a self-describing mechanism, a new vault type would require a
/// custom UI to be built and deployed before users could interact with it.
/// The structs in this file solve this problem by providing an on-chain
/// schema that enables **automatic UI generation for any future vault type**.
///
/// Both `VaultFactoryBaseV2.vaultDataSchema()` and
/// `VaultBaseV2.vaultUISchema()` return structs defined here, allowing a
/// generic UI to render creation forms and vault interaction pages for
/// vault types that did not exist when the UI was built.
///
///
/// ── STRUCT CONSOLIDATION ───────────────────────────────────────────────────
///
/// `FieldDescriptor` is the unified leaf type shared by both the factory
/// schema (`VaultDataSchema.fields`) and the vault UI schema
/// (`VaultMethodSchema.inputs` / `VaultMethodSchema.outputs`).  Keeping one
/// struct avoids duplication and ensures the type system is consistent across
/// the protocol.
///
///
/// ── HOW THE UI USES VaultDataSchema (factory side) ─────────────────────────
///
///   1. UI obtains the factory address (e.g. from the token-launch event
///      or a directory service).
///   2. UI calls factory.vaultDataSchema() → gets VaultDataSchema.
///   3. For each field in schema.fields, UI renders an input:
///        "string"   → text input
///        "address"  → address input (with checksum validation)
///        "uint16"   → number input (0–65535)
///        "uint256"  → big-number input
///        "time"     → date/time picker input (alias for uint256;
///                      value is a Unix timestamp in seconds).
///                      When used in outputs, rendered as a
///                      human-readable time string or countdown clock
///        "bool"     → checkbox
///        "bytes"    → hex input
///        "bytes32"  → hex input (32 bytes)
///      For numeric fields, if field.decimals > 0 the UI multiplies the
///      user's input by 10^decimals before encoding.
///        e.g. decimals=18: user types "1" → encoded value is 1e18
///      If decimals == 0 the raw value is used as-is.
///   4. If schema.isArray == true, UI renders an "Add Item" button for
///      dynamic array entries.
///   5. UI encodes the user input via:
///        If isArray: abi.encode(tuple[])
///        Else:       abi.encode(tuple)
///      using the fieldType values to construct the ABI type string.
///   6. Encoded bytes are passed as `vaultData` in NewTaxTokenWithVaultParams.
///
/// NOTE: The current spec only supports either a single tuple or an array
///       of tuples.
///
///
/// ── HOW THE UI USES VaultUISchema (vault side) ─────────────────────────────
///
///   1. UI calls vault.vaultUISchema() → gets VaultUISchema.
///   2. UI displays schema.vaultType as a badge/header and
///      schema.description as subtitle.
///   3. UI always calls vault.description() and displays the result as a
///      dynamic status banner.
///   4. For each method in schema.methods:
///      a. If method.isWriteMethod == false (VIEW):
///         - If method.inputs is empty: call immediately and display results.
///         - If method.inputs is non-empty: render input fields, add a
///           "Query" button.
///           - If method.isInputArray == true, render an "Add Item" button.
///         - For outputs: use field.decimals to format numeric values
///           (e.g. decimals=18: raw 1.5e18 → display "1.5").
///           For "time" fields, display the raw uint256 value as a
///           human-readable time string or a countdown clock.
///         - Derive the ABI type string from outputs[].fieldType +
///           method.isOutputArray.
///         - Use field.name and field.description as column headers/tooltips.
///      b. If method.isWriteMethod == true (WRITE):
///         - Render a form with inputs from method.inputs.
///         - If method.isInputArray == true, render "Add Item" button.
///         - Each input renders based on fieldType:
///             "address" → address input with checksum validation
///             "uint256" → big-number input
///             "uint128" → number input
///             "time"    → date/time picker input (alias for uint256;
///                          value is a Unix timestamp in seconds)
///             "string"  → text input
///             "bytes"   → hex input
///             "bool"    → checkbox
///         - If field.decimals > 0, the UI multiplies the user's
///           human-readable input by 10^decimals before encoding.
///         - If method.approvals is non-empty, BEFORE sending the write
///           transaction the UI executes each ApproveAction in order:
///             i.   Resolve the token address from approval.tokenType:
///                    "taxToken" → call vault.taxToken()
///                    "lpToken"  → call vault.lpToken()
///                    unknown    → skip (log warning, forward-compatible)
///             ii.  Read the amount from the user's input field named by
///                  approval.amountFieldName (already scaled by decimals).
///             iii. Check current allowance: token.allowance(user, vault).
///                  If already sufficient, skip.
///             iv.  Send token.approve(vault, amount) and wait for
///                  confirmation.
///             v.   Repeat for the next ApproveAction.
///         - After all approvals succeed, send the write transaction.
///         - Add a "Submit" / "Execute" button that sends the transaction.
///         - If method.inputs is empty, just render a single action button.
///   5. All methods are displayed in the order returned by vaultUISchema().
///   6. description() output is polled/refreshed periodically as a live
///      status indicator.

// ──────────────────────────────────────────────────────────────────────────────
//  Shared Struct Definitions
// ──────────────────────────────────────────────────────────────────────────────

/// @notice Describes a single field (parameter, return value, or vault-data component).
///
/// @dev   This is the unified leaf type used in both:
///        - `VaultDataSchema.fields`   (factory → describes vaultData encoding)
///        - `VaultMethodSchema.inputs` / `VaultMethodSchema.outputs`  (vault UI)
///
///        Keeping one struct avoids duplication and ensures the type system is
///        consistent across the protocol.
///
/// @param name        Machine-readable name of the field.
///                    Examples: "xHandle", "recipient", "bps", "user", "amount".
///
/// @param fieldType   Solidity ABI type string for the field.
///                    Examples: "string", "address", "uint16", "uint256", "uint128",
///                    "bool", "bytes", "bytes32".
///                    The special value "time" is an alias for "uint256".
///                    The encoded value is a Unix timestamp in seconds.
///                    For ABI encoding purposes the UI treats "time"
///                    identically to "uint256".
///                    - As an **input**, the UI renders a date/time picker.
///                    - As an **output**, the UI renders the value as a
///                      human-readable time string or a countdown clock.
///                    The special value "msg.value" indicates that the field
///                    represents the native currency amount (in wei) to send
///                    with the transaction.  Rules for this type:
///                    - This field is **NOT** ABI-encoded into the function
///                      call data.  Instead, the UI uses the value as the
///                     call's `value` (i.e `msg.value`).
///                    - It **MUST** only be used for inputs in write methods
///                      (i.e. when `VaultMethodSchema.isWriteMethod == true`).
///                    - Only one "msg.value" field per method is meaningful.
///                    Example – a payable deposit method:
///                    //   function deposit() public payable
///                    //
///                    //   inputs[0] = FieldDescriptor(
///                    //       "amount", "msg.value",
///                    //       "Amount to deposit (BNB)", 18
///                    //   );
///                    The UI uses this to decide which input widget to render
///                    and how to ABI-encode/decode the value.
///
/// @param description Human-readable explanation of the field, shown as a
///                    label or tooltip in the UI.
///                    Examples: "The Twitter/X handle of the token creator",
///                    "Recipient wallet address",
///                    "Basis points share (10000 = 100%)".
///
/// @param decimals    Decimal precision hint for numeric fields.
///                    - For **factory encoding** (VaultDataSchema context):
///                      If decimals > 0, the UI multiplies the user's input
///                      by 10^decimals before ABI-encoding.
///                      e.g. decimals=18: user types "1" → encoded as 1e18.
///                      If decimals == 0, the raw value is used as-is.
///                    - For **vault display** (VaultMethodSchema.outputs context):
///                      If decimals > 0, the UI divides the raw on-chain value
///                      by 10^decimals for display.
///                      e.g. decimals=18: raw 1.5e18 → display "1.5".
///                      If decimals == 0, the raw value is displayed.
///                    - For non-numeric fields (string, address, bytes, bool),
///                      this should always be 0.
struct FieldDescriptor {
    string name;
    string fieldType;
    string description;
    uint8 decimals;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Factory-side: VaultDataSchema
// ──────────────────────────────────────────────────────────────────────────────

/// @notice Describes the shape of the `vaultData` bytes expected by a
///         VaultFactory's `newVault()` method.
///
/// @dev   A UI calls `factory.vaultDataSchema()` to discover what fields the
///        factory expects, then renders a form accordingly.
///
///        The current spec supports two shapes:
///          • A single tuple   (`isArray == false`)  – e.g. `(string)`
///          • An array of tuples (`isArray == true`)  – e.g. `(address,uint16)[]`
///
///        If `fields` is empty and `isArray` is false, the factory ignores
///        `vaultData` entirely (e.g. SnowBallFactory).
///
/// @param description  Free-form string explaining what the vault does and
///                     what data is required. Shown to the user in the UI.
///
/// @param fields       Ordered list of field descriptors.  Each entry maps to
///                     one component of the ABI-encoded tuple.
///                     For a factory that requires no user input, return an
///                     empty array.
///
/// @param isArray      If true, `vaultData` is ABI-encoded as `tuple[]`
///                     (an array of the tuple described by `fields`).
///                     If false, `vaultData` is ABI-encoded as a single `tuple`.
struct VaultDataSchema {
    string description;
    FieldDescriptor[] fields;
    bool isArray;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Vault-side: VaultUISchema & supporting types
// ──────────────────────────────────────────────────────────────────────────────

/// @notice An ERC-20 `approve` action that the UI must execute **before**
///         calling a write method on the vault.
///
/// @dev   The spender is always the vault contract itself.
///
///        Known `tokenType` values:
///          • "taxToken" – the vault's own tax token (resolved via vault.taxToken())
///          • "lpToken"  – the associated LP token  (resolved via vault.lpToken())
///
///        New token types can be added in the future without changing this
///        struct.  The UI **MUST** ignore any `tokenType` it does not
///        recognise (forward-compatible).
///
///        Workflow for the UI when processing an ApproveAction:
///          1. Resolve the token address from `tokenType`:
///               "taxToken" → call vault.taxToken()
///               "lpToken"  → call vault.lpToken()
///               unknown    → skip with a warning (forward-compatible)
///          2. Read the amount from the user's input field whose `name`
///             matches `amountFieldName`.  The value should already be
///             scaled by the field's `decimals`.
///          3. Check current allowance: token.allowance(user, vault).
///             If already sufficient, skip.
///          4. Send token.approve(vault, amount) and wait for confirmation.
///
/// @param tokenType       Which token to approve.
///                        e.g. "taxToken", "lpToken".
///
/// @param amountFieldName The `name` of the write method's input
///                        FieldDescriptor whose value should be used as
///                        the approve amount.
///                        e.g. "amount".
struct ApproveAction {
    string tokenType;
    string amountFieldName;
}

/// @notice Describes a single view or write method that the UI should render
///         for a vault.
///
/// @dev   The UI iterates over the `methods` array in `VaultUISchema` and
///        renders each method as either a read-only query panel (view) or an
///        interactive form (write).
///
/// @param name          Solidity method name.
///                      e.g. "claim", "getRecipientsInfo", "stats",
///                      "dispatch", "transitState", "manageByProof".
///
/// @param description   Human-readable explanation of what the method does.
///                      Shown as a subtitle or tooltip in the UI.
///
/// @param inputs        Ordered list of input parameters.
///                      Empty for no-arg methods (e.g. dispatch(), stats()).
///                      Each FieldDescriptor maps to one method parameter.
///
/// @param outputs       Ordered list of return values.
///                      Empty for write methods (tx receipts don't return data
///                      to the UI).
///                      Each FieldDescriptor maps to one return component.
///                      The UI uses `field.decimals` to format numeric values
///                      for display.
///
/// @param approvals     Ordered list of ERC-20 approve actions the UI must
///                      execute **before** sending the write transaction.
///                      The spender is always the vault contract.
///                      Empty for:
///                        • view methods
///                        • write methods that need no prior approval
///
/// @param isInputArray  If true, the method's input is an array of tuples
///                      described by `inputs`.  The UI should render an
///                      "Add Row" button for dynamic array entries.
///
/// @param isOutputArray If true, the method's return value is an array of
///                      tuples described by `outputs`.  The UI should render
///                      results as a table with one row per element.
///
/// @param isWriteMethod If true, the method is state-changing and the UI
///                      should send a transaction.
///                      If false, the method is a view call and the UI
///                      should display the returned data.
struct VaultMethodSchema {
    string name;
    string description;
    FieldDescriptor[] inputs;
    FieldDescriptor[] outputs;
    ApproveAction[] approvals;
    bool isInputArray;
    bool isOutputArray;
    bool isWriteMethod;
}

/// @notice Top-level schema describing the vault's entire UI surface.
///
/// @dev   Returned by `VaultBaseV2.vaultUISchema()`.  The UI uses this to
///        build the complete vault interaction page.
///
///        Rendering algorithm:
///          1. Display `vaultType` as a badge/header.
///          2. Display `description` as a subtitle.
///          3. Always call `vault.description()` and display the result as a
///             dynamic status banner (polled/refreshed periodically).
///          4. Iterate `methods` and render each one according to its
///             `isWriteMethod` flag (see VaultMethodSchema docs above).
///          5. Methods are displayed in the order returned.
///
/// @param vaultType    Human-readable vault type identifier.
///                     e.g. "FlapXVault", "SplitVault", "SnowBallVault",
///                     "BlackHoleVault".
///
/// @param description  Overall explanation of the vault for the UI.
///                     e.g. "Distributes received BNB among a fixed set of
///                     recipients by basis-point shares."
///
/// @param methods      All methods the UI should render.
///                     Ordered — the UI displays them in this order.
struct VaultUISchema {
    string vaultType;
    string description;
    VaultMethodSchema[] methods;
}

// ──────────────────────────────────────────────────────────────────────────────
//  Factory-side: FactoryPolicy (VaultFactoryBaseV2 v2.1)
// ──────────────────────────────────────────────────────────────────────────────

/// @notice A single constraint on the parameters passed to newTokenV6WithVault.
///
/// @dev    Inspired by AWS IAM policy conditions.  Each FactoryPolicy describes
///         one constraint: "field <target> must satisfy <operator> <value>".
///
///         These policies are **informational only** — they are intended for
///         UI rendering (inline validation hints, error messages).  The actual
///         enforcement always happens inside `onBeforeNewTokenV6WithVault`.
///
///         Factories that override `onBeforeNewTokenV6WithVault` SHOULD also
///         override `tokenCreationPolicies()` to describe their constraints in
///         this machine-readable form so the UI can surface them proactively.
///
///
/// ── FIELD REFERENCE ────────────────────────────────────────────────────────
///
/// @param target      The Solidity field name in
///                    IVaultPortalTypes.NewTokenV6WithVaultParams that this
///                    constraint applies to.
///                    Examples: "dividendToken", "dividendBps", "taxBps",
///                    "quoteToken", "migratorType".
///
/// @param operator    The comparison operator.  Supported values:
///                    "eq"    – field must equal value
///                    "neq"   – field must not equal value
///                    "gt"    – field must be strictly greater than value
///                    "gte"   – field must be greater than or equal to value
///                    "lt"    – field must be strictly less than value
///                    "lte"   – field must be less than or equal to value
///                    "in"    – field must be one of a set; `value` is an
///                              ABI-encoded dynamic array of that field's type
///                    "notIn" – field must not be any of a set (same encoding)
///                    Unknown operators MUST be ignored by the UI (forward-compat).
///
/// @param value       ABI-encoded expected value.
///                    Since `target` identifies a specific field in
///                    NewTokenV6WithVaultParams whose Solidity type is fixed,
///                    the UI already knows the ABI type and can decode `value`
///                    directly without an additional type hint.
///                    For "in" / "notIn", `value` is an ABI-encoded dynamic
///                    array of that field's element type.
///
/// @param description Human-readable explanation shown as a tooltip or inline
///                    validation hint in the UI.
///                    Examples:
///                    "Dividend token must equal the quote token (WBNB)."
///                    "Dividend BPS must be at least 100 (1%)."
///
///
/// ── EXAMPLES ───────────────────────────────────────────────────────────────
///
///   // dividendToken must equal WBNB
///   FactoryPolicy({
///       target:      "dividendToken",
///       operator:    "eq",
///       value:       abi.encode(WBNB_ADDRESS),
///       description: "Dividend token must equal the quote token (WBNB)."
///   })
///
///   // dividendBps must be >= 100 (1%)
///   FactoryPolicy({
///       target:      "dividendBps",
///       operator:    "gte",
///       value:       abi.encode(uint256(100)),
///       description: "Dividend BPS must be at least 100 (1%)."
///   })
///
///   // quoteToken must be one of an allowed set
///   FactoryPolicy({
///       target:      "quoteToken",
///       operator:    "in",
///       value:       abi.encode(allowedAddresses),   // address[]
///       description: "Quote token must be WBNB or USDT."
///   })
///
struct FactoryPolicy {
    string target;
    string operator;
    bytes value;
    string description;
}

// File: contracts/flap/VaultBaseV2.sol






/// @title VaultBaseV2
/// @author The Flap Team
/// @notice Extended abstract base contract for vault implementations that adds
///         on-chain UI schema discovery via `vaultUISchema()`.
///
/// @dev  ── MOTIVATION ───────────────────────────────────────────────────────
///
/// The protocol is designed so that anyone can introduce new vault types.
/// Each vault implementation exposes a different set of user-facing view
/// and write methods — a generic UI rendering a vault page has no way to
/// know which methods to display, what each parameter means, or how to
/// format the results without inspecting each vault's source code.
///
/// Existing vault types (FlapXVault, SplitVault, SnowBallVault,
/// BlackHoleVault) already have purpose-built UIs.  `VaultBaseV2` exists
/// to support **future** vault implementations: by requiring every new
/// vault to override `vaultUISchema()`, the UI can automatically generate
/// a full interaction page for any vault type — even ones that did not
/// exist when the UI was built.
///
/// `vaultUISchema()` returns a `VaultUISchema` struct (defined in
/// `IVaultSchemasV1.sol`) that fully describes the methods the UI should
/// render.
///
///
/// ── BACKWARDS COMPATIBILITY ────────────────────────────────────────────────
///
/// `VaultBaseV2` inherits from the original `VaultBase` contract and adds only
/// the new `vaultUISchema()` abstract method.  Existing vaults that extend
/// `VaultBase` are unaffected.  New or upgraded vault implementations should
/// extend `VaultBaseV2` instead of `VaultBase` to gain UI schema support.
///
///
/// ── HOW TO IMPLEMENT ───────────────────────────────────────────────────────
///
/// 1. **Inherit from VaultBaseV2** instead of VaultBase.
///    All obligations from VaultBase still apply (implement `description()`,
///    use `_getPortal()`, `_getGuardian()`, handle `receive()`, etc.).
///
/// 2. **Override `vaultUISchema()`** to return a `VaultUISchema` describing
///    every user-facing method your vault exposes.
///
///    For each method include:
///      - `name`          – the Solidity function name (e.g. "claim")
///      - `description`   – human-readable explanation
///      - `inputs`        – ordered FieldDescriptor[] for parameters
///      - `outputs`       – ordered FieldDescriptor[] for return values
///      - `approvals`     – ApproveAction[] for any ERC-20 approvals required
///                          before calling a write method
///      - `isInputArray`  – true if input is tuple[]
///      - `isOutputArray` – true if output is tuple[]
///      - `isWriteMethod` – true for state-changing, false for view
///
/// 3. **MANDATE: Guardian access to privileged functions**
///    If your vault exposes any privileged / role-gated functions (e.g.
///    functions that should only be called by an operator or admin), the
///    Guardian address returned by `_getGuardian()` **must** also be
///    granted the required role(s).  Furthermore, the Guardian's role
///    **must not** be revocable by any other account — only the Guardian
///    itself may renounce its own access.
///
///    When using OpenZeppelin's `AccessControl`, override `revokeRole()` to
///    enforce this invariant:
///
///      ```
///      function revokeRole(bytes32 role, address account)
///          public
///          override
///          onlyRole(getRoleAdmin(role))
///      {
///          address guardian = _getGuardian();
///          if (account == guardian) {
///              revert CannotRevokeGuardianRole();
///          }
///          super.revokeRole(role, account);
///      }
///      ```
///
///    This ensures that the Guardian always retains a backup path to call
///    permissioned functions, regardless of any admin action.
///
///    (This mandate is inherited from VaultBase — see its documentation
///    for the canonical requirement.)
///
///
/// ── EXAMPLE: Hypothetical DonationVault (view + write, no approvals) ───
///
///   function vaultUISchema() public pure override returns (VaultUISchema memory schema) {
///       schema.vaultType = "DonationVault";
///       schema.description = "Collects BNB donations and lets a designated charity withdraw.";
///       schema.methods = new VaultMethodSchema[](2);
///
///       // View: totalDonated()
///       schema.methods[0].name = "totalDonated";
///       schema.methods[0].description = "Returns the total BNB donated so far.";
///       schema.methods[0].outputs = new FieldDescriptor[](1);
///       schema.methods[0].outputs[0] = FieldDescriptor("total", "uint256", "Total BNB donated", 18);
///
///       // Write: withdraw()
///       schema.methods[1].name = "withdraw";
///       schema.methods[1].description = "Withdraws accumulated donations to the charity address. Only the charity can call.";
///       schema.methods[1].approvals = new ApproveAction[](0);
///       schema.methods[1].isWriteMethod = true;
///   }
///
///
/// ── EXAMPLE: Hypothetical StakingVault (illustrating approve actions) ──────
///
///   function vaultUISchema() public pure override returns (VaultUISchema memory schema) {
///       schema.vaultType = "StakingVault";
///       schema.description = "Stakes tax tokens or LP tokens to earn rewards.";
///       schema.methods = new VaultMethodSchema[](3);
///
///       // View: stakedBalance(address)
///       schema.methods[0].name = "stakedBalance";
///       schema.methods[0].description = "Returns the staked balance for a given user.";
///       schema.methods[0].inputs = new FieldDescriptor[](1);
///       schema.methods[0].inputs[0] = FieldDescriptor("user", "address", "The user address to query", 0);
///       schema.methods[0].outputs = new FieldDescriptor[](1);
///       schema.methods[0].outputs[0] = FieldDescriptor("balance", "uint256", "Staked token balance", 18);
///
///       // Write: deposit(uint256) — requires ERC-20 approval of the tax token
///       schema.methods[1].name = "deposit";
///       schema.methods[1].description = "Stake tax tokens into the vault to earn rewards.";
///       schema.methods[1].inputs = new FieldDescriptor[](1);
///       schema.methods[1].inputs[0] = FieldDescriptor("amount", "uint256", "Amount of tax tokens to stake", 18);
///       schema.methods[1].approvals = new ApproveAction[](1);
///       // The UI will:
///       //   (1) call vault.taxToken() to get the token address
///       //   (2) call token.approve(vault, amount) where amount comes from the "amount" input field
///       schema.methods[1].approvals[0] = ApproveAction("taxToken", "amount");
///       schema.methods[1].isWriteMethod = true;
///
///       // Write: depositLP(uint256) — requires ERC-20 approval of the LP token
///       schema.methods[2].name = "depositLP";
///       schema.methods[2].description = "Stake LP tokens into the vault to earn boosted rewards.";
///       schema.methods[2].inputs = new FieldDescriptor[](1);
///       schema.methods[2].inputs[0] = FieldDescriptor("amount", "uint256", "Amount of LP tokens to stake", 18);
///       schema.methods[2].approvals = new ApproveAction[](1);
///       schema.methods[2].approvals[0] = ApproveAction("lpToken", "amount");
///       schema.methods[2].isWriteMethod = true;
///   }
///
///
/// ── EXAMPLE: Vault with no user-facing methods ─────────────────────────────
///
///   function vaultUISchema() public pure override returns (VaultUISchema memory schema) {
///       schema.vaultType = "SinkVault";
///       schema.description = "A vault that permanently locks all received BNB. No methods available.";
///       schema.methods = new VaultMethodSchema[](0);
///   }
///
abstract contract VaultBaseV2 is VaultBase {
    /// @notice Returns the UI schema describing which methods the UI should
    ///         render for this vault.
    ///
    /// @dev Each vault implementation **must** override this to describe its
    ///      own user-facing methods.
    ///
    ///      The returned `VaultUISchema` struct contains:
    ///        - `vaultType`   – e.g. "FlapXVault", "SplitVault"
    ///        - `description` – overall explanation of the vault
    ///        - `methods`     – ordered array of `VaultMethodSchema`, each
    ///                          describing one view or write method with its
    ///                          inputs, outputs, required approvals, and
    ///                          array flags.
    ///
    ///      The UI renders methods in the order they appear in the array.
    ///      See the VaultMethodSchema and VaultUISchema docs in
    ///      IVaultSchemasV1.sol for the full rendering algorithm.
    ///
    /// @return schema The complete UI schema for this vault.
    function vaultUISchema() public pure virtual returns (VaultUISchema memory schema);
}

// File: contracts/flap/VaultBaseV3.sol





/// @title VaultBaseV3
/// @author The Flap Team
/// @notice Extended abstract base contract for vault implementations that adds
///         support for ERC20 quote tokens (stablecoins, tokenized equities / RWA)
///         as the vault's revenue currency, via `vaultQuoteToken()` discovery and
///         a normative balance-delta accounting model.
///
/// @dev  ── MOTIVATION ───────────────────────────────────────────────────────
///
/// Every pre-V3 vault is driven by its `receive()` function: when the token's
/// TaxProcessor dispatches tax revenue in the native gas token (BNB / ETH),
/// the value transfer itself invokes `receive()` and the vault's logic runs.
///
/// ERC20 revenue breaks that assumption. An ERC20 `transfer` executes the
/// token contract's code, NOT the recipient's — the vault receives the funds
/// but is never invoked. No `receive()`, no `fallback()`, nothing. This is the
/// single reason vault-enabled launches were historically restricted to native
/// quote tokens.
///
/// V3 closes the gap with two coordinated mechanisms:
///
///   1. **The wake call ("ping"), sent by the protocol.** After every ERC20
///      quote payout, the TaxProcessor calls the recipient wallet with empty
///      calldata and zero value — `wallet.call{value: 0}("")` —
///      which invokes the vault's `receive()` exactly like a native transfer
///      would. The vault gets execution; the funds are already there.
///
///   2. **Balance-delta accounting, implemented by the vault (YOU).** Because
///      the wake call carries no value, `msg.value` is useless for ERC20
///      revenue. The vault must instead compare its current quote balance
///      against a stored baseline to recognize new revenue. The normative
///      model is specified below.
///
///
/// ── BACKWARDS COMPATIBILITY ────────────────────────────────────────────────
///
/// `VaultBaseV3` inherits from `VaultBaseV2` and adds only the new
/// `vaultQuoteToken()` abstract method and the `vaultSpecVersion()` marker.
/// Existing vaults that extend `VaultBase` or `VaultBaseV2` are unaffected —
/// they remain native-only and keep working unchanged. New or upgraded vault
/// implementations should extend `VaultBaseV3` instead of `VaultBaseV2` to
/// gain ERC20 quote support; native-only vaults may also adopt V3 (declare
/// `address(0)`) to benefit from the explicit currency declaration.
///
///
/// ── THE PING CONTRACT (what the protocol guarantees) ──────────────────────
///
/// The TaxProcessor's dispatch upholds four invariants; design your vault
/// against them:
///
///   1. **Transfer first, ping after.** When your `receive()` runs, the
///      revenue is already in your balance.
///   2. **Ping failures are ignored.** If your `receive()` reverts, dispatch
///      proceeds without you — the funds still arrive, but your logic did not
///      run and you will only recognize the revenue on the next wake. Do not
///      rely on reverting to refuse revenue.
///   3. **Ping gas is the dispatcher's, not yours.** The protocol does not
///      cap the wake call — it forwards the dispatch caller's remaining gas
///      (EIP-150), and dispatch is permissionless. The protocol's keeper runs
///      the ENTIRE dispatch (swaps, dividends, burn, up to four wallet
///      payouts) under one fixed gas budget; a heavy `receive()` makes the
///      keeper's dispatch of your token fail until someone re-dispatches with
///      a higher gas limit. Keep `receive()` lightweight: update accounting,
///      emit an event, return. Put heavy work — swaps, staking, buybacks —
///      behind explicit public functions driven by your own automation or the
///      protocol's keeper/trigger services.
///   4. **You may be pinged spuriously.** The same wallet can occupy several
///      payout slots and be pinged more than once per dispatch, and anyone
///      can call your `receive()` at any time. A wake that finds no new
///      revenue MUST be a silent no-op (see accounting model, rule 2).
///
/// Native revenue is unchanged: it still arrives as a plain value transfer
/// invoking `receive()`. A V3 vault handles both currencies with the same
/// code path — the accounting model below is currency-agnostic.
///
///
/// ── NORMATIVE ACCOUNTING MODEL (what YOUR vault must implement) ───────────
///
/// Maintain a baseline of already-recognized revenue, e.g.:
///
///   ```solidity
///   uint256 public accountedQuote; // recognized-and-not-yet-spent revenue
///
///   receive() external payable { _syncRevenue(); }
///
///   function _syncRevenue() internal {
///       address quoteToken = vaultQuoteToken();
///       uint256 bal = quoteToken == address(0)
///           ? address(this).balance
///           : IERC20(quoteToken).balanceOf(address(this));
///       if (bal <= accountedQuote) return;            // rule 2: idempotent no-op
///       uint256 newRevenue = bal - accountedQuote;
///       accountedQuote = bal;                          // rule 1: advance baseline
///       _onRevenue(newRevenue);                        // lightweight only (ping law 3)
///   }
///   ```
///
/// Rules:
///
///   1. **Recognize by delta, never by raw balance.** Crediting
///      `balanceOf(this)` as "new revenue" double-counts everything already
///      recognized. Only `balance - accountedQuote` is new.
///   2. **Zero-delta wakes are silent no-ops.** Required by ping law 4.
///   3. **Every outflow MUST decrement `accountedQuote`** by the amount
///      spent, in the same transaction. Forgetting this leaves the baseline
///      above the real balance, and `bal <= accountedQuote` then suppresses
///      revenue recognition forever — the vault deadlocks. This is the
///      single most dangerous mistake a V3 vault can make.
///   4. **Direct transfers are credited late, and that is fine.** Funds sent
///      to the vault outside dispatch (donations, airdrops, misdirected
///      transfers) trigger no ping; they are recognized on the next wake and
///      are indistinguishable from revenue. Treat them as donations. If your
///      vault's economics require exact per-payout amounts, do not infer them
///      from deltas — wait for a typed-callback spec revision (see FUTURE
///      EXTENSIONS).
///   5. **Recognize before you act.** Any function whose behavior depends on
///      available revenue — spending it, paying it out, or gating on it —
///      MUST run the sync routine first, so its outcome never depends on
///      whether a ping happened to arrive beforehand. This applies to every
///      custom function you add to your vault. Exposing a permissionless
///      `sync()` wrapper is RECOMMENDED: it is the neutral, side-effect-free
///      recognition entry for keepers and UIs, and the recovery path when
///      revenue arrives without a wake call (direct transfers, or pings
///      administratively disabled on the processor).
///
///
/// ── HOW TO IMPLEMENT ──────────────────────────────────────────────────────
///
/// 1. **Inherit from VaultBaseV3.** All obligations from VaultBase and
///    VaultBaseV2 still apply (implement `description()` and
///    `vaultUISchema()`, use `_getPortal()` / `_getGuardian()`, honor the
///    Guardian mandate).
///
/// 2. **Override `vaultQuoteToken()`** to return the revenue currency this
///    vault instance accounts for — `address(0)` for the native gas token,
///    the ERC20 address otherwise. It MUST equal the quote token of the tax
///    token this vault serves, MUST be immutable for the life of the vault
///    (set it once at initialization from the factory's `newVault`
///    parameters), and MUST NOT revert. VaultPortal cross-checks it at
///    launch; lenses and UIs read it to label the vault and to warn when a
///    vault is wired to a token with a different quote.
///
/// 3. **Implement `receive()` with the accounting model above.** Present even
///    if your quote is an ERC20 — the wake call lands there.
///
/// 4. **Keep `vaultSpecVersion()` at the default** unless a later spec
///    revision instructs otherwise.
///
/// 5. **Factory-side requirements** (see VaultFactoryBaseV2):
///      - `isQuoteTokenSupported(quote)` MUST answer truthfully for your
///        vault implementation. This is enforced on-chain at launch: the
///        VaultPortal rejects any launch whose quote your factory does not
///        support. Misdeclaring support strands your users' tax revenue in a
///        vault that ignores it.
///      - `factorySpecVersion()` MUST return "v2.3" (or higher) so the
///        VaultPortal applies the V3 validation flow.
///      - `newVault(taxToken, quoteToken, creator, vaultData)` receives the
///        launch quote token — pass it into your vault's initializer.
///      - Creation-time first buys in an ERC20 quote are funded by the
///        launcher, not the vault: the VaultPortal pulls `quoteAmt` from the
///        launching user (via an EIP-2612 permit signed with the VaultPortal
///        as spender, or a prior approval) and refunds any partial fill.
///        Frontends integrating your factory should request that approval or
///        permit; the vault itself plays no part in launch funding.
///
///
/// ── FUTURE EXTENSIONS (non-normative) ─────────────────────────────────────
///
/// A later spec revision may add a typed revenue callback in the spirit of
/// ERC721's `onERC721Received`:
///
///   ```solidity
///   interface IFlapRevenueReceiver {
///       function onFlapRevenue(address quoteToken, uint256 amount) external;
///   }
///   ```
///
/// Dispatch would prefer the typed callback (exact amounts, no delta
/// ambiguity) and fall back to the zero-value ping. The balance-delta
/// baseline remains the source of truth regardless — transfers can always
/// arrive without a callback — so vaults written against this spec stay
/// correct unchanged.
///
abstract contract VaultBaseV3 is VaultBaseV2 {
    /// @notice The revenue currency this vault accounts for.
    /// @dev MUST equal the quote token of the tax token this vault serves:
    ///      `address(0)` for the native gas token, the ERC20 address
    ///      otherwise. MUST be stable for the life of the vault and MUST NOT
    ///      revert. Consumed by the VaultPortal launch cross-check and by
    ///      lens/UI discovery.
    /// @return quoteToken The revenue currency (`address(0)` = native).
    function vaultQuoteToken() public view virtual returns (address quoteToken);

    /// @notice The vault-side spec revision this implementation conforms to.
    /// @dev Distinct from the factory-side `factorySpecVersion()` ("v2.x"
    ///      series): this string versions the VAULT contract surface.
    ///      Lenses read it to distinguish V3 vaults from legacy ones (which
    ///      implement neither this method nor `vaultQuoteToken()`).
    /// @return The spec version string, "v3" for this revision.
    function vaultSpecVersion() public pure virtual returns (string memory) {
        return "v3";
    }
}

// File: node_modules/@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol
// OpenZeppelin Contracts v4.4.1 (access/IAccessControl.sol)



/**
 * @dev External interface of AccessControl declared to support ERC165 detection.
 */
interface IAccessControlUpgradeable {
    /**
     * @dev Emitted when `newAdminRole` is set as ``role``'s admin role, replacing `previousAdminRole`
     *
     * `DEFAULT_ADMIN_ROLE` is the starting admin for all roles, despite
     * {RoleAdminChanged} not being emitted signaling this.
     *
     * _Available since v3.1._
     */
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole);

    /**
     * @dev Emitted when `account` is granted `role`.
     *
     * `sender` is the account that originated the contract call, an admin role
     * bearer except when using {AccessControl-_setupRole}.
     */
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Emitted when `account` is revoked `role`.
     *
     * `sender` is the account that originated the contract call:
     *   - if using `revokeRole`, it is the admin role bearer
     *   - if using `renounceRole`, it is the role bearer (i.e. `account`)
     */
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /**
     * @dev Returns `true` if `account` has been granted `role`.
     */
    function hasRole(bytes32 role, address account) external view returns (bool);

    /**
     * @dev Returns the admin role that controls `role`. See {grantRole} and
     * {revokeRole}.
     *
     * To change a role's admin, use {AccessControl-_setRoleAdmin}.
     */
    function getRoleAdmin(bytes32 role) external view returns (bytes32);

    /**
     * @dev Grants `role` to `account`.
     *
     * If `account` had not been already granted `role`, emits a {RoleGranted}
     * event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function grantRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from `account`.
     *
     * If `account` had been granted `role`, emits a {RoleRevoked} event.
     *
     * Requirements:
     *
     * - the caller must have ``role``'s admin role.
     */
    function revokeRole(bytes32 role, address account) external;

    /**
     * @dev Revokes `role` from the calling account.
     *
     * Roles are often managed via {grantRole} and {revokeRole}: this function's
     * purpose is to provide a mechanism for accounts to lose their privileges
     * if they are compromised (such as when a trusted device is misplaced).
     *
     * If the calling account had been granted `role`, emits a {RoleRevoked}
     * event.
     *
     * Requirements:
     *
     * - the caller must be `account`.
     */
    function renounceRole(bytes32 role, address account) external;
}

// File: contracts/flap/IPortal.sol





/// @dev Magic address value for `dividendToken` in NewTokenV6Params.
///      When set to this address, the dividend token is resolved to the tax token's own address
///      after it is created. This is a sugar for devs who do not want to pre-compute the tax token
///      address (it is deterministically computed from the salt).
///      Uses a well-known non-conflicting sentinel (0xfEED...fEED) to avoid conflict with:
///        - address(0): native gas token dividend (only valid when quoteToken is also native gas)
///        - any ERC-20 address: use that token as dividend (including quoteToken)
address constant MAGIC_DIVIDEND_SELF = address(0xfEEDFEEDfeEDFEedFEEdFEEDFeEdfEEdFeEdFEEd);

/// @dev Magic address value for `dividendToken` in NewTokenV6Params / FeeConfig.
///      When set to this address, VaultPortal asks the selected vault factory to compute the
///      actual dividend token from the CREATE2-predicted tax-token address before forwarding the
///      launch into Portal. Requires a v2.3+ vault factory.
///      Uses a dedicated sentinel (0xC0DE...C0DE) that does not collide with real ERC-20s,
///      address(0), or MAGIC_DIVIDEND_SELF.
address constant MAGIC_DIVIDEND_COMPUTED = address(0xC0Dec0dec0DeC0Dec0dEc0DEC0DEC0DEC0DEC0dE);

/// @title Common Types
/// @notice This interface defines common types shared across the portal
interface IPortalCommonTypes {
    /// @dev curve Types
    enum CurveType {
        CURVE_LEGACY_15, // r = 15
        CURVE_4, // r = 4
        CURVE_0_974, // r = 0.974
        CURVE_0_5, // r = 0.5
        CURVE_1000, // r = 1000
        CURVE_20000, // r = 20000
        CURVE_2500, // r = 2500
        CURVE_500, // r = 500
        CURVE_2, // r = 2
        CURVE_6, // r = 6
        CURVE_75, // r = 75
        CURVE_4M, // r= 4 M
        CURVE_28, // r = 28
        CURVE_21_25, // r = 21.25
        CURVE_RH_UNUSED, // r = 27.6, h = 352755468
        CURVE_RH_28D25_108002126, // r = 28.25, h = 108002126, k = 31301060059.5
        CURVE_RH_14981_108002125, // r = 14981, h = 108002125, k = 16598979834625
        CURVE_RH_TOSHI_MORPH_2ETH, // r = 0.7672, h = 107036751, k = 849318595.3672 - TOSHI/MORPH 2ETH curve
        CURVE_RH_TOSHI, // r = 6140351, h = 107036752, k = 6797594227179952 - TOSHI Curve
        CURVE_RH_BGB, // r = 767.5, h = 107036752, k = 849650707160 - BGB curve
        CURVE_RH_BNB, // r = 6.14, h = 107036752, k = 6797205657.28 - BNB Curve
        CURVE_RH_USD, // r = 3837, h = 107036752, k = 4247700017424 - USD curve
        CURVE_RH_MONAD, // r = 50000, h = 107036752, k = 55351837600000 - MONAD curve
        CURVE_RH_MONAD_V2, // r = 107400, h = 107036752, k = 118895747164800  - MONAD V2 curve
        CURVE_RH_KGST // r = 380000, h = 107036752, k = 420673965760000 - KGST curve
    }

    /// @dev dex threshold types
    enum DexThreshType {
        TWO_THIRDS, //  66.67% supply
        FOUR_FIFTHS, // 80% supply
        HALF, // 50% supply
        _95_PERCENT, // 95% supply
        _81_PERCENT, // 81% supply
        _1_PERCENT // 1% supply => mainly for testing
    }

    /// @notice Fee profile for tokens
    /// @dev Determines the fee structure applied to a token's trades and liquidity operations
    /// Fees are represented in basis points (bps), where 1% = 100 bps
    enum FlapFeeProfile {
        FEE_GLOBAL_DEFAULT, // Default fee profile used when no specific profile is set for a token
        FEE_FLAPSALE_V0 // Fee profile for FlapSale V0
    }

    //
    // Custom Errors for Common Types
    //

    /// @notice error if the curve type is invalid
    /// @param curveType The invalid curve type
    error InvalidCurveType(CurveType curveType);

    /// @notice error if the dex threshold type is invalid
    error InvalidDexThresholdType(DexThreshType threshold);
}

/// @title Types and Structs
/// @notice This interface defines the types and structs used in the portal
interface IPortalTypes is IPortalCommonTypes {
    //
    // public constants
    //

    //
    // Types and Structs
    //

    /// @dev Profile types for deployment-specific parameters or behaviors
    enum Profile {
        DEFAULT,
        TOSHI_MART,
        X_LAYER,
        MORPH,
        MONAD
    }

    /// @dev Token version
    /// Which token implementation is used
    enum TokenVersion {
        TOKEN_LEGACY_MINT_NO_PERMIT,
        TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE, // for historical reasons, both 0 and 1 are the same: TOKEN_LEGACY_MINT_NO_PERMIT
        TOKEN_V2_PERMIT, // 2
        TOKEN_GOPLUS, // 3
        TOKEN_TAXED, // 4: The original tax token (FlapTaxToken)
        TOKEN_TAXED_V2, // 5: The new advanced tax token (FlapTaxTokenV2)
        TOKEN_TAXED_V3, // 6: The next-generation tax token with asymmetric buy/sell rates (FlapTaxTokenV3)
        TOKEN_V3_PERMIT // 7: Non-tax token using TokenV3 implementation with permit support
    }

    /// @dev the quote token, i.e, the token as the reserve
    enum QuoteTokenType {
        NATIVE_GAS_TOKEN, // The native gas token
        ERC20_TOKEN_WITH_PERMIT, //  The ERC20 token with permit
        ERC20_TOKEN_WITHOUT_PERMIT // The ERC20 token without permit
    }

    /// @notice the status of a token
    /// The token has 5 statuses:
    //    - Tradable: The token can be traded(buy/sell)
    //    - InDuel: (obsolete) The token is in a battle, it can only be bought but not sold.
    //    - Killed: (obsolete) The token is killed, it can not be traded anymore. Can only be redeemed for another token.
    //    - DEX: The token has been added to the DEX
    //    - Staged: The token is staged but not yet created (address is predetermined)
    enum TokenStatus {
        Invalid, // The token does not exist
        Tradable,
        InDuel, // obsolete
        Killed, // obsolete
        DEX,
        Staged // The token is staged (address determined, but not yet created)
    }

    /// @notice the migrator type
    /// @dev the migrator type determines how the liquidity is added to the DEX.
    /// Note: To mitigate the risk of DOS, if a V3 migrator is used but the liquidity cannot
    /// be added to v3 pools, the migrator will fallback to a V2 migrator.
    /// A TAX token must use a V2 migrator.
    enum MigratorType {
        V3_MIGRATOR, // Migrate the liquidity to a Uniswap V3 like pool
        V2_MIGRATOR, // Migrate the liquidity to a Uniswap V2 like pool
        V4_UNI_MIGRATOR, // Migrate the liquidity to a Uniswap V4 pool (Base, XLayer)
        PCS_INFINITY_CL_MIGRATOR // Migrate the liquidity to a Pancake Infinity CL Pool (BNB)
    }

    /// @notice the V3 LP fee profile
    /// @dev determines the LP fee tier to use when migrating tokens to Uniswap V3 or Pancake V3
    enum V3LPFeeProfile {
        LP_FEE_PROFILE_STANDARD, // Standard fee tier:  0.25% on PancakeSwap, 0.3% on Uniswap
        LP_FEE_PROFILE_LOW, // Low fee tier: typically, 0.01% on PancakeSwap, 0.05% on Uniswap
        LP_FEE_PROFILE_HIGH // High fee tier (1% for exotic pairs)
    }

    /// @notice the DEX ID
    /// @dev determines the DEX we want to migrate to
    /// On BSC:
    ///   - only DEX0 will be enabled, which is PancakeSwap
    /// On xLayer:
    ///   - only DEX0 will be enabled, which is PotatoSwap
    /// On Monad:
    ///   - DEX0 is Uniswap
    ///   - DEX1 is PancakeSwap
    ///   - DEX2 is Monday
    /// Note that, currently, we only support at most 3 DEXes
    /// We may add more DEXes in the future if needed
    enum DEXId {
        DEX0,
        DEX1,
        DEX2
    }

    /// @notice the state of a token (with dex related fields)
    struct TokenStateV2 {
        TokenStatus status; // the status of the token
        uint256 reserve; // the reserve of the token
        uint256 circulatingSupply; // the circulatingSupply of the token
        uint256 price; // the price of the token
        TokenVersion tokenVersion; // the version of the token implementation this token is using
        uint256 r; // the r of the curve of the token
        uint256 dexSupplyThresh; // the cirtulating supply threshold for adding the token to the DEX
    }

    /// @notice the state of a token (with all V2 fields plus quoteTokenAddress and nativeToQuoteSwapEnabled)
    struct TokenStateV3 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
    }

    /// @notice the state of a token (with all V3 fields plus extensionID and 'r' curve parameter only)
    struct TokenStateV4 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
    }

    /// @notice the state of a token (with all V4 fields plus all curve parameters)
    struct TokenStateV5 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The curve parameter 'h' - virtual token reserve
        uint256 h;
        /// The curve parameter 'k' - square of virtual liquidity
        uint256 k;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
    }

    /// @notice the state of a token (with all V5 fields plus taxRate, pool, and progress)
    struct TokenStateV6 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The curve parameter 'h' - virtual token reserve
        uint256 h;
        /// The curve parameter 'k' - square of virtual liquidity
        uint256 k;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
        /// The tax rate in basis points (0 if not a tax token)
        uint256 taxRate;
        /// The DEX pool address (address(0) if not listed on DEX)
        address pool;
        /// The progress towards DEX listing (0 to 1e18, where 1e18 = 100%)
        uint256 progress;
    }

    /// @notice the state of a token (with all V6 fields plus lpFeeProfile)
    struct TokenStateV7 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The curve parameter 'h' - virtual token reserve
        uint256 h;
        /// The curve parameter 'k' - square of virtual liquidity
        uint256 k;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
        /// The tax rate in basis points (0 if not a tax token)
        uint256 taxRate;
        /// The DEX pool address (address(0) if not listed on DEX)
        address pool;
        /// The progress towards DEX listing (0 to 1e18, where 1e18 = 100%)
        uint256 progress;
        /// The V3 LP fee profile for the token
        V3LPFeeProfile lpFeeProfile;
        /// The Dex Id
        DEXId dexId;
    }

    struct TokenStateV8 {
        /// The status of the token (see TokenStatus enum)
        TokenStatus status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum)
        TokenVersion tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The curve parameter 'h' - virtual token reserve
        uint256 h;
        /// The curve parameter 'k' - square of virtual liquidity
        uint256 k;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
        /// The buy tax rate in basis points (0 if not a tax token)
        uint256 buyTaxRate;
        /// The sell tax rate in basis points (0 if not a tax token)
        uint256 sellTaxRate;
        /// The DEX pool address (address(0) if not listed on DEX)
        address pool;
        /// The progress towards DEX listing (0 to 1e18, where 1e18 = 100%)
        uint256 progress;
        /// The V3 LP fee profile for the token
        V3LPFeeProfile lpFeeProfile;
        /// The Dex Id
        DEXId dexId;
    }

    /// @notice A forward-compatible version of TokenStateV8, where enum-typed fields are returned
    ///         as uint8 instead of their Solidity enum types.
    /// @dev Safe because Solidity revert when decoding an enum value that exceeds the enum's
    ///      declared maximum (e.g. a new TOKEN_TAXED_V3 value read by a contract compiled against
    ///      an old TokenVersion enum). By using uint8 for TokenStatus, TokenVersion,
    ///      V3LPFeeProfile, and DEXId, callers are not affected when new variants are added to
    ///      any of those enums in the future. Use getTokenV8 if you are always up-to-date with
    ///      the latest interface; use this method if you need forward/backward compatibility.
    struct TokenStateV8Safe {
        /// The status of the token (see TokenStatus enum for interpretation)
        uint8 status;
        /// The reserve amount of the quote token held by the bonding curve
        uint256 reserve;
        /// The circulating supply of the token
        uint256 circulatingSupply;
        /// The current price of the token (in quote token units, 18 decimals)
        uint256 price;
        /// The version of the token implementation (see TokenVersion enum for interpretation)
        uint8 tokenVersion;
        /// The curve parameter 'r' used for the bonding curve
        uint256 r;
        /// The curve parameter 'h' - virtual token reserve
        uint256 h;
        /// The curve parameter 'k' - square of virtual liquidity
        uint256 k;
        /// The circulating supply threshold for adding the token to the DEX
        uint256 dexSupplyThresh;
        /// The address of the quote token (address(0) if native gas token)
        address quoteTokenAddress;
        /// Whether native-to-quote swap is enabled for this token
        bool nativeToQuoteSwapEnabled;
        /// The extension ID used by the token (bytes32(0) if no extension)
        bytes32 extensionID;
        /// The buy tax rate in basis points (0 if not a tax token)
        uint256 buyTaxRate;
        /// The sell tax rate in basis points (0 if not a tax token)
        uint256 sellTaxRate;
        /// The DEX pool address (address(0) if not listed on DEX)
        address pool;
        /// The progress towards DEX listing (0 to 1e18, where 1e18 = 100%)
        uint256 progress;
        /// The V3 LP fee profile for the token (see V3LPFeeProfile enum for interpretation)
        uint8 lpFeeProfile;
        /// The Dex Id (see DEXId enum for interpretation)
        uint8 dexId;
    }

    /// @notice Parameters for creating a new token (V2)
    struct NewTokenV2Params {
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// The tax rate in basis points (if non-zero, this is a tax token)
        uint16 taxRate;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        /// For rev share tokens, this is the address that can claim the LP fees
        /// For tax tokens, this is the address that receives the tax fees
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
    }

    /// @notice Parameters for creating a new token (V3) with extension support
    struct NewTokenV3Params {
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// The tax rate in basis points (if non-zero, this is a tax token)
        uint16 taxRate;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        /// For rev share tokens, this is the address that can claim the LP fees
        /// For tax tokens, this is the address that receives the tax fees
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
        /// @notice The ID of the extension to be used for the new token if not zero
        bytes32 extensionID;
        /// @notice Additional extension specific data to be passed to the extension's `onTokenCreation` method, check the extension's documentation for details on the expected format and content.
        bytes extensionData;
    }

    /// @notice Parameters for creating a new token (V4) with DEX ID and LP fee profile support
    struct NewTokenV4Params {
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// The tax rate in basis points (if non-zero, this is a tax token)
        uint16 taxRate;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        /// For rev share tokens, this is the address that can claim the LP fees
        /// For tax tokens, this is the address that receives the tax fees
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
        /// @notice The ID of the extension to be used for the new token if not zero
        bytes32 extensionID;
        /// @notice Additional extension specific data to be passed to the extension's `onTokenCreation` method, check the extension's documentation for details on the expected format and content.
        bytes extensionData;
        /// @notice The preferred DEX ID for the token
        DEXId dexId;
        /// @notice The preferred V3 LP fee profile for the token
        V3LPFeeProfile lpFeeProfile;
    }

    /// @notice Parameters for creating a new token (V5) with tax V2 support
    struct NewTokenV5Params {
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// The tax rate in basis points (if non-zero, this is a tax token)
        uint16 taxRate;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        /// For rev share tokens, this is the address that can claim the LP fees
        /// For tax tokens, this is the address that receives the tax fees
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
        /// @notice The ID of the extension to be used for the new token if not zero
        bytes32 extensionID;
        /// @notice Additional extension specific data to be passed to the extension's `onTokenCreation` method, check the extension's documentation for details on the expected format and content.
        bytes extensionData;
        /// @notice The preferred DEX ID for the token
        DEXId dexId;
        /// @notice The preferred V3 LP fee profile for the token
        V3LPFeeProfile lpFeeProfile;
        // New V5 tax-specific fields (only used when taxRate > 0)
        /// Tax duration in seconds (max: 100 years)
        uint64 taxDuration;
        /// Anti-farmer duration in seconds (max: 1 year)
        uint64 antiFarmerDuration;
        /// Market allocation basis points (to beneficiary)
        uint16 mktBps;
        /// Deflation basis points (burned)
        uint16 deflationBps;
        /// Dividend basis points (to dividend contract)
        uint16 dividendBps;
        /// Liquidity provision basis points (LP to dead address)
        uint16 lpBps;
        /// Minimum balance for dividend eligibility (min: 10K ether, required when dividendBps > 0)
        uint256 minimumShareBalance;
    }

    /// @dev Magic address value for `dividendToken` in NewTokenV6Params.
    ///      When set to MAGIC_DIVIDEND_SELF, the dividend token is resolved to the tax token's own address
    ///      after it is created. See MAGIC_DIVIDEND_SELF file-level constant.

    /// @notice Parameters for creating a new token (V6) with asymmetric tax and custom dividend token
    struct NewTokenV6Params {
        // --- Same base fields as V5 ---
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
        /// The ID of the extension to be used for the new token if not zero
        bytes32 extensionID;
        /// Additional extension specific data
        bytes extensionData;
        /// The preferred DEX ID for the token
        DEXId dexId;
        /// The preferred V3 LP fee profile for the token
        V3LPFeeProfile lpFeeProfile;
        // --- Tax fields (all zero = non-tax token, behaves like newTokenV5) ---
        /// Buy tax rate in basis points (0 = no buy tax)
        uint16 buyTaxRate;
        /// Sell tax rate in basis points (0 = no sell tax)
        uint16 sellTaxRate;
        /// Tax duration in seconds
        uint64 taxDuration;
        /// Anti-farmer duration in seconds
        uint64 antiFarmerDuration;
        /// Market allocation basis points (to beneficiary)
        uint16 mktBps;
        /// Deflation basis points (burned)
        uint16 deflationBps;
        /// Dividend basis points (to dividend contract)
        uint16 dividendBps;
        /// Liquidity provision basis points (LP to dead address)
        uint16 lpBps;
        /// Minimum balance for dividend eligibility (required when dividendBps > 0)
        uint256 minimumShareBalance;
        // --- New V3-only fields ---
        /// @notice Dividend distribution token:
        ///   address(0)         = native gas token dividend (only valid when quoteToken is also address(0))
        ///   MAGIC_DIVIDEND_SELF = distribute the tax token itself as dividend
        ///   MAGIC_DIVIDEND_COMPUTED = let VaultPortal ask a v2.3+ vault factory to compute the
        ///                             dividend token from the predicted tax-token address
        ///   quoteToken address  = explicitly use the quote token as dividend (must be set explicitly)
        ///   any other ERC-20   = use that specific ERC-20 as dividend token
        address dividendToken;
        /// @notice Commission receiver address (zero = disabled).
        ///         MUST be address(0) for non-tax tokens (buyTaxRate == 0 && sellTaxRate == 0).
        ///         commissionBps is NOT provided here — it is calculated internally by the launcher
        ///         based on the effective tax rate via _commissionForTax().
        address commissionReceiver;
        /// @notice The token version to create. Determines which launcher path is used.
        ///   TOKEN_V2_PERMIT  — non-tax token (standard ERC-20 with permit)
        ///   TOKEN_TAXED      — V1 tax token (symmetric rates, mktBps=10000, no commission)
        ///   TOKEN_TAXED_V2   — V2 tax token (asymmetric rates, flexible distribution, no commission, mktBps != 10000)
        ///   TOKEN_TAXED_V3   — V3 tax token (asymmetric rates, flexible distribution, commission supported)
        TokenVersion tokenVersion;
    }
    // NOTE: `converter` is NOT in this struct — it is provided as an immutable
    // in PortalBase and automatically passed to TaxProcessor at initialization.

    // ─── V7 Fee Configuration ────────────────────────────────────────────────

    enum FeeType {
        NONE,
        MARKETING_OR_VAULT,
        DIVIDEND,
        DEFLATION,
        LP_BPS
    }

    struct FeeConfig {
        FeeType feeType;
        uint16 bps;
        address marketingAddress;
        address dividendToken;
        uint256 minimumShareBalance;
    }

    struct NewTokenV7Params {
        string name;
        string symbol;
        string meta;
        DexThreshType dexThresh;
        bytes32 salt;
        MigratorType migratorType;
        address quoteToken;
        uint256 quoteAmt;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        DEXId dexId;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        address commissionReceiver;
        TokenVersion tokenVersion;
        FeeConfig[4] feeConfigs;
    }

    /// @notice Parameters for staging a new token (V5) - immutable parameters only
    struct StageNewTokenV5Params {
        /// The DEX supply threshold type
        DexThreshType dexThresh;
        /// The salt for deterministic deployment
        bytes32 salt;
        /// Whether this is a tax token
        bool isTaxToken;
        /// The migrator type (see MigratorType enum)
        MigratorType migratorType;
        /// The quote token address (native gas token if zero address)
        address quoteToken;
        /// @notice The preferred DEX ID for the token
        DEXId dexId;
    }

    /// @notice Parameters for committing a staged token (V5) - mutable/deployment-time parameters
    struct CommitNewTokenV5Params {
        /// The salt for deterministic deployment (must match staged salt)
        bytes32 salt;
        /// The tax rate in basis points (0 for non-tax tokens)
        uint16 taxRate;
        /// The name of the token
        string name;
        /// The symbol of the token
        string symbol;
        /// The metadata URI of the token
        string meta;
        /// The initial quote token amount to spend for buying
        uint256 quoteAmt;
        /// The beneficiary address for the token
        /// For rev share tokens, this is the address that can claim the LP fees
        /// For tax tokens, this is the address that receives the tax fees
        address beneficiary;
        /// The optional permit data for the quote token
        bytes permitData;
        // New V5 tax-specific fields (only used when taxRate > 0)
        /// Tax duration in seconds (max: 100 years)
        uint64 taxDuration;
        /// Anti-farmer duration in seconds (max: 1 year)
        uint64 antiFarmerDuration;
        /// Market allocation basis points (to beneficiary)
        uint16 mktBps;
        /// Deflation basis points (burned)
        uint16 deflationBps;
        /// Dividend basis points (to dividend contract)
        uint16 dividendBps;
        /// Liquidity provision basis points (LP to dead address)
        uint16 lpBps;
        /// Minimum balance for dividend eligibility (required when dividendBps > 0)
        uint256 minimumShareBalance;
    }

    /// @dev The configuration of the "native to quote" swap
    /// i.e How to swap ETH for the quote token when the quote token is not ETH
    enum NativeToQuoteSwapType {
        SWAP_DISABLED, // 0: disabled
        SWAP_VIA_V2_POOL, // 1: swap through v2 pool
        SWAP_VIA_V3_2500_POOL, // 2: swap through v3 2500 pool
        SWAP_VIA_V3_500_POOL, // 3: swap through v3 500 pool
        SWAP_VIA_V3_3000_POOL, // 4: swap through v3 3000 pool
        SWAP_VIA_V3_10000_POOL, // 5: swap through v3 10000 pool
        SWAP_VIA_MIXED_ROUTER // 6: multi-hop via PancakeSwap Infinity MixedQuoter + UniversalRouter (BSC only)
        //    used for tokens like uUSD that route BNB ↔ USDT(V3) ↔ uUSD(BinPool).
        //    The actual routing logic is bypassed in _shouldUseMixedRouter() before
        //    the enum is checked, so this value serves as a meaningful marker when
        //    calling setQuoteTokenConfiguration — any non-SWAP_DISABLED value would
        //    work, but this makes intent explicit.
    }

    /// @dev  the quote token configurations
    struct QuoteTokenConfiguration {
        uint8 enabled; // 8bit: 1 if allowed, 0 if not allowed
        CurveType defaultCurve; // 8bit: the default token curve type of the quote token
        CurveType alternativeCurve; // 8bit: the alternative token curve type of the quote token
        NativeToQuoteSwapType nativeToQuoteSwapType; // 8bit: the native to quote swap feature configuration of the quote token
        uint8 dexId; // 8bit: DEX ID for multiple DEXes support
    }

    /// @dev Enum for DEX pool types
    enum PoolType {
        V2, // Uniswap V2 style pools
        V3 // Uniswap V3 style pools
    }

    /// @dev Packed DEX pool information
    struct PackedDexPool {
        address pool; // 160 bits: pool address
        uint24 fee; // 24 bits: fee tier (for V3), 0 for V2
        PoolType poolType; // 8 bits: enum for pool type
        uint64 unused; // 64 bits: reserved for future use
    }

    /// @notice Records who locked a CREATE2 salt and for which token version.
    ///         locker + tokenVersion pack into a single 32-byte storage slot.
    struct SaltLockEntry {
        address locker; // 20 bytes — address that paid to reserve this salt
        uint8 tokenVersion; // 1 byte  — TokenVersion enum value at lock time
    }

    //
    // Events
    //

    /// @notice emitted when a token is staged (but not yet created)
    ///
    /// @param ts The timestamp of the event
    /// @param creator The address of the creator
    /// @param token The predetermined address of the token
    event FlapTokenStaged(uint256 ts, address creator, address token);

    /// @notice emitted when a new token is created
    ///
    /// @param ts The timestamp of the event
    /// @param creator The address of the creator
    /// @param nonce The nonce of the token
    /// @param token  The address of the token
    /// @param name  The name of the token
    /// @param symbol  The symbol of the token
    /// @param meta The meta URI of the token
    event TokenCreated(
        uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta
    );

    /// @notice emitted when a token is bought
    ///
    /// @param ts The timestamp of the event
    /// @param token  The address of the token
    /// @param buyer  The address of the buyer
    /// @param amount  The amount of tokens bought
    /// @param eth  The amount of ETH spent
    /// @param fee The amount of ETH spent on fee
    /// @param postPrice The price of the token after this trade
    event TokenBought(
        uint256 ts, address token, address buyer, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice
    );

    /// @notice emitted when a token is sold
    ///
    /// @param ts The timestamp of the event
    /// @param token  The address of the token
    /// @param seller  The address of the seller
    /// @param amount  The amount of tokens sold
    /// @param eth  The amount of ETH received
    /// @param fee  The amount of ETH deducted as a fee
    /// @param postPrice The price of the token after this trade
    event TokenSold(
        uint256 ts, address token, address seller, uint256 amount, uint256 eth, uint256 fee, uint256 postPrice
    );

    /// emitted when a token's curve is set
    /// @param token The address of the token
    /// @param curve The address of the curve
    /// @param curveParameter The parameter of the curve
    event TokenCurveSet(address token, address curve, uint256 curveParameter);

    /// @notice emitted when a token's curve parameters are set (V2)
    /// @param token The address of the token
    /// @param r The virtual ETH reserve parameter
    /// @param h The virtual token reserve parameter
    /// @param k The square of the virtual Liquidity parameter
    event TokenCurveSetV2(address token, uint256 r, uint256 h, uint256 k);

    /// emitted when a token's dexSupplyThresh is set
    /// @param token The address of the token
    /// @param dexSupplyThresh The new dexSupplyThresh of the token
    event TokenDexSupplyThreshSet(address token, uint256 dexSupplyThresh);

    /// emitted when a token's implementation is set
    /// @param token The address of the token
    /// @param version The version of the token
    event TokenVersionSet(address token, TokenVersion version);

    /// @notice emitted when a new vanity token is created
    /// @param token The address of the created token
    /// @param creator The address of the creator
    /// @param beneficiary The address of the beneficiary
    event VanityTokenCreated(address token, address creator, address beneficiary);

    /// @notice emitted when a token's quote token is set
    /// @param token The address of the token
    /// @param quoteToken The address of the quote token
    event TokenQuoteSet(address token, address quoteToken);

    /// @notice emitted when a token's migrator is set
    /// @param token The address of the token
    /// @param migratorType The migrator type
    event TokenMigratorSet(address token, MigratorType migratorType);

    /// @notice emitted when a token's extension is enabled
    /// @param token The address of the token
    /// @param extensionID The extension ID
    /// @param extensionAddress The address of the extension contract
    /// @param version The version of the extension
    event TokenExtensionEnabled(address token, bytes32 extensionID, address extensionAddress, uint8 version);

    /// @notice emitted when a token's pool info is updated
    /// @param token The address of the token
    /// @param poolInfo The new pool information
    event TokenPoolInfoUpdated(address token, PackedDexPool poolInfo);

    /// @notice emitted when a trader's fee exemption status is updated
    /// @param trader The address of the trader
    /// @param isExempted Whether the trader is exempted from fees
    event FeeExemptionUpdated(address indexed trader, bool isExempted);

    //
    // events
    //

    /// @notice emitted when token is redeemed
    /// @param ts The timestamp of the event
    /// @param srcToken The address of the token to redeem
    /// @param dstToken The address of the token to receive
    /// @param srcAmount The amount of srcToken to redeem
    /// @param dstAmount The amount of dstToken to receive
    /// @param who The address of the redeemer
    event TokenRedeemed(
        uint256 ts, address srcToken, address dstToken, uint256 srcAmount, uint256 dstAmount, address who
    );

    /// @notice emitted when the bit flags are changed
    /// @param oldFlags The old flags
    /// @param newFlags The new flags
    event BitFlagsChanged(uint256 oldFlags, uint256 newFlags);

    /// @notice emitted when adding liquidity to DEX
    /// @param token The address of the token
    /// @param pool The address of the pool
    /// @param amount The amount of token added
    /// @param eth The amount of quote Token added
    event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth);

    /// @notice emitted when the progress of a token changes
    /// @param token The address of the token
    /// @param newProgress The new progress value in Wad
    event FlapTokenProgressChanged(address token, uint256 newProgress);

    //
    // Token V2 supply change
    //

    /// @notice emitted when the circulating supply of a token changes
    /// @param token The address of the token
    /// @param newSupply The new circulating supply
    event FlapTokenCirculatingSupplyChanged(address token, uint256 newSupply);

    /// @notice emitted when a new tax is set for a token
    /// @dev For V3 tokens with asymmetric rates, this carries max(buyTax, sellTax) for backward compatibility.
    ///      Listen for FlapTokenAsymmetricTaxSet to get the full buy/sell split.
    /// @param token The address of the token
    /// @param tax The tax value set for the token (max of buy and sell rates for V3 tokens)
    event FlapTokenTaxSet(address token, uint256 tax);

    /// @notice Emitted when a token is launched with asymmetric buy/sell tax rates (V3 tokens only).
    /// @dev Emitted in addition to FlapTokenTaxSet (which carries max(buyTax, sellTax) for backward
    ///      compatibility). New systems that support asymmetric rates should listen to this event.
    ///      Old systems that only read FlapTokenTaxSet will continue to work correctly.
    /// @param token The address of the token
    /// @param buyTax The buy tax rate in basis points
    /// @param sellTax The sell tax rate in basis points
    event FlapTokenAsymmetricTaxSet(address token, uint256 buyTax, uint256 sellTax);

    // operation related
    // should remove later

    /// @notice emitted when a users successfully checked in
    /// @param user The address of the user
    event CheckedIn(address user);

    /// @notice emitted when a beneficiary claims fees
    /// @param token The address of the token
    /// @param beneficiary The address of the beneficiary
    /// @param tokenAmount The amount of the token claimed
    /// @param ethAmount The amount of ETH claimed
    event BeneficiaryClaimed(address token, address beneficiary, uint256 tokenAmount, uint256 ethAmount);

    /// @notice emitted when a token beneficiary is changed
    /// @param token The address of the token
    /// @param oldBeneficiary The previous beneficiary address
    /// @param newBeneficiary The new beneficiary address
    event BeneficiaryChanged(address token, address oldBeneficiary, address newBeneficiary);

    /// @notice emitted when an extension is registered
    /// @param extensionId The unique identifier for the extension
    /// @param extensionAddress The address of the extension contract
    /// @param version The version of the extension
    event ExtensionRegistered(bytes32 extensionId, address extensionAddress, uint8 version);

    /// @notice emitted when a spammer's blocked status is changed
    /// @param spammer The address of the spammer
    /// @param blocked True if blocked, false if unblocked
    event SpammerBlockedStatusChanged(address spammer, bool blocked);

    /// @notice emitted when a user is rate limited from creating tokens
    /// @param user The address of the rate-limited user
    /// @param lastCreationTime The timestamp of their last successful token creation
    event RateLimited(address user, uint256 lastCreationTime);

    /// @notice emitted when a quote token configuration is set
    /// @param quoteToken The address of the quote token
    /// @param config The configuration set for the quote token
    event QuoteTokenConfigurationSet(address quoteToken, QuoteTokenConfiguration config);

    /// @notice emitted when a V3 favored fee is set for a quote token
    /// @param quoteToken The address of the quote token
    /// @param favoredFee The favored fee set for the quote token
    event V3FavoredFeeSet(address quoteToken, uint24 favoredFee);

    /// @notice emitted when a token's DEX preference is set
    /// @param token The address of the token
    /// @param dexId The preferred DEX ID for the token
    /// @param lpFeeProfile The preferred V3 LP fee profile for the token
    event TokenDexPreferenceSet(address token, DEXId dexId, V3LPFeeProfile lpFeeProfile);

    /// @notice emitted when a message is sent
    /// @param sender The address of the sender
    /// @param token The address of the token
    /// @param message The message sent
    event MsgSent(address sender, address token, string message);

    //
    // Custom Errors
    //

    /// @notice error if the dex is both pancake and algebra1.9
    ///         which is impossible
    error DEXCannotBeBothPancakeAndAlgebra1_9();

    /// @notice error if the portal lens address is zero
    error PortalLensCannotBeZero();

    /// @notice error if the multi dex router address is zero
    error MultiDexRouterCannotBeZero();

    /// @notice error if the token does not exist
    error TokenNotFound(address token);

    /// @notice error if the amount is too small
    error AmountTooSmall(uint256 amount);

    /// @notice error if slippage is too high
    /// i.e: actualAmount < minAmount
    error SlippageTooHigh(uint256 actualAmount, uint256 minAmount);

    /// @notice error if the input token & output token of a swap is the same
    error SameToken(address tokenA);

    /// @notice error if trying to trade a killed token
    error TokenKilled(address token);

    /// @notice error if token is not tradable
    error TokenNotTradable(address token);

    /// @notice error if trying to sell a token that is in a battle
    error TokenInDuel(address token);

    /// @notice error if trying to redeem a token that is not killed
    error TokenNotKilled(address token);

    /// @notice error if the token has already been added to the DEX
    error TokenAlreadyDEXed(address token);

    /// @notice error if the token has already been staged or created
    error TokenAlreadyStaged(address token);

    /// @notice error if the token is not in staged status
    error TokenNotStaged(address token);

    /// @notice error if the token is not listed on DEX yet
    error TokenNotDEXed(address token);

    /// @notice error if there is no conversion path from srcToken to dstToken
    error NoConversionPath(address srcToken, address dstToken);

    /// @notice error if the round is not found
    error RoundNotFound(uint256 id);

    /// @notice error if the round id is invalid
    error InvalidRoundID(uint256 id);

    /// @notice error if try to start a new round but the last round is not resolved
    error LastRoundNotResolved();

    /// @notice cannot use a token for the next round of the game
    error InvalidTokenForBattle(address token);

    /// @notice error if the signature is invalid
    error InvalidSigner(address signer);

    /// @notice error if the seq is not found in Game queue
    error SeqNotFound(uint256 seq);

    /// @notice error if not implemented yet
    error NotImplemented();

    /// @notice error a token is already in the game
    error TokenAlreadyInGame(address token);

    /// @notice error if a call reverted but without any data
    error CallReverted();

    /// @notice error if creating token is disabled
    error PermissionlessCreateDisabled();

    /// @notice error if trading is disabled
    error TradeDisabled();

    /// @notice error if the circuit breakers are off
    error ProtocolDisabled();

    /// @notice error if the game supply threshold is not valid
    error InvalidGameSupplyThreshold();

    /// @notice error if the dex supply threshold is not valid
    error InvalidDEXSupplyThreshold();

    /// @notice error if the proof does not match the msg.sender
    error MismatchedAddressInProof(address expected, address actual);

    /// @notice error if the whitlist creator cannot create more tokens
    error NoQuotaForCreator(uint256 created, uint256 max);

    /// @notice error if the piggyback lenght is not valid
    error InvalidPiggybackLength(uint256 expected, uint256 actual);

    /// @notice error if the feature is disabled
    error FeatureDisabled();

    /// @notice error if caller is not authorized (e.g., only SaleForge can call)
    error OnlySaleForge();

    /// @notice error if the quote token is not allowed
    error QuoteTokenNotAllowed(address quoteToken);

    /// @notice error if a native to quote swap is required but not supported
    /// native to quote swap: i.e, swap the input token to the desired quote token
    error NativeToQuoteSwapNotSupported();

    /// @notice error if the native to quote swap v3 fee type is not supported
    /// @param NativeToQuoteSwapType The unsupported native to quote swap type
    error NativeToQuoteSwapFeeTierNotSupported(uint8 NativeToQuoteSwapType);

    /// @notice error if met any dirty bits
    error DirtyBits();

    //
    // Dex Related
    //

    /// @notice error if sqrPriceA is gte than sqrtPriceB
    error PriceAMustLTPriceB(uint160 sqrtPriceA, uint160 sqrtPriceB);

    /// @notice error if the actual amount is more than the expected amount
    error ActualAmountMustLTEAmount(uint256 actualAmount, uint256 amount1);

    /// @notice error if the msg.sender is not a Uniswap V3 pool
    error NotUniswapV3Pool(address sender);

    /// @notice error if the uniswap v2 pool's liquidity is not zero
    error UniswapV2PoolNotZero(address pool, uint256 liquidity);

    /// @notice error if the required token amount for adding Uniswap v2 liquidity is more than the remaining token
    error RequiredTokenMustLTE(uint256 requiredToken, uint256 reserveToken);

    /// @notice revert when calling slot0 of a Uniswap V3 pool failed
    error UniswapV3Slot0Failed();

    /// @notice error if a non-position NFT is received
    error NonPositionNFTReceived(address collection);

    /// @notice error if the provided dex threshold is invalid
    error InvalidDexThreshold(uint256 threshold);

    /// @notice error if the provided address is not a valid pool
    error InvalidPoolAddress(address pool, address expected);

    //
    // staking related
    //

    /// @notice error if the locks are invalid
    error InvalidLocks();

    /// @notice error if staking feature is not enabled
    error StakingDisabled();

    /// @notice error if the operator does not have the roller role
    error NotRoller();

    // operation related

    /// @notice error if the user cannot check in yet
    /// @param next The timestamp when the user can check in again
    error cannotCheckInUntil(uint256 next);

    // misc

    /// @notice error if another token has the same meta
    error MetaAlreadyUsedByOtherToken(string meta);

    /// @notice error if the creation fee is insufficient
    error InsufficientCreationFee(uint256 required, uint256 provided);

    /// @notice error if the provided ETH is insufficient to cover the required fee
    /// @param required The required fee amount
    /// @param provided The provided ETH amount
    error InsufficientFee(uint256 required, uint256 provided);

    /// @notice error if the vanity address requirement is not met
    /// @param token The generated token address
    error VanityAddressRequirementNotMet(address token);

    /// @notice error if the token is not in DEX status
    error TokenNotInDEXStatus(address token);

    /// @notice error if the caller is not the token's beneficiary
    error CallerNotBeneficiary(address caller, address expected);

    /// @notice error if no locks are available for the token
    error NoLocksAvailable(address token);

    /// @notice error if the provided ETH is insufficient to cover the required input amount
    /// @param provided The provided ETH amount
    /// @param required The required ETH amount
    error InsufficientEth(uint256 provided, uint256 required);

    /// @notice error if the provided tax bps is invalid
    /// @param tax The provided tax bps
    error InvalidTaxBps(uint256 tax);

    /// @notice error if the transferFrom call failed
    /// @param token The address of the token
    /// @param from The address from which the tokens were to be transferred
    /// @param amount The amount of tokens that were to be transferred
    error TransferFromFailed(address token, address from, uint256 amount);

    /// @notice error if the migrator type is invalid
    error InvalidMigratorType();

    /// @notice error if the quote token is not native but not using PortalTradeV2
    error QuoteTokenNotNativeButNotUsingTradeV2();

    /// @notice error if the msg.value is less than expected value when creating
    /// a tax token using an ERC20 (e.g: USDC) token as the quote token.
    /// @dev For the tax token's tax splitter to work properly, we need approximately 1gwei due to our
    /// implemenation of the tax splitter.
    error InsufficientValueForTaxTokenCreation(uint256 expected, uint256 provided);

    /// @notice error if the caller is not a guardian or admin
    /// @param caller The address of the caller
    error NotGuardian(address caller);

    /// @notice error if the extension version is not supported
    /// @param version The unsupported extension version
    error UnsupportedExtensionVersion(uint8 version);

    /// @notice error if the token uses an extension but is traded through the legacy PortalTrade contract
    /// @param token The address of the token with an extension
    error TokenWithExtensionNotSupported(address token);

    /// @notice error if the parameters for ToshiMart are invalid
    error InvalidParamsForToshiMart();

    /// @notice error if the parameters for X_LAYER are invalid
    error InvalidParamsForXLayer();

    /// @notice error if the quote token configuration is invalid
    error InvalidQuoteTokenConfiguration();

    /// @notice error when trying to use PortalTrade with tokens that have non-zero h parameter
    error ErrShouldUsePortalTradeV2();

    /// @notice error when no supported DEX is found for the token
    error NoSupportedDEX();

    /// @notice invalid fee tier for DEX
    error InvalidFeeTierForDEX();

    /// @notice error if the tax distribution percentages don't add up to 100%
    error InvalidTaxDistribution();

    /// @notice error if tax duration exceeds maximum allowed
    error TaxDurationTooLong();

    /// @notice error if tax duration is less than minimum allowed
    error TaxDurationTooShort();

    /// @notice error if anti-farmer duration exceeds maximum allowed
    error AntiFarmerDurationTooLong();

    /// @notice error if anti-farmer duration is less than minimum allowed
    error AntiFarmerDurationTooShort();

    /// @notice error if minimum share balance is too low for dividend eligibility
    error MinimumShareBalanceTooLow();

    /// @notice error when dividend parameters are missing but required
    error DividendParametersRequired();

    /// @notice error when user is rate limited from creating tokens
    /// @param user The address that is rate limited
    /// @param lastCreationTime The timestamp of the user's last successful token creation
    error RateLimitExceeded(address user, uint256 lastCreationTime);

    /// @notice error when user is permanently blocked from creating tokens
    /// @param user The address that is blocked
    error SpammerBlocked(address user);

    // --- Salt Locking ---

    /// @notice Emitted when a salt is locked by a user.
    /// @param locker       The address that paid to lock the salt.
    /// @param salt         The CREATE2 salt that was locked.
    /// @param tokenAddress The predicted token address derived from salt + tokenVersion.
    /// @param tokenVersion The TokenVersion enum value the lock applies to.
    /// @param ts           Block timestamp of the lock.
    event FlapSaltLocked(address locker, bytes32 salt, address tokenAddress, uint8 tokenVersion, uint256 ts);

    /// @notice Emitted when a locked salt is consumed by a successful launch.
    /// @param locker       The address that originally locked the salt.
    /// @param salt         The CREATE2 salt that was used.
    /// @param tokenAddress The token address that was launched.
    /// @param tokenVersion The TokenVersion enum value that was locked.
    /// @param ts           Block timestamp of the launch.
    event FlapSaltUsed(address locker, bytes32 salt, address tokenAddress, uint8 tokenVersion, uint256 ts);

    /// @notice msg.value does not equal the required SALT_LOCK_FEE.
    error SaltLockFeeMismatch(uint256 required, uint256 provided);

    /// @notice The salt is already locked by a different address.
    error SaltAlreadyLockedByAnotherUser(bytes32 salt, address existingLocker);

    /// @notice The caller tried to lock a salt they already hold the lock for.
    error SaltAlreadyLockedBySelf(bytes32 salt);

    /// @notice Launch was rejected because the salt is locked by someone other than the caller.
    error FlapSaltLockedByAnotherUser(bytes32 salt, address locker);

    /// @notice Launch was rejected because the locked tokenVersion does not match the one being launched.
    error SaltLockTokenVersionMismatch(bytes32 salt, TokenVersion locked, TokenVersion provided);

    /// @notice The tokenVersion passed to lockSalt() is not currently supported.
    error UnsupportedTokenVersion(TokenVersion provided);
}

/// @notice Callback interface implemented by VaultPortal (or any trusted caller).
///         Portal calls getSaltOwner() when msg.sender == VAULT_PORTAL to resolve the
///         effective user for salt-lock enforcement without changing any parameter structs.
interface ISaltOwnerProvider {
    /// @notice Return the address that should be treated as the salt owner for the current launch.
    /// @dev VaultPortal must set _pendingSaltOwner before delegating into Portal.
    ///      The call is a staticcall so it cannot modify state.
    function getSaltOwner() external view returns (address);
}

/// @title IPortalLauncherTwoStep
/// @notice Interface for the two-step token launch process
interface IPortalLauncherTwoStep is IPortalTypes {
    /// @notice Stage a new token (V5) without creating it yet
    /// @param params The immutable parameters for the new token
    /// @return token The predetermined address of the token
    /// @dev This stages a token by validating parameters and reserving the token address.
    ///      The token contract is not deployed yet. Call commitNewTokenV5 to actually deploy it.
    ///      Extensions are not supported in two-step launch. LP fee profile is always STANDARD.
    /// FIXME: this is not enabled in this version. Will be available once the audit for this part is ready.
    function stageNewTokenV5(StageNewTokenV5Params calldata params) external returns (address token);

    /// @notice Commit a staged token (V5) and create it
    /// @param params The parameters for token deployment (includes salt to identify staged token)
    /// @dev This deploys the token contract and initializes it. The token must have been staged first via stageNewTokenV5.
    ///      The salt and isTaxToken in params must match what was used during staging.
    ///      If taxRate > 0, creates FlapTaxTokenV2, otherwise creates regular token.
    /// FIXME: this is not enabled in this version. Will be available once the audit for this part is ready.
    function commitNewTokenV5(CommitNewTokenV5Params calldata params) external payable;
}

/// @notice Handles token creation and related operations
interface IPortalLauncher is IPortalTypes {
    /// @notice Create a new token (V2) with flexible parameters
    /// @param params The parameters for the new token
    /// @return token The address of the created
    /// @dev due to the implementation limit, when creating a tax token and using an ERC20 token as the quote token,
    /// You need to pay an extra 1gwei native gas token (i.e msg.value = 1 gwei), or you will encounter an InsufficientValueForTaxTokenCreation error
    function newTokenV2(NewTokenV2Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V3) with extension support
    /// @param params The parameters for the new token including extension configuration
    /// @return token The address of the created token
    /// @dev Similar to newTokenV2 but with extension support. Extension hooks will be called if extensionID is non-zero
    function newTokenV3(NewTokenV3Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V4) with DEX ID and LP fee profile support
    /// @param params The parameters for the new token including DEX ID and LP fee profile
    /// @return token The address of the created token
    /// @dev Similar to newTokenV3 but with DEX ID and LP fee profile support. Allows specifying preferred DEX and fee tier
    function newTokenV4(NewTokenV4Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V5) with tax V2 support
    /// @param params The parameters for the new token including advanced tax features
    /// @return token The address of the created token
    /// @dev Similar to newTokenV4 but with support for FlapTaxTokenV2 when taxRate > 0.
    ///      When taxRate is 0, behaves like newTokenV4 (uses regular token or FlapTaxToken).
    ///      When taxRate > 0, creates a FlapTaxTokenV2 with advanced tax distribution features.
    /// FIXME: this is not enabled in this version. Will be available once the audit for this part is ready.
    function newTokenV5(NewTokenV5Params calldata params) external payable returns (address token);

    /// @notice Create a new token (V6) — unified entry point for all token versions.
    /// @param params The parameters for the new token (see NewTokenV6Params).
    /// @return token The address of the created token.
    ///
    /// @dev Dispatch logic based on `params.tokenVersion`:
    ///
    ///   TOKEN_V2_PERMIT (non-tax token):
    ///     - buyTaxRate and sellTaxRate MUST both be 0.
    ///     - commissionReceiver MUST be address(0).
    ///     - Dispatched to PortalLauncherV5 → creates a standard ERC-20 (TOKEN_V2_PERMIT).
    ///
    ///   TOKEN_TAXED (V1 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - buyTaxRate MUST equal sellTaxRate (symmetric rates only).
    ///     - mktBps MUST be 10000 (all tax goes to beneficiary after protocol fee).
    ///     - dividendBps MUST be 0; deflationBps and lpBps MUST be 0.
    ///     - commissionReceiver MUST be address(0) (commission not supported).
    ///     - Dispatched to PortalLauncherV5Tax → creates a FlapTaxToken (TOKEN_TAXED).
    ///
    ///   TOKEN_TAXED_V2 (V2 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - buyTaxRate MUST equal sellTaxRate (symmetric rates only via V5 path).
    ///     - mktBps MUST NOT be 10000 (use TOKEN_TAXED for that case).
    ///     - mktBps + deflationBps + dividendBps + lpBps MUST equal 10000.
    ///     - commissionReceiver MUST be address(0) (commission not supported).
    ///     - Dispatched to PortalLauncherV5Tax → creates a FlapTaxTokenV2 (TOKEN_TAXED_V2).
    ///
    ///   TOKEN_TAXED_V3 (V3 tax token):
    ///     - At least one tax rate must be > 0.
    ///     - Asymmetric rates allowed (buyTaxRate != sellTaxRate is OK).
    ///     - mktBps + deflationBps + dividendBps + lpBps MUST equal 10000.
    ///     - mktBps == 10000 IS allowed (all tax → protocol fee + commission, no marketing).
    ///     - commissionReceiver CAN be non-zero (commission supported).
    ///     - Dispatched to PortalLauncherTaxV3.launchTaxTokenV3 → creates a FlapTaxTokenV3 (TOKEN_TAXED_V3).
    ///
    /// Emits FlapTokenTaxSet (with max rate) AND FlapTokenAsymmetricTaxSet for tax tokens.
    function newTokenV6(NewTokenV6Params calldata params) external payable returns (address token);

    /// @notice Reserve the token address derived from `salt` by paying SALT_LOCK_FEE.
    /// @dev    The caller must pass the `tokenVersion` they intend to lock for.
    ///         Accepted values include the non-tax V3-permit path (typically 0x8888 vanity)
    ///         and the tax V3 path (typically 0x7777 vanity).
    /// @param salt         CREATE2 salt to reserve.
    /// @param tokenVersion Token version to lock for.
    function lockSalt(bytes32 salt, TokenVersion tokenVersion) external payable;

    /// @notice Launch a new token with V4 / PCS Infinity migration support.
    /// @param params The V7 token parameters
    /// @return token The created token address
    function newTokenV7(NewTokenV7Params calldata params) external payable returns (address token);
}

/// @title Portal Lens Interface
/// @notice Handles read-only token state queries
interface IPortalLens is IPortalTypes {
    /// @notice Get token state
    /// @param token  The address of the token
    /// @return state  The state of the token
    function getTokenV2(address token) external view returns (TokenStateV2 memory state);
    /// @notice Get token state (V3)
    /// @param token  The address of the token
    /// @return state  The state of the token (V3)
    function getTokenV3(address token) external view returns (TokenStateV3 memory state);
    /// @notice Get token state (V4)
    /// @param token  The address of the token
    /// @return state  The state of the token (V4) with only 'r' curve parameter
    function getTokenV4(address token) external view returns (TokenStateV4 memory state);
    /// @notice Get token state (V5)
    /// @param token  The address of the token
    /// @return state  The state of the token (V5) with all curve parameters (r, h, k)
    function getTokenV5(address token) external view returns (TokenStateV5 memory state);
    /// @notice Get token state (V6)
    /// @param token  The address of the token
    /// @return state  The state of the token (V6) with all V5 fields plus taxRate, pool, and progress
    function getTokenV6(address token) external view returns (TokenStateV6 memory state);
    /// @notice Get token state (V7)
    /// @param token  The address of the token
    /// @return state  The state of the token (V7) with all V6 fields plus lpFeeProfile
    function getTokenV7(address token) external view returns (TokenStateV7 memory state);
    /// @notice Get token state (V8)
    /// @param token  The address of the token
    /// @return state  The state of the token (V8) with asymmetric buyTaxRate and sellTaxRate
    function getTokenV8(address token) external view returns (TokenStateV8 memory state);
    /// @notice Get token state (V8Safe)
    /// @dev Returns enum-typed fields (TokenStatus, TokenVersion, V3LPFeeProfile, DEXId) as uint8
    ///      instead of their Solidity enum types, preventing ABI-decoding reverts when new enum
    ///      variants are introduced. Use this method when you need forward/backward compatibility
    ///      with future contract upgrades that may add new enum values.
    /// @param token  The address of the token
    /// @return state  The state of the token with enum fields encoded as uint8
    function getTokenV8Safe(address token) external view returns (TokenStateV8Safe memory state);
    /// @notice Get the quote token configuration for a given quote token address
    /// @param quoteToken The address of the quote token
    /// @return config The configuration of the quote token
    function getQuoteTokenConfiguration(address quoteToken)
        external
        view
        returns (QuoteTokenConfiguration memory config);

    /// @notice Get the salt lock entry for a given CREATE2 salt.
    /// @param salt The CREATE2 salt to query.
    /// @return entry The SaltLockEntry (locker == address(0) means unlocked).
    function getSaltLock(bytes32 salt) external view returns (SaltLockEntry memory entry);
}

/// @title IPortalTrade Interface
/// @notice Handles token trading and redemption
interface IPortalTrade is IPortalTypes {
    /// @notice Buy token with ETH on creation
    /// @param token  The address of the token to buy
    /// @param recipient  The address to send the token to
    /// @param inputAmount The amount of ETH to spend
    ///
    /// @dev  This function is mainly for internal use (be delegated called from the portal contract)
    ///       The msg.value can be greater than inputAmount, the excess ETH will not be
    ///       refunded to the caller. They will be charged as a fee.
    ///
    ///       Note: the slippage is not checked in this function.
    ///
    function buyOnCreation(address token, address recipient, uint256 inputAmount)
        external
        payable
        returns (uint256 amount);

    /// @notice Buy token with ETH
    /// @param token  The address of the token to buy
    /// @param recipient  The address to send the token to
    /// @param minAmount  The minimum amount of tokens to buy
    function buy(address token, address recipient, uint256 minAmount) external payable returns (uint256 amount);

    /// @notice Sell token for ETH
    /// @param token  The address of the token to sell
    /// @param amount The amount of tokens to sell
    /// @param minEth The minimum amount of ETH to receive
    function sell(address token, uint256 amount, uint256 minEth) external returns (uint256 eth);

    /// @notice Redeem a killed token for another token
    /// @param srcToken The address of the token to redeem
    /// @param dstToken The address of the token to receive
    /// @param srcAmount The amount of srcToken to redeem
    /// @return dstAmount The amount of dstToken to receive
    function redeem(address srcToken, address dstToken, uint256 srcAmount) external returns (uint256 dstAmount);

    /// @notice Preview the amount of tokens to buy with ETH
    /// @param token  The address of the token to buy
    /// @param eth  The amount of ETH to spend
    /// @return amount  The amount of tokens to buy
    function previewBuy(address token, uint256 eth) external view returns (uint256 amount);

    /// @notice Preview the amount of ETH to receive for selling tokens
    /// @param token  The address of the token to sell
    /// @param amount  The amount of tokens to sell
    /// @return eth  The amount of ETH to receive
    function previewSell(address token, uint256 amount) external view returns (uint256 eth);

    /// @notice Preview redeem
    /// @param srcToken The address of the token to redeem
    /// @param dstToken The address of the token to receive
    /// @param srcAmount The amount of srcToken to redeem
    /// @return dstAmount The amount of dstToken to receive
    function previewRedeem(address srcToken, address dstToken, uint256 srcAmount)
        external
        view
        returns (uint256 dstAmount);
}

/// @title IPortalTradeV2 Interface
/// @notice Handles unified token swaps and quoting
interface IPortalTradeV2 is IPortalTypes {
    /// @notice Emitted when tax is paid on bonding curve for TAX_TOKEN
    /// @param token The address of the token
    /// @param amount The amount of tax paid
    event TaxOnBondingCurvePaid(address indexed token, uint256 amount);

    /// @notice Emitted when tax is paid on bonding curve for TAX_TOKEN_V2
    /// @param token The address of the token
    /// @param amount The amount of tax paid
    event TaxV2OnBondingCurvePaid(address indexed token, uint256 amount);

    /// @notice Parameters for swapping exact input amount for output token
    struct ExactInputParams {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
        /// @notice The minimum amount of output token to receive
        uint256 minOutputAmount;
        /// @notice Optional permit data for the input token (can be empty)
        bytes permitData;
    }

    /// @notice Parameters for swapping exact input amount for output token (V3) with extension support
    struct ExactInputV3Params {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
        /// @notice The minimum amount of output token to receive
        uint256 minOutputAmount;
        /// @notice Optional permit data for the input token (can be empty)
        bytes permitData;
        /// @notice Additional extension specific data to be passed to the extension's `onTrade` method, check the extension's documentation for details on the expected format and content
        bytes extensionData;
    }

    /// @notice Parameters for quoting the output amount for a given input
    struct QuoteExactInputParams {
        /// @notice The address of the input token (use address(0) for native asset)
        address inputToken;
        /// @notice The address of the output token (use address(0) for native asset)
        address outputToken;
        /// @notice The amount of input token to swap (in input token decimals)
        uint256 inputAmount;
    }
    /// @notice Swap exact input amount for output token
    /// @param params The swap parameters
    /// @return outputAmount The amount of output token received
    /// @dev Here are some possible scenarios:
    ///   If the token's reserve is BNB or ETH (i.e: the quote token is the native gas token):
    ///      - BUY: input token is address(0), output token is the token address
    ///      - SELL: input token is the token address, output token is address(0)
    ///   If the token's reserve is another ERC20 token (eg. USD*, i.e, the quote token is an ERC20 token):
    ///      - BUY with USD*: input token is the USD* address, output token is the token address
    ///      - SELL for USD*: input token is the token address, output token is the USD* address
    ///      - BUY with BNB or ETH: input token is address(0), output token is the token address.
    ///        (Note: this requires an internal swap to convert BNB/ETH to USD*, nativeToQuoteSwap must be anabled for this quote token)
    /// Note: Currently, this method supports trading tokens that is either still on the bonding curve or already listed on DEX.

    function swapExactInput(ExactInputParams calldata params) external payable returns (uint256 outputAmount);

    /// @notice Swap exact input amount for output token (V3) with extension support
    /// @param params The swap parameters including extension data
    /// @return outputAmount The amount of output token received
    /// @dev Similar to swapExactInput but with extension support. Extension hooks will be called if the token uses an extension
    function swapExactInputV3(ExactInputV3Params calldata params) external payable returns (uint256 outputAmount);

    /// @notice Quote the output amount for a given input
    /// @param params The quote parameters
    /// @return outputAmount The quoted output amount
    /// @dev refer to the swapExactInput method for the scenarios
    function quoteExactInput(QuoteExactInputParams calldata params) external returns (uint256 outputAmount);
}

/// @title IPortalCore Interface
/// @notice Combines IPortalLauncher and IPortalTrade
interface IPortalCore is IPortalLauncher, IPortalTrade, IPortalTradeV2 {}

/// @title IPortalMigrator Interface
/// @notice Add liquidity from the bonding curve to DEX
/// @dev this is not a public interface of the portal.
///      All the functions of this interface are either called from the portal
///      or from the UniswapV3Pool contract.
interface IPortalMigrator {
    /// @notice Add liquidity to DEX
    /// @param token The address of the token
    /// @dev This is an internal function
    ///      Any dispatch to this function should be checked in portal contract
    ///      This function may be dellegated called from a payable function.
    function luanchToDEX(address token) external payable;
}

/// @title IRoller Interface
/// @notice This acts as the glue between the portal and the flap staking contract
interface IRoller {
    /// @notice The lock the token is using
    enum LockType {
        INVALID_LOCK, // Invalid lock
        UNCX_LOCK, // The UNCX lock
        GOPLUS_UNIV3_LOCK, // The Goplus UNIv3 lock
        TOSHI_LP_LOCK, // The Toshi LP lock
        IZI_LP_LOCK // The IziSwap LP locker
    }

    /// @notice get the locks by token address
    /// @param token The address of the token
    /// @return locks The lock ids of the token
    function getLocks(address token) external view returns (uint256[] memory locks);

    /// @dev deprecated
    function rollv2(bytes calldata packedParams) external;

    /// @notice Revenue Share: Claim LP fees for a vanity token
    /// @param token The address of the token
    /// @return tokenAmount The amount of the token claimed
    /// @return ethAmount The amount of ETH claimed
    /// @dev Only the beneficiary of the token can call this function.
    function claim(address token) external returns (uint256 tokenAmount, uint256 ethAmount);

    /// @notice Allows the default admin to change the beneficiary of a token
    /// @param token The address of the token
    /// @param newBeneficiary The new beneficiary address
    function setTokenBeneficiary(address token, address newBeneficiary) external;

    /// @notice Allows a roller or default admin to claim LP fees on behalf of the beneficiary
    /// @param token The address of the token
    /// @return tokenAmount The amount of the token claimed
    /// @return quoteAmount The amount of quote token (or ETH) claimed
    /// @dev Only the roller or default admin can call this function.
    /// The claimed fee will be sent to the beneficiary of the token.
    function delegateClaim(address token) external returns (uint256 tokenAmount, uint256 quoteAmount);
}

interface IPortalDexRouter {
    // @notice Update the DEX pool information for a token
    // @dev can only be called by DEX_ROUTER_MANAGER_ROLE roles
    function updateTokenPoolInfo(address token, IPortalTypes.PackedDexPool calldata poolInfo) external;
}

/// @title IPortalTweak Interface
/// @notice Handles admin-only configuration operations for the Portal
interface IPortalTweak is IPortalTypes {
    /// @notice Parameters for updating tax token addresses
    struct TaxTokenAddressUpdate {
        /// @notice The address of the tax token to update
        address token;
        /// @notice The new beneficiary address for the tax splitter
        address beneficiary;
        /// @notice The new fee receiver address for the tax splitter
        address feeReceiver;
    }

    /// @notice Emitted when tax token addresses are updated
    /// @param token The address of the tax token
    /// @param beneficiary The new beneficiary address
    /// @param feeReceiver The new fee receiver address
    /// @dev Only Default ADMIN can change this
    event TaxTokenAddressesUpdated(address indexed token, address beneficiary, address feeReceiver);

    /// @notice Set the configuration for a quote token
    /// @dev Only callable by the default admin
    /// @param quoteToken The address of the quote token
    /// @param config The configuration struct for the quote token
    function setQuoteTokenConfiguration(address quoteToken, QuoteTokenConfiguration calldata config) external;

    /// @notice Set the fee exemption status for a list of traders
    /// @dev Only callable by the default admin
    /// @param traders The addresses of the traders to set exemption for
    /// @param isExempted Whether the traders should be exempted from fees
    function setFeeExemption(address[] memory traders, bool isExempted) external;

    /// @notice Get the current buy and sell fee rates
    /// @return buyFeeRate The current buy fee rate in basis points (e.g. 200 = 2%)
    /// @return sellFeeRate The current sell fee rate in basis points (e.g. 200 = 2%)
    function getFeeRate() external view returns (uint256 buyFeeRate, uint256 sellFeeRate);

    /// @notice Set the fee profile for a token
    /// @dev Only callable by DEFAULT_ADMIN_ROLE or TOKEN_FLAP_FEE_SETTER_ROLE
    /// @param token The address of the token
    /// @param feeProfile The fee profile to set
    function setFlapFeeProfile(address token, FlapFeeProfile feeProfile) external;

    /// @notice Update beneficiary and feeReceiver addresses for one or more tax tokens
    /// @dev Only callable by the default admin or TAX_MANAGER_ROLE
    /// @param updates Array of TaxTokenAddressUpdate structs containing token addresses and new addresses
    function updateTaxTokenAddresses(TaxTokenAddressUpdate[] calldata updates) external;

    /// @notice Register an extension for use with the portal
    /// @param extensionId The unique identifier for this extension
    /// @param extensionAddress The address of the extension contract
    /// @param version The version of the extension interface it implements (starting from 1)
    /// @dev Only callable by the default admin
    function registerExtension(bytes32 extensionId, address extensionAddress, uint8 version) external;

    /// @notice Block or unblock multiple addresses from creating tokens
    /// @param spammers The addresses to block or unblock
    /// @param blocked True to block, false to unblock
    /// @dev Only callable by the default admin or MODERATOR_ROLE
    function setSpammerBlockedBatch(address[] calldata spammers, bool blocked) external;

    /// @notice Emitted when stuck tax tokens are recovered from the tax splitter
    /// @param taxToken The address of the tax token
    /// @param amountSentToToken The amount of tokens sent back to the tax token contract
    /// @param amountReturnedToSplitter The amount of tokens returned to the tax splitter
    event StuckTaxTokenRecovered(address indexed taxToken, uint256 amountSentToToken, uint256 amountReturnedToSplitter);

    /// @notice Recover stuck tax tokens from the tax splitter and re-inject up to liquidationThreshold into the token
    /// @dev Only callable by AUDITOR_ROLE. Currently supports V1 (TOKEN_TAXED) tax tokens.
    ///      The name is intentionally generic to allow extension to V2/V3 tax tokens in the future.
    /// @param taxToken The address of the V1 tax token to recover stuck tokens for
    function recoverStuckTaxToken(address taxToken) external;
}

/// @title Portal Interface
/// @notice This interface combines the core and game interfaces
interface IPortal is
    IPortalCore,
    IAccessControlUpgradeable,
    IRoller,
    IPortalDexRouter,
    IPortalTweak,
    IPortalLens,
    IPortalLauncherTwoStep
{
    /// @notice Get the version of the portal
    /// @return The version string
    function version() external view returns (string memory);

    /// @notice Check if tax on bonding curve is enabled
    /// @return enabled True if tax on bonding curve is enabled
    function enableTaxOnBondingCurve() external view returns (bool enabled);

    /// @notice Change the protocol bit flags
    /// @dev Can only be called with DEFAULT_ADMIN_ROLE
    /// @param flags The new flags
    function setBitFlags(uint256 flags) external;

    /// @notice Can only be called by the guardian role or the default admin role
    /// @dev This function is used to pause the protocol
    function halt() external;

    /// @notice Check if an address is blocked from creating tokens
    /// @param spammer The address to check
    /// @return True if the address is blocked
    function isSpammerBlocked(address spammer) external view returns (bool);

    /// @notice Send a message for a token
    /// @param token The address of the token
    /// @param message The message to send
    function sendMsg(address token, string memory message) external;

    /// @notice Get the current nonce of the portal
    function nonce() external view returns (uint256);
}

// File: contracts/flap/IVaultFactory.sol





// Version marker passed to `resolveDividendToken(...)` when launch params are encoded as
// `IVaultPortalTypes.NewTokenV6WithVaultParams`.
uint8 constant DIVIDEND_TOKEN_LAUNCH_VERSION_V6 = 6;

// Version marker passed to `resolveDividendToken(...)` when launch params are encoded as
// `IVaultPortalTypes.NewTokenV7WithVaultParams`.
uint8 constant DIVIDEND_TOKEN_LAUNCH_VERSION_V7 = 7;

/// @title IVaultFactory
/// @notice Interface that all vault factory contracts must implement
/// @dev Each vault type must have a corresponding factory contract that implements this interface
interface IVaultFactory {
    /* ========== ERRORS ========== */

    /// @notice Thrown when caller is not the vault portal
    error OnlyVaultPortal();

    /// @notice Thrown when zero address is provided
    error ZeroAddress();

    /* ========== FUNCTIONS ========== */
    /// @notice Creates a new vault instance for a tax token
    /// @dev IMPORTANT: The taxToken does not exist yet when this method is called.
    ///      The VaultPortal predicts the token address and passes it here.
    ///      The actual token will be created AFTER the vault is created.
    /// @param taxToken The predicted address of the tax token (not yet deployed)
    /// @param quoteToken The quote token address (e.g., address(0) for native BNB)
    /// @param creator The original msg.sender to VaultPortal who initiated token creation
    /// @param vaultData Custom encoded data specific to this vault type
    /// @return vault The address of the newly created vault
    function newVault(address taxToken, address quoteToken, address creator, bytes calldata vaultData)
        external
        returns (address vault);

    /// @notice Checks if a quote token is supported by this vault factory
    /// @param quoteToken The quote token address to check
    /// @return supported True if the quote token is supported, false otherwise
    function isQuoteTokenSupported(address quoteToken) external view returns (bool supported);
}

/// @title IVaultFactoryDividendV23
/// @notice Optional factory-spec v2.3 extension for computed dividend-token resolution.
/// @dev    Only factories that explicitly opt into v2.3 need to implement this interface.
interface IVaultFactoryDividendV23 {
    /// @notice Resolve the dividend token for a predicted (not yet deployed) tax token.
    /// @dev    VaultPortal calls this only when the launcher supplied MAGIC_DIVIDEND_COMPUTED.
    /// @param predictedToken The CREATE2-predicted tax-token address.
    /// @param launchVersion The wrapper parameter version. Current callers use
    ///        `DIVIDEND_TOKEN_LAUNCH_VERSION_V6` for `NewTokenV6WithVaultParams`
    ///        and `DIVIDEND_TOKEN_LAUNCH_VERSION_V7` for `NewTokenV7WithVaultParams`.
    /// @param launchParams ABI-encoded wrapper launch params. Current callers pass
    ///        `abi.encode(NewTokenV6WithVaultParams)` or `abi.encode(NewTokenV7WithVaultParams)`.
    /// @return dividendToken The actual dividend token to forward into Portal.
    function resolveDividendToken(address predictedToken, uint8 launchVersion, bytes calldata launchParams)
        external
        view
        returns (address dividendToken);
}

/// @title IVaultFactoryValidationV2
/// @notice Optional validation extension introduced by factory spec v2.2.
/// @dev    Kept in the same file as `IVaultFactory` for discoverability, but intentionally
///         separated as its own interface because `onBeforeLaunch(...)` is not a mandatory
///         requirement for legacy vault factories.
interface IVaultFactoryValidationV2 {
    /// @notice Stable validation payload used by VaultPortal when talking to v2.2+ factories.
    /// @dev    This payload intentionally contains normalized launch semantics instead of
    ///         wrapper-specific structs such as `NewTokenV6WithVaultParams` or `NewTokenV7WithVaultParams`.
    struct LaunchValidationDataV1 {
        IPortalTypes.TokenVersion tokenVersion;
        address quoteToken;
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint16 vaultBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        address dividendToken;
        uint256 minimumShareBalance;
    }

    /// @notice Generic pre-launch validation hook.
    /// @param validationData ABI-encoded normalized launch payload.
    /// @return success True when the launch satisfies this factory's product constraints.
    /// @return reason Human-readable explanation when `success` is false.
    function onBeforeLaunch(bytes calldata validationData) external view returns (bool success, string memory reason);
}


// File: contracts/flap/IVaultPortal.sol





/// @title IVaultPortalTypes
/// @notice Type definitions for the VaultPortal contract
/// @dev Contains all structs and custom types used by VaultPortal
interface IVaultPortalTypes {
    /// @notice Risk level classification for vault audits (8 bits)
    /// @dev Used to represent the security assessment of a vault or factory
    enum RiskLevel {
        UNVERIFIED, // 0 - Not yet verified/audited
        LOW_RISK, // 1 - Low risk
        LOW_MEDIUM_RISK, // 2 - Low to medium risk
        MEDIUM_RISK, // 3 - Medium risk
        HIGH_RISK // 4 - High risk
    }

    /// @notice Category classification for vaults (8 bits)
    /// @dev Used to categorize vaults by their type or functionality
    enum VaultCategory {
        NONE, // 0 - Not in any category (default)
        TYPE_AI_ORACLE_POWERED // 1 - AI Oracle powered vaults
    }

    /// @notice Permission policy for a vault factory (8 bits)
    /// @dev Controls who is allowed to use this factory to launch tokens
    enum FactoryPermissionPolicy {
        OPEN, // 0 - Anyone can use this factory to launch tokens (default)
        TIME_DEPENDENT, // 1 - Only the designated developer may launch during an exclusive window; open to all afterwards
        DISABLED // 2 - No one can use this factory to launch tokens
    }

    /// @notice Information about a registered vault factory
    /// @dev Packed into a single storage slot for gas efficiency
    /// @param enabled Whether this factory can be used to create new vaults
    /// @param official Whether vaults created by this factory are marked as official/endorsed
    /// @param riskLevel The risk level classification from audit
    /// @param category The category classification for vaults from this factory (1 byte)
    /// @param permissionPolicy The permission policy controlling who may launch tokens via this factory (1 byte)
    /// @param reserved Reserved space for future upgrades (27 bytes)
    struct VaultFactoryInfo {
        bool enabled;
        bool official;
        RiskLevel riskLevel;
        VaultCategory category;
        FactoryPermissionPolicy permissionPolicy;
        bytes27 reserved;
    }

    /// @notice Packed vault information stored in contract storage
    /// @dev Uses three storage slots (64 bytes total)
    /// @param vault The address of the vault contract (20 bytes)
    /// @param vaultFactory The address of the vault factory that created this vault (20 bytes)
    /// @param adapter The address of the adapter contract for legacy vaults (20 bytes)
    /// @param isOfficial Whether this vault is marked as official/endorsed (1 byte)
    /// @param riskLevel The risk level classification from audit (1 byte)
    /// @param category The category classification for this vault (1 byte)
    struct VaultedTaxTokenInfo {
        // slot 0
        address vault;
        bool isOfficial;
        RiskLevel riskLevel;
        VaultCategory category;
        bytes9 reserved0;
        // slot 1
        address vaultFactory;
        bytes12 reserved1;
        // slot 2
        address adapter;
        bytes12 reserved2;
    }

    /// @notice Audit report for a tax token
    /// @param auditor The address of the auditor who submitted this report
    /// @param riskLevel The risk level classification from this audit
    /// @param ipfsCid The IPFS CID of the audit report document
    struct AuditReport {
        address auditor;
        RiskLevel riskLevel;
        string ipfsCid;
    }

    /// @notice Complete vault information returned to external callers
    /// @dev This struct is used for view functions and includes human-readable description
    /// @param vault The address of the vault contract
    /// @param vaultFactory The address of the vault factory that created this vault (zero address if unknown)
    /// @param description Human-readable description of the vault's purpose and functionality
    /// @param isOfficial Whether this vault is marked as official/endorsed by the protocol
    /// @param riskLevel The risk level classification from audit
    struct VaultInfo {
        address vault;
        address vaultFactory;
        string description;
        bool isOfficial;
        RiskLevel riskLevel;
    }

    /// @notice Parameters required to create a new tax token with an associated vault
    /// @dev All parameters are passed as a single struct to avoid stack-too-deep errors
    /// @param name The name of the tax token (e.g., "MyToken")
    /// @param symbol The symbol of the tax token (e.g., "MTK")
    /// @param meta Metadata URI or string for additional token information
    /// @param dexThresh The DEX supply threshold type
    /// @param salt A unique salt for deterministic address generation (must produce vanity suffix)
    /// @param taxRate The tax rate in basis points (e.g., 100 = 1%, max 1000 = 10%)
    /// @param migratorType The migrator type (see MigratorType enum)
    /// @param quoteToken The token used for initial liquidity (address(0) for native token)
    /// @param quoteAmt The amount of quote token to provide as initial liquidity
    /// @param permitData The optional permit data for the quote token
    /// @param extensionID The ID of the extension to be used for the new token if not zero
    /// @param extensionData Additional extension specific data
    /// @param dexId The preferred DEX ID for the token
    /// @param lpFeeProfile The preferred V3 LP fee profile for the token
    /// @param taxDuration Tax duration in seconds (max: 100 years)
    /// @param antiFarmerDuration Anti-farmer duration in seconds (max: 1 year)
    /// @param mktBps Market allocation basis points (to beneficiary)
    /// @param deflationBps Deflation basis points (burned)
    /// @param dividendBps Dividend basis points (to dividend contract)
    /// @param lpBps Liquidity provision basis points (LP to dead address)
    /// @param minimumShareBalance Minimum balance for dividend eligibility
    /// @param vaultFactory The address of the vault factory to use for creating the vault (any factory is allowed; unregistered/disabled factories result in unverified vaults)
    /// @param vaultData Encoded data specific to the vault type being created
    struct NewTaxTokenWithVaultParams {
        string name;
        string symbol;
        string meta;
        IPortalTypes.DexThreshType dexThresh;
        bytes32 salt;
        uint16 taxRate;
        IPortalTypes.MigratorType migratorType;
        address quoteToken;
        uint256 quoteAmt;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        IPortalTypes.DEXId dexId;
        IPortalTypes.V3LPFeeProfile lpFeeProfile;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        uint16 mktBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        uint256 minimumShareBalance;
        address vaultFactory;
        bytes vaultData;
    }

    /// @notice Parameters required to create a new V3 tax token with an associated vault
    /// @dev tokenVersion must be TOKEN_TAXED_V3; if it is not, the implementation reverts with FeatureDisabled
    struct NewTokenV6WithVaultParams {
        string name;
        string symbol;
        string meta;
        IPortalTypes.DexThreshType dexThresh;
        bytes32 salt;
        IPortalTypes.MigratorType migratorType;
        address quoteToken;
        uint256 quoteAmt;
        bytes permitData;
        bytes32 extensionID;
        bytes extensionData;
        IPortalTypes.DEXId dexId;
        IPortalTypes.V3LPFeeProfile lpFeeProfile;
        // V3 tax fields
        uint16 buyTaxRate;
        uint16 sellTaxRate;
        uint64 taxDuration;
        uint64 antiFarmerDuration;
        uint16 mktBps;
        uint16 deflationBps;
        uint16 dividendBps;
        uint16 lpBps;
        uint256 minimumShareBalance;
        address dividendToken;
        address commissionReceiver;
        /// The token version to use (must be TOKEN_TAXED_V3, otherwise reverts with FeatureDisabled)
        IPortalTypes.TokenVersion tokenVersion;
        // vault fields
        address vaultFactory;
        bytes vaultData;
    }

    /* ========== EVENTS ========== */

    /// @notice Emitted when a new tax token with an associated vault is successfully created
    /// @param token The address of the newly deployed tax token
    /// @param vault The address of the newly created vault that will receive tax revenue
    /// @param vaultFactory The vault factory address that was used to create the vault
    event FlapTaxVaultTokenCreated(address indexed token, address indexed vault, address indexed vaultFactory);

    /// @notice Emitted when a vault factory is registered or its configuration is updated
    /// @param factory The address of the vault factory being registered/updated
    /// @param enabled Whether the factory is enabled for creating new vaults
    /// @param official Whether vaults from this factory should be marked as official
    /// @param riskLevel The risk level classification for vaults from this factory
    event FlapTaxVaultFactoryRegistered(address factory, bool enabled, bool official, RiskLevel riskLevel);

    /// @notice Emitted when a vault factory's category is set during registration or update
    /// @param factory The address of the vault factory
    /// @param category The category classification for vaults from this factory
    event FlapTaxVaultFactoryCategorySet(address factory, VaultCategory category);

    /// @notice Emitted when a vault factory's permission policy is updated
    /// @param factory The address of the vault factory
    /// @param policy The new permission policy
    event FactoryPermissionPolicySet(address indexed factory, FactoryPermissionPolicy policy);

    /// @notice Emitted when an adapter is registered for a legacy tax token
    /// @param taxToken The address of the tax token
    /// @param adapter The address of the adapter contract
    event AdapterRegistered(address indexed taxToken, address indexed adapter);

    /// @notice Emitted when a new audit report is submitted
    /// @param taxToken The address of the tax token being audited
    /// @param auditor The address of the auditor
    /// @param riskLevel The risk level classification from this audit
    /// @param ipfsCid The IPFS CID of the audit report
    event AuditReportSubmitted(address indexed taxToken, address indexed auditor, RiskLevel riskLevel, string ipfsCid);

    /// @notice Emitted when a new audit report is submitted for a vault factory
    /// @param factory The address of the vault factory being audited
    /// @param auditor The address of the auditor
    /// @param riskLevel The risk level classification from this audit
    /// @param ipfsCid The IPFS CID of the audit report
    event FactoryAuditReportSubmitted(
        address indexed factory, address indexed auditor, RiskLevel riskLevel, string ipfsCid
    );

    /// @notice Emitted when a vault's category is updated
    /// @param taxToken The address of the tax token
    /// @param category The new category
    event VaultCategoryUpdated(address indexed taxToken, VaultCategory category);

    /// @notice Emitted when a factory's category is updated
    /// @param factory The address of the vault factory
    /// @param category The new category
    event FactoryCategoryUpdated(address indexed factory, VaultCategory category);

    /// @notice Emitted when a token's stored vault address is refreshed to match the on-chain market wallet.
    /// @param token The address of the tax token
    /// @param oldVault The previously stored vault address
    /// @param newVault The updated vault address (current on-chain market wallet)
    event TokenVaultRefreshed(address indexed token, address indexed oldVault, address indexed newVault);

    /* ========== ERRORS ========== */

    /// @notice Thrown when the provided tax rate is invalid (0 or > 1000 basis points)
    /// @param taxRate The invalid tax rate that was provided
    error InvalidTaxRate(uint256 taxRate);

    /// @notice Thrown when mktBps is invalid (must be > 0)
    error InvalidMktBps();

    /// @notice Thrown when an unsupported quote token is specified
    /// @param quoteToken The address of the unsupported quote token
    error UnsupportedQuoteToken(address quoteToken);

    /// @notice Thrown when attempting to use a vault factory that is not registered
    /// @param factory The address of the unregistered vault factory
    error VaultFactoryNotRegistered(address factory);

    /// @notice Thrown when the predicted token address does not match the required vanity suffix
    /// @param predictedAddress The predicted address that failed the vanity check
    error InvalidVanity(address predictedAddress);

    /// @notice Thrown when trying to get vault info for a token that has no associated vault
    /// @param taxToken The address of the tax token with no vault
    error VaultNotFound(address taxToken);

    /// @notice Thrown when token address does not match predicted address
    error TokenAddressMismatch();

    /// @notice Thrown when BNB transfer fails
    error BnbTransferFailed();

    /// @notice Thrown when a non-V3 tax token version is specified (only TOKEN_TAXED_V3 is allowed)
    error OnlyV3TaxTokenAllowed();

    /// @notice Thrown when a requested feature is not yet enabled
    error FeatureDisabled();

    /// @notice Thrown when portal address is zero
    error ZeroPortalAddress();

    /// @notice Thrown when token implementation address is zero
    error ZeroTokenImplAddress();

    /// @notice Thrown when trying to perform an operation on a non-existent token
    /// @param taxToken The address of the non-existent tax token
    error TokenNotFound(address taxToken);

    /// @notice error when user is rate limited from creating tokens
    /// @param user The address that is rate limited
    /// @param lastCreationTime The timestamp of the user's last successful token creation
    error RateLimitExceeded(address user, uint256 lastCreationTime);
}

/// @title IVaultPortal
/// @notice Interface for the VaultPortal contract that manages vault creation for tax tokens
/// @dev VaultPortal acts as a registry and factory orchestrator for different vault types
/// @dev It coordinates the creation of tax tokens with their associated revenue vaults
interface IVaultPortal is IVaultPortalTypes {
    /* ========== FUNCTIONS ========== */

    /// @notice Get information about a registered vault factory
    /// @param factory The address of the vault factory
    /// @return enabled Whether this factory can be used to create new vaults
    /// @return official Whether vaults created by this factory are marked as official/endorsed
    /// @return riskLevel The risk level classification for vaults from this factory
    /// @return reserved Reserved space for future upgrades (29 bytes)
    function vaultFactories(address factory)
        external
        view
        returns (bool enabled, bool official, RiskLevel riskLevel, bytes29 reserved);
    /* ========== FUNCTIONS ========== */

    /// @notice Create a new tax token with an associated vault in a single transaction
    /// @dev This function orchestrates the creation of both the vault and the tax token
    /// @dev The vault is created first using the predicted token address, then the token is created
    /// @dev Requires msg.value to match or exceed the quoteAmt for initial liquidity
    /// @dev Any vault factory can be used. If the factory is not registered or is disabled,
    ///      the vault will be treated as unofficial with UNVERIFIED risk level
    /// @param params The parameters for creating the tax token and vault
    /// @return token The address of the newly created tax token
    function newTaxTokenWithVault(NewTaxTokenWithVaultParams calldata params) external payable returns (address token);

    /// @notice Create a new tax token via Portal's newTokenV6 with an associated vault in a single transaction
    /// @dev Only TOKEN_TAXED_V3 is currently supported as tokenVersion; any other version reverts with FeatureDisabled.
    /// @param params The parameters for creating the tax token and vault (mirrors NewTokenV6Params, minus beneficiary)
    /// @return token The address of the newly created tax token
    function newTokenV6WithVault(NewTokenV6WithVaultParams calldata params) external payable returns (address token);

    /// @notice Predict the address of a tax token V1 given a salt
    /// @dev Uses CREATE2 deterministic address prediction
    /// @dev Useful for generating valid salts that produce the required vanity suffix
    /// @param salt The salt for deterministic deployment
    /// @return predictedAddress The predicted address of the tax token
    function predictTaxTokenV1Address(bytes32 salt) external view returns (address predictedAddress);

    /// @notice Get the complete vault information for a tax token
    /// @dev Reverts if no vault is found for the given tax token
    /// @dev Attempts to fetch the vault's description by calling its description() function
    /// @param taxToken The address of the tax token
    /// @return info The VaultInfo struct containing complete vault details
    function getVault(address taxToken) external view returns (VaultInfo memory info);

    /// @notice Attempt to get vault information for a tax token without reverting
    /// @dev First checks the internal mapping, then falls back to searching the Portal
    /// @dev For fallback results, isOfficial and isVerified will always be false
    /// @param taxToken The address of the tax token
    /// @return found Whether a vault was found for this tax token
    /// @return info The VaultInfo struct (empty if not found)
    function tryGetVault(address taxToken) external view returns (bool found, VaultInfo memory info);

    /// @notice Register a new vault factory or update an existing one (backward-compatible overload)
    /// @dev Only accounts with VAULT_ADMIN_ROLE can call this function
    /// @dev Allows enabling/disabling factories and updating their official/riskLevel status
    /// @dev Category defaults to VaultCategory.NONE
    /// @param factory The address of the vault factory to register/update
    /// @param enabled Whether the factory should be enabled for creating new vaults
    /// @param official Whether vaults from this factory should be marked as official
    /// @param riskLevel The risk level classification for vaults from this factory
    function registerVaultFactory(address factory, bool enabled, bool official, RiskLevel riskLevel) external;

    /// @notice Register a new vault factory or update an existing one with a specific category
    /// @dev Only accounts with VAULT_ADMIN_ROLE can call this function
    /// @dev Allows enabling/disabling factories and updating their official/riskLevel/category status
    /// @param factory The address of the vault factory to register/update
    /// @param enabled Whether the factory should be enabled for creating new vaults
    /// @param official Whether vaults from this factory should be marked as official
    /// @param riskLevel The risk level classification for vaults from this factory
    /// @param category The category classification for vaults from this factory
    function registerVaultFactory(
        address factory,
        bool enabled,
        bool official,
        RiskLevel riskLevel,
        VaultCategory category
    ) external;

    /// @notice Register an adapter for a legacy tax token vault
    /// @dev Only accounts with AUDITOR_ROLE can call this function
    /// @dev The adapter must implement the VaultBase interface for compatibility
    /// @param taxToken The address of the tax token
    /// @param adapter The address of the adapter contract
    function registerAdapter(address taxToken, address adapter) external;

    /// @notice Submit a new audit report for a tax token
    /// @dev Only accounts with AUDITOR_ROLE can call this function
    /// @dev The tax token must exist (have a vault or adapter registered)
    /// @dev This may change the risk level of the token
    /// @param taxToken The address of the tax token being audited
    /// @param riskLevel The risk level classification from this audit
    /// @param ipfsCid The IPFS CID of the audit report document
    function submitAuditReport(address taxToken, RiskLevel riskLevel, string calldata ipfsCid) external;

    /// @notice Submit a new audit report for a vault factory
    /// @dev Only accounts with VAULT_ADMIN_ROLE can call this function
    /// @dev The factory should be registered or have existing audit reports
    /// @param factory The address of the vault factory being audited
    /// @param riskLevel The risk level classification from this audit
    /// @param ipfsCid The IPFS CID of the audit report document
    function submitFactoryAuditReport(address factory, RiskLevel riskLevel, string calldata ipfsCid) external;

    /// @notice Get recent audit reports for a tax token with pagination
    /// @dev Returns reports starting from the most recent (end of array)
    /// @dev If the token has no audit reports, falls back to its factory's audit reports
    /// @param taxToken The address of the tax token
    /// @param offset The number of reports to skip from the end (0 = most recent)
    /// @param limit The maximum number of reports to return
    /// @return reports The array of audit reports
    /// @return total The total number of audit reports for this token
    function getAuditReports(address taxToken, uint256 offset, uint256 limit)
        external
        view
        returns (AuditReport[] memory reports, uint256 total);

    /// @notice Get the category of a vault
    /// @param taxToken The tax token address
    /// @return category The category of the vault
    function getVaultCategory(address taxToken) external view returns (VaultCategory category);

    /// @notice Get the category of a vault factory
    /// @param factory The vault factory address
    /// @return category The category of the factory
    function getFactoryCategory(address factory) external view returns (VaultCategory category);

    /// @notice Get the permission policy for a vault factory
    /// @param factory The vault factory address
    /// @return policy  The active FactoryPermissionPolicy enum value
    /// @return policyData  Raw 32-byte slot holding policy-specific data.
    ///         For TIME_DEPENDENT: top 64 bits = expirationTime (unix timestamp),
    ///         next 160 bits = developer address, remaining 32 bits = zero.
    /// @return description  Human-readable explanation of the current policy
    function getFactoryPolicy(address factory)
        external
        view
        returns (FactoryPermissionPolicy policy, bytes32 policyData, string memory description);

    /// @notice Set the category of a vault
    /// @dev Only accounts with VAULT_ADMIN_ROLE can call this function
    /// @param taxToken The tax token address
    /// @param category The new category
    function setVaultCategory(address taxToken, VaultCategory category) external;

    /// @notice Set the category of a vault factory
    /// @dev Only accounts with VAULT_ADMIN_ROLE can call this function
    /// @param factory The vault factory address
    /// @param category The new category
    function setFactoryCategory(address factory, VaultCategory category) external;

    /// @notice Syncs the stored vault address for `token` with the current on-chain market wallet.
    /// @dev Only callable by AUDITOR_ROLE.
    ///      If the token has no entry in taxVaults, the call is silently ignored.
    ///      If the on-chain market wallet differs from the stored vault, the stored vault is updated
    ///      and a TokenVaultRefreshed event is emitted.
    /// @param token The tax token address to refresh.
    function refreshTokenVault(address token) external;

    /// @notice Reset a factory's permission policy back to OPEN (unrestricted access).
    /// @dev Only callable by AUDITOR_ROLE.  Clears any stored policy data (expiration / developer).
    /// @param factory The vault factory address.
    function resetFactoryPolicy(address factory) external;
}

// File: contracts/flap/VaultFactoryBaseV2.sol







/// @title VaultFactoryBaseV2
/// @author The Flap Team
/// @notice Extended abstract base contract for vault factory implementations
///         that adds:
///           1. On-chain UI schema discovery via `vaultDataSchema()`
///           2. A `_getGuardian()` helper (mirrors VaultBase's pattern)
///           3. (v2.1) Policy discovery via `tokenCreationPolicies()` so the
///                    UI can surface validation hints before a transaction
///           4. (v2.2) `factorySpecVersion()` to identify the spec revision
///           5. (v2.2) `onBeforeLaunch(bytes)` for wrapper-agnostic pre-launch validation
///
/// @dev  ── MOTIVATION ───────────────────────────────────────────────────────
///
/// The protocol is designed so that anyone can introduce new vault types.
/// Any contract that implements `VaultFactoryBaseV2` can be passed to
/// VaultPortal to launch tokens — no on-chain registration is required.
/// Each factory decodes the
/// opaque `vaultData` bytes parameter in `newVault()` differently — a
/// generic UI has no way to know what fields to render without inspecting
/// each factory's source code.
///
/// Existing factories (FlapXVaultFactory, SplitVaultFactory,
/// SnowBallFactory) already have purpose-built UIs.  `VaultFactoryBaseV2`
/// exists to support **future** factories: by requiring every new factory
/// to override `vaultDataSchema()`, the UI can automatically generate a
/// creation form for any vault type — even ones that did not exist when
/// the UI was built.
///
/// `vaultDataSchema()` returns a `VaultDataSchema` struct (defined in
/// `IVaultSchemasV1.sol`) that fully describes the shape of `vaultData`.
///
///
/// ── BACKWARDS COMPATIBILITY ────────────────────────────────────────────────
///
/// `VaultFactoryBaseV2` is a new abstract contract that implements the
/// existing `IVaultFactory` interface.  Existing factory contracts that
/// directly implement `IVaultFactory` are unaffected.  New or upgraded
/// factory implementations should extend `VaultFactoryBaseV2` instead of
/// implementing `IVaultFactory` directly, to gain:
///   - `vaultDataSchema()` for UI auto-generation
///   - `_getGuardian()` for guardian address resolution
///
///
/// ── HOW TO IMPLEMENT ───────────────────────────────────────────────────────
///
/// 1. **Inherit from VaultFactoryBaseV2**.
///    All obligations from `IVaultFactory` still apply (implement `newVault()`
///    and `isQuoteTokenSupported()`).
///
/// 2. **Override `vaultDataSchema()`** to return a `VaultDataSchema`
///    describing the fields your factory expects in the `vaultData` parameter.
///
///    The schema has three components:
///      - `description` – free-form string explaining what the vault does
///        and what data is required (shown to the user in the UI).
///      - `fields`      – ordered array of `FieldDescriptor`, each describing
///        one component of the ABI-encoded tuple.
///      - `isArray`     – true if `vaultData` is an array of tuples.
///
///    The current spec supports two shapes:
///      • A single tuple    (`isArray == false`)  – e.g. `(string)`
///      • An array of tuples (`isArray == true`)  – e.g. `(address,uint16)[]`
///
///    If `fields` is empty and `isArray` is false, the factory ignores
///    `vaultData` entirely.
///
/// 3. **MANDATE: Guardian access to privileged functions**
///    If your factory (or the vaults it creates) exposes any privileged /
///    role-gated functions, the Guardian address returned by `_getGuardian()`
///    **must** also be granted the required role(s).  Furthermore, the
///    Guardian's role **must not** be revocable by any other account — only
///    the Guardian itself may renounce its own access.
///
///    When using OpenZeppelin's `AccessControl`, override `revokeRole()` to
///    enforce this invariant:
///
///      ```
///      function revokeRole(bytes32 role, address account)
///          public
///          override
///          onlyRole(getRoleAdmin(role))
///      {
///          address guardian = _getGuardian();
///          if (account == guardian) {
///              revert CannotRevokeGuardianRole();
///          }
///          super.revokeRole(role, account);
///      }
///      ```
///
///    This ensures that the Guardian always retains a backup path to call
///    permissioned functions, regardless of any admin action.
///
///
/// ── HOW THE UI USES VaultDataSchema ────────────────────────────────────────
///
///   1. UI obtains the factory address (e.g. from the token-launch event
///      or a directory service).
///   2. UI calls factory.vaultDataSchema() → gets VaultDataSchema.
///   3. For each field in schema.fields, UI renders an input widget:
///        "string"   → text input
///        "address"  → address input (with checksum validation)
///        "uint16"   → number input (0–65535)
///        "uint256"  → big-number input
///        "time"     → date/time picker input (alias for uint256;
///                      value is a Unix timestamp in seconds).
///                      When used in outputs, rendered as a
///                      human-readable time string or countdown clock
///        "bool"     → checkbox
///        "bytes"    → hex input
///        "bytes32"  → hex input (32 bytes)
///      For numeric fields, if field.decimals > 0 the UI multiplies the
///      user's input by 10^decimals before encoding.
///        e.g. decimals=18: user types "1" → encoded value is 1e18
///      If decimals == 0 the raw value is used as-is.
///   4. If schema.isArray == true, UI renders an "Add Row" button for
///      dynamic array entries.
///   5. UI encodes the user input via:
///        If isArray: abi.encode(tuple[])
///        Else:       abi.encode(tuple)
///      using the fieldType values to construct the ABI type string.
///   6. Encoded bytes are passed as `vaultData` in NewTaxTokenWithVaultParams.
///
///
/// ── EXAMPLE: Hypothetical StakingVaultFactory (single tuple) ────────────
///
///   function vaultDataSchema() public pure override returns (VaultDataSchema memory schema) {
///       schema.description = "Creates a staking vault. The creator specifies "
///           "a reward rate and lock duration at launch time.";
///       schema.fields = new FieldDescriptor[](2);
///       schema.fields[0] = FieldDescriptor(
///           "rewardRateBps",                              // name
///           "uint16",                                     // fieldType
///           "Annual reward rate in basis points",         // description
///           0                                             // decimals (raw value)
///       );
///       schema.fields[1] = FieldDescriptor(
///           "lockDuration",                               // name
///           "uint256",                                    // fieldType
///           "Lock duration in seconds",                   // description
///           0                                             // decimals
///       );
///       schema.isArray = false;
///   }
///
///
/// ── EXAMPLE: Hypothetical MultiPayeeFactory (array of tuples) ──────────
///
///   function vaultDataSchema() public pure override returns (VaultDataSchema memory schema) {
///       schema.description = "Creates a vault that distributes received BNB "
///           "among a dynamic set of payees by basis-point shares.";
///       schema.fields = new FieldDescriptor[](2);
///       schema.fields[0] = FieldDescriptor(
///           "payee",                                      // name
///           "address",                                    // fieldType
///           "Payee wallet address",                       // description
///           0                                             // decimals
///       );
///       schema.fields[1] = FieldDescriptor(
///           "bps",                                        // name
///           "uint16",                                     // fieldType
///           "Basis points share (10000 = 100%)",          // description
///           0                                             // decimals (raw value)
///       );
///       schema.isArray = true;  // vaultData = abi.encode((address,uint16)[])
///   }
///
///
/// ── EXAMPLE: Factory that ignores vaultData ────────────────────────────────
///
///   function vaultDataSchema() public pure override returns (VaultDataSchema memory schema) {
///       schema.description = "Creates a vault with no configurable parameters. "
///           "No user input is required — vaultData is ignored.";
///       schema.fields = new FieldDescriptor[](0);
///       schema.isArray = false;
///   }
///
abstract contract VaultFactoryBaseV2 is IVaultFactory, IVaultFactoryValidationV2 {
    /// @notice Error thrown when the current chain is not supported by
    ///         `_getGuardian()`.
    error UnsupportedChain(uint256 chainId);

    /// @notice Error thrown when the deprecated legacy V6 validation hook is
    ///         reached without a factory-specific override.
    error LegacyV6ValidationHookNotImplemented();

    /// @notice Returns the schema describing the `vaultData` bytes expected
    ///         by this factory's `newVault()` method.
    ///
    /// @dev Each factory implementation **must** override this to describe the
    ///      fields it expects.
    ///
    ///      The returned `VaultDataSchema` struct contains:
    ///        - `description` – what the vault does and what data is needed
    ///        - `fields`      – ordered `FieldDescriptor[]` for each tuple
    ///                          component
    ///        - `isArray`     – whether `vaultData` is a tuple array
    ///
    ///      If the factory ignores `vaultData`, return an empty schema
    ///      (fields = [], isArray = false).
    ///
    ///      See the `VaultDataSchema` and `FieldDescriptor` docs in
    ///      `IVaultSchemasV1.sol` for the full specification and UI rendering
    ///      algorithm.
    ///
    /// @return schema The vault data schema for this factory.
    function vaultDataSchema() public pure virtual returns (VaultDataSchema memory schema);

    /// @notice Deprecated legacy hook called by VaultPortal immediately before a new V6
    ///         tax token is created via `newTokenV6WithVault`.
    ///
    /// @dev    This hook is no longer allowed by default.
    ///
    ///         Any factory that still intends to use the legacy v2.1 validation surface
    ///         MUST explicitly override this function. The base implementation always
    ///         reverts with `LegacyV6ValidationHookNotImplemented()` so that new factories
    ///         do not accidentally opt into the old path.
    ///
    ///         New factories should prefer the normalized `onBeforeLaunch(bytes)` flow and
    ///         keep `factorySpecVersion()` at the default `"v2.2"`.
    ///
    ///         Override this function only when a factory intentionally stays on the legacy
    ///         V6-only validation path.
    ///
    ///         ── RETURN VALUE CONTRACT ──────────────────────────────────────────────
    ///
    ///         The caller (VaultPortal) MUST invoke this hook via a low-level call so
    ///         it can distinguish between the three possible outcomes:
    ///
    ///           1. **Hook selector missing entirely** — the low-level call reverts with
    ///              empty returndata (no selector match on the target contract).
    ///              VaultPortal may treat this as absence of legacy support.
    ///
    ///           2. **Hook implemented, validation passed** — returns `(true, "")`.
    ///              VaultPortal continues with token creation.
    ///
    ///           3. **Hook implemented, validation failed** — returns `(false, reason)`
    ///              where `reason` is a human-readable explanation.
    ///              VaultPortal MUST revert, surfacing `reason` to the caller.
    ///
    ///         Pseudo-code for the caller:
    ///
    ///           ```
    ///           (bool callOk, bytes memory ret) = factory.call(
    ///               abi.encodeCall(IVaultFactoryBaseV2.onBeforeNewTokenV6WithVault, (params))
    ///           );
    ///           if (callOk) {
    ///               (bool passed, string memory reason) = abi.decode(ret, (bool, string));
    ///               if (!passed) revert HookRejected(reason);
    ///           } else if (ret.length > 0) {
    ///               // Unexpected revert with error data — bubble it up.
    ///               assembly { revert(add(ret, 32), mload(ret)) }
    ///           }
    ///           // ret.length == 0: selector missing on target contract.
    ///           ```
    ///
    ///         Example use-cases for overrides:
    ///           - Reject unsupported quote tokens
    ///           - Enforce minimum/maximum tax rates
    ///           - Restrict allowed migrator types
    ///           - Require a specific Dividend bps
    ///
    /// @param params The full set of token creation parameters passed to
    ///               `VaultPortal.newTokenV6WithVault`.
    /// @return success True if the params pass all factory-specific constraints.
    /// @return reason  Human-readable explanation if `success` is false; empty otherwise.
    function onBeforeNewTokenV6WithVault(IVaultPortalTypes.NewTokenV6WithVaultParams calldata params)
        external
        virtual
        returns (bool, string memory)
    {
        params = params;
        revert LegacyV6ValidationHookNotImplemented();
    }

    /// @notice Optional wrapper-agnostic pre-launch validation hook introduced in spec v2.2.
    /// @dev    The default implementation decodes the normalized payload and forwards it to
    ///         `_validateBeforeLaunch(...)`. Legacy factories that must stay on the older V6
    ///         hook path should override `factorySpecVersion()` and return `"v2.1"`.
    function onBeforeLaunch(bytes calldata validationData)
        external
        view
        virtual
        override
        returns (bool success, string memory reason)
    {
        IVaultFactoryValidationV2.LaunchValidationDataV1 memory data =
            abi.decode(validationData, (IVaultFactoryValidationV2.LaunchValidationDataV1));
        return _validateBeforeLaunch(data);
    }

    /// @notice Internal validation hook for spec-v2.2+ factories.
    /// @dev    Concrete factories can override this when they want the generic `onBeforeLaunch(...)`
    ///         path. The default implementation is a no-op so older factories remain source-compatible.
    function _validateBeforeLaunch(IVaultFactoryValidationV2.LaunchValidationDataV1 memory data)
        internal
        view
        virtual
        returns (bool success, string memory reason)
    {
        data = data;
        return (true, "");
    }

    /// @notice Returns the version of the VaultFactoryBaseV2 specification that
    ///         this contract conforms to.
    ///
    /// @dev    The default return value is `"v2.2"`, meaning new factories that inherit this
    ///         base opt into the normalized `onBeforeLaunch(...)` validation generation by default.
    ///         Legacy factories that must keep the older V6 hook semantics should override this
    ///         and return `"v2.1"`.
    ///
    ///         The UI SHOULD call this via a low-level `staticcall` before
    ///         calling `tokenCreationPolicies()`.  A revert (or the absence of
    ///         this selector) indicates a pre-v2.1 factory that does not
    ///         support policy discovery.
    ///
    /// @return The spec version string, defaulting to "v2.2".
    function factorySpecVersion() public pure virtual returns (string memory) {
        return "v2.2";
    }

    /// @notice Returns the list of constraints this factory enforces on
    ///         token-creation parameters passed to `newTokenV6WithVault`.
    ///
    /// @dev    The policies returned here are **informational only** — they are
    ///         intended for UI rendering (inline validation hints, error
    ///         messages). The actual enforcement happens in whichever validation
    ///         hook the factory uses: `onBeforeLaunch(bytes)` for spec-v2.2+
    ///         factories, or `onBeforeNewTokenV6WithVault(...)` for explicitly
    ///         legacy v2.1 factories.
    ///
    ///         The default implementation returns an empty array, meaning the
    ///         factory declares no machine-readable constraints.  Factories that
    ///         override either validation hook SHOULD also override this method
    ///         to describe their constraints in policy form.
    ///
    ///         Policies are ordered from most to least important; the UI MAY
    ///         display them in this order.
    ///
    ///         See `FactoryPolicy` in `IVaultSchemasV1.sol` for the full struct
    ///         specification, supported operators, and encoding rules.
    ///
    /// @return policies  An array of FactoryPolicy structs describing the
    ///                   constraints.
    function tokenCreationPolicies() public pure virtual returns (FactoryPolicy[] memory policies) {
        return new FactoryPolicy[](0);
    }

    /// @notice Get the VaultPortal address for the current chain.
    ///
    /// @dev Returns the canonical VaultPortal proxy address for the chain
    ///      this contract is deployed on.
    ///
    ///      Currently supports:
    ///        - BNB Chain      (chain ID 56)         → 0x90497450f2a706f1951b5bdda52B4E5d16f34C06
    ///        - BNB Testnet    (chain ID 97)         → 0x027e3704fC5C16522e9393d04C60A3ac5c0d775f
    ///        - Robinhood Chain(chain ID 4663/46630) → 0xe9F7AB7DE8FB8756acbB6a1cd13316a43308197B
    ///      All other chains use the same addresses (Base, X Layer, ...)
    ///      → 0x00003877386745d059d92fa39159595BdaBF0000
    ///
    /// @return vaultPortal The VaultPortal contract address for the current chain.
    function _getVaultPortal() internal view returns (address vaultPortal) {
        uint256 chainId = block.chainid;
        if (chainId == 56) {
            // BNB Chain VaultPortal address
            return 0x90497450f2a706f1951b5bdda52B4E5d16f34C06;
        } else if (chainId == 97) {
            // BNB Testnet VaultPortal address
            return 0x027e3704fC5C16522e9393d04C60A3ac5c0d775f;
        } else if (chainId == 4663 || chainId == 46630) {
            // Robinhood Chain — VaultPortal address
            return 0xe9F7AB7DE8FB8756acbB6a1cd13316a43308197B;
        } else {
            // Base / X Layer / any other chain
            return 0x00003877386745d059d92fa39159595BdaBF0000;
        }
    }

    /// @notice Get the Guardian address for the current chain.
    ///
    /// @dev Mirrors the `_getGuardian()` helper in `VaultBase`.  The Guardian
    ///      is a privileged address that can always call permissioned functions
    ///      as a backup mechanism.
    ///
    ///      Currently supports:
    ///        - BNB Chain      (chain ID 56)         → 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b
    ///        - BNB Testnet    (chain ID 97)         → 0x76Fa8C526f8Bc27ba6958B76DeEf92a0dbE46950
    ///        - Robinhood Chain(chain ID 4663/46630) → 0x0000b48720d3B4ED6BC5031768B07F2b59270000
    ///      All other chains use the same addresses (Base, X Layer, ...)
    ///      → 0x00004d58290854c5E9880F4b5B1993c6Ad8b0000
    ///
    /// @return guardian The Guardian contract address for the current chain.
    function _getGuardian() internal view returns (address guardian) {
        uint256 chainId = block.chainid;
        if (chainId == 56) {
            // BNB Chain Guardian address
            return 0x9e27098dcD8844bcc6287a557E0b4D09C86B8a4b;
        } else if (chainId == 97) {
            // BNB Testnet Guardian address
            return 0x76Fa8C526f8Bc27ba6958B76DeEf92a0dbE46950;
        } else if (chainId == 4663 || chainId == 46630) {
            // Robinhood Chain Guardian address
            return 0x0000b48720d3B4ED6BC5031768B07F2b59270000;
        } else {
            // Base / X Layer / any other chain
            return 0x00004d58290854c5E9880F4b5B1993c6Ad8b0000;
        }
    }
}

// File: contracts/BANG.sol








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

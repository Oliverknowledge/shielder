// Generated from contracts/out via `forge inspect ShieldVault abi`. Do not edit.
export const SHIELD_VAULT_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "usdc_",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "coreDeposit_",
    "type": "address",
    "internalType": "address"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "ACTION_COLD_ABOVE_CAP",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ACTION_LOOSEN",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ACTION_TOP_UP",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ACTION_UNINSTALL",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "BPS_DENOM",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "BUCKET_LEN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "CATEGORY_FULL_EXIT",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "CATEGORY_RULE_CHANGE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "CATEGORY_TOP_UP",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "COOLDOWN_REASON_NONE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "COOLDOWN_REASON_RISK_VERDICT",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "COOLDOWN_REASON_SELF_PAUSE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DEFAULT_FULL_EXIT_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DEFAULT_LOOSEN_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "DEFAULT_TOP_UP_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "HYPERCORE_PERPS_DEX",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "KIND_COLD",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "KIND_EXECUTION",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_LOSS_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MAX_SELF_PAUSE_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MIN_FULL_EXIT_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "MIN_LOOSEN_COOLDOWN_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "NUM_VELOCITY_BUCKETS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "PROPOSAL_EXECUTION_GRACE_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ROUTE_EVM",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "ROUTE_HYPERCORE",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "VERDICT_CLOCK_SKEW_SECS",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "VERDICT_TYPEHASH",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "applyRiskVerdict",
  "inputs": [
   {
    "name": "rv",
    "type": "tuple",
    "internalType": "struct ShieldVault.RiskVerdict",
    "components": [
     {
      "name": "vault",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "nonce",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "issuedAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "reasonCode",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "realizedLossUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "evidenceHash",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   },
   {
    "name": "signature",
    "type": "bytes",
    "internalType": "bytes"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "cancelProposal",
  "inputs": [
   {
    "name": "category",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "coreDeposit",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract ICoreDepositWallet"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "deposit",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "domainSeparator",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "executeFullExit",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "executeRuleChange",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "executeTopUp",
  "inputs": [],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "getProposal",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "category",
    "type": "uint8",
    "internalType": "uint8"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct ShieldVault.Proposal",
    "components": [
     {
      "name": "exists",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "category",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "action",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "nonce",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "createdAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "executeAfter",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "configVersionAtCreation",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "destinationOwner",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "amount",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "reservedBucketIndex",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "loosen",
      "type": "tuple",
      "internalType": "struct ShieldVault.LoosenParams",
      "components": [
       {
        "name": "hasProtectedFloor",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "protectedFloor",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasTopUpThresholdBps",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "topUpThresholdBps",
        "type": "uint16",
        "internalType": "uint16"
       },
       {
        "name": "hasEmergencyCap",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "emergencyCap",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasVelocityThreshold",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "velocityThreshold",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasLossTriggerUsdc",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "lossTriggerUsdc",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasLossCooldownSecs",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "lossCooldownSecs",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasTopUpCooldownSecs",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "topUpCooldownSecs",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasLoosenCooldownSecs",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "loosenCooldownSecs",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasFullExitCooldownSecs",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "fullExitCooldownSecs",
        "type": "uint64",
        "internalType": "uint64"
       },
       {
        "name": "hasRiskVerifier",
        "type": "bool",
        "internalType": "bool"
       },
       {
        "name": "riskVerifier",
        "type": "address",
        "internalType": "address"
       },
       {
        "name": "registerOwner",
        "type": "address",
        "internalType": "address"
       },
       {
        "name": "registerKind",
        "type": "uint8",
        "internalType": "uint8"
       },
       {
        "name": "registerRoute",
        "type": "uint8",
        "internalType": "uint8"
       },
       {
        "name": "registerLabel",
        "type": "bytes24",
        "internalType": "bytes24"
       }
      ]
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getRegistryEntry",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct ShieldVault.RegistryEntry",
    "components": [
     {
      "name": "kind",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "route",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "active",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "registeredAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "label",
      "type": "bytes24",
      "internalType": "bytes24"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getRegistryOwners",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "address[]",
    "internalType": "address[]"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "getVault",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "tuple",
    "internalType": "struct ShieldVault.Vault",
    "components": [
     {
      "name": "exists",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "riskVerifier",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "protectedFloor",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "topUpThresholdBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "emergencyCap",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "velocityThreshold",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lossTriggerUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lossCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "topUpCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "loosenCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "fullExitCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "cooldownUntil",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "cooldownReason",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "cooldownSetAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lastVerdictNonce",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lastVerdictReason",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "lastVerdictEvidence",
      "type": "bytes32",
      "internalType": "bytes32"
     },
     {
      "name": "velocityBuckets",
      "type": "uint64[6]",
      "internalType": "uint64[6]"
     },
     {
      "name": "bucketStart",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "currentBucketIndex",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "configVersion",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "proposalNonceCounter",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "createdAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "balance",
      "type": "uint64",
      "internalType": "uint64"
     }
    ]
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "hashVerdict",
  "inputs": [
   {
    "name": "rv",
    "type": "tuple",
    "internalType": "struct ShieldVault.RiskVerdict",
    "components": [
     {
      "name": "vault",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "nonce",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "issuedAt",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "expiry",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "reasonCode",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "realizedLossUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "evidenceHash",
      "type": "bytes32",
      "internalType": "bytes32"
     }
    ]
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "bytes32",
    "internalType": "bytes32"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "initializeVault",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct ShieldVault.InitParams",
    "components": [
     {
      "name": "riskVerifier",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "protectedFloor",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "topUpThresholdBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "emergencyCap",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "velocityThreshold",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lossTriggerUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "lossCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "instantColdTransfer",
  "inputs": [
   {
    "name": "destinationOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "instantTopUp",
  "inputs": [
   {
    "name": "destinationOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "proposeColdTransferAboveCap",
  "inputs": [
   {
    "name": "destinationOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "proposeLoosen",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct ShieldVault.LoosenParams",
    "components": [
     {
      "name": "hasProtectedFloor",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "protectedFloor",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasTopUpThresholdBps",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "topUpThresholdBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "hasEmergencyCap",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "emergencyCap",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasVelocityThreshold",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "velocityThreshold",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLossTriggerUsdc",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "lossTriggerUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLossCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "lossCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasTopUpCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "topUpCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLoosenCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "loosenCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasFullExitCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "fullExitCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasRiskVerifier",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "riskVerifier",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "registerOwner",
      "type": "address",
      "internalType": "address"
     },
     {
      "name": "registerKind",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "registerRoute",
      "type": "uint8",
      "internalType": "uint8"
     },
     {
      "name": "registerLabel",
      "type": "bytes24",
      "internalType": "bytes24"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "proposeTopUp",
  "inputs": [
   {
    "name": "destinationOwner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "proposeUninstallVault",
  "inputs": [
   {
    "name": "destinationOwner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "registerOwner",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "kind",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "route",
    "type": "uint8",
    "internalType": "uint8"
   },
   {
    "name": "label",
    "type": "bytes24",
    "internalType": "bytes24"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "removeRegistration",
  "inputs": [
   {
    "name": "owner",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "tighten",
  "inputs": [
   {
    "name": "p",
    "type": "tuple",
    "internalType": "struct ShieldVault.TightenParams",
    "components": [
     {
      "name": "hasProtectedFloor",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "protectedFloor",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasTopUpThresholdBps",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "topUpThresholdBps",
      "type": "uint16",
      "internalType": "uint16"
     },
     {
      "name": "hasEmergencyCap",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "emergencyCap",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasVelocityThreshold",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "velocityThreshold",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLossTriggerUsdc",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "lossTriggerUsdc",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLossCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "lossCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasTopUpCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "topUpCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasLoosenCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "loosenCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasFullExitCooldownSecs",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "fullExitCooldownSecs",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasPauseTopUpsUntil",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "pauseTopUpsUntil",
      "type": "uint64",
      "internalType": "uint64"
     },
     {
      "name": "hasRiskVerifier",
      "type": "bool",
      "internalType": "bool"
     },
     {
      "name": "riskVerifier",
      "type": "address",
      "internalType": "address"
     }
    ]
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "usdc",
  "inputs": [],
  "outputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "contract IERC20"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "velocityNow",
  "inputs": [
   {
    "name": "authority",
    "type": "address",
    "internalType": "address"
   }
  ],
  "outputs": [
   {
    "name": "",
    "type": "uint64",
    "internalType": "uint64"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "event",
  "name": "ColdTransferExecuted",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "destinationOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "instant",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "Deposited",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "depositor",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "newBalance",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FullExitExecuted",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "destinationOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "FullExitProposed",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "destinationOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "executeAfter",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "uninstall",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LoosenExecuted",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "LoosenProposed",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "executeAfter",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "PolicyTightened",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "configVersion",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "cooldownUntil",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "protectedFloor",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "velocityThreshold",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "topUpThresholdBps",
    "type": "uint16",
    "indexed": false,
    "internalType": "uint16"
   },
   {
    "name": "lossTriggerUsdc",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "lossCooldownSecs",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "ProposalCancelled",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "category",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RegistrationChanged",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "owner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "kind",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "route",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "active",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "label",
    "type": "bytes24",
    "indexed": false,
    "internalType": "bytes24"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "RiskVerdictApplied",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "reasonCode",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   },
   {
    "name": "realizedLossUsdc",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "cooldownUntil",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "extended",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "evidenceHash",
    "type": "bytes32",
    "indexed": false,
    "internalType": "bytes32"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TopUpExecuted",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "destinationOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "instant",
    "type": "bool",
    "indexed": false,
    "internalType": "bool"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "velocityAfter",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "balanceAfter",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "route",
    "type": "uint8",
    "indexed": false,
    "internalType": "uint8"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "TopUpProposed",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "destinationOwner",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "nonce",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "executeAfter",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "event",
  "name": "VaultInitialized",
  "inputs": [
   {
    "name": "vault",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "authority",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "usdc",
    "type": "address",
    "indexed": false,
    "internalType": "address"
   },
   {
    "name": "protectedFloor",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   },
   {
    "name": "velocityThreshold",
    "type": "uint64",
    "indexed": false,
    "internalType": "uint64"
   }
  ],
  "anonymous": false
 },
 {
  "type": "error",
  "name": "AlreadyRegisteredDifferentType",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AmountExceedsEmergencyCap",
  "inputs": []
 },
 {
  "type": "error",
  "name": "AmountRequiresGatedTopUp",
  "inputs": []
 },
 {
  "type": "error",
  "name": "CooldownActive",
  "inputs": []
 },
 {
  "type": "error",
  "name": "DestinationNotCold",
  "inputs": []
 },
 {
  "type": "error",
  "name": "DestinationNotExecution",
  "inputs": []
 },
 {
  "type": "error",
  "name": "FullExitDestinationNotRegisteredCold",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidParameter",
  "inputs": []
 },
 {
  "type": "error",
  "name": "InvalidVerifier",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoPendingProposal",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoRiskVerifier",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NoVault",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotALoosening",
  "inputs": []
 },
 {
  "type": "error",
  "name": "NotATightening",
  "inputs": []
 },
 {
  "type": "error",
  "name": "PauseTooLong",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ProposalExpired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ProposalNotMatured",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ProposalSlotOccupied",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ProposalStale",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ProtectedFloorBreached",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Reentrancy",
  "inputs": []
 },
 {
  "type": "error",
  "name": "TransferFailed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "Unauthorized",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VaultExists",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VaultFundedUseDelayedPath",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VelocityThresholdExceeded",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VerdictBelowLossTrigger",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VerdictExpired",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VerdictNotYetValid",
  "inputs": []
 },
 {
  "type": "error",
  "name": "VerdictReplayed",
  "inputs": []
 },
 {
  "type": "error",
  "name": "ZeroAmount",
  "inputs": []
 }
] as const;

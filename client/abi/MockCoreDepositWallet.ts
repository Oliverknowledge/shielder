// Generated from contracts/out via `forge inspect MockCoreDepositWallet abi`. Do not edit.
export const MOCK_CORE_DEPOSIT_ABI = [
 {
  "type": "constructor",
  "inputs": [
   {
    "name": "usdc_",
    "type": "address",
    "internalType": "contract MockUSDC"
   }
  ],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "coreBalance",
  "inputs": [
   {
    "name": "",
    "type": "address",
    "internalType": "address"
   }
  ],
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
  "name": "depositFor",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   },
   {
    "name": "destinationDex",
    "type": "uint32",
    "internalType": "uint32"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "function",
  "name": "settleLoss",
  "inputs": [
   {
    "name": "account",
    "type": "address",
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
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
    "internalType": "contract MockUSDC"
   }
  ],
  "stateMutability": "view"
 },
 {
  "type": "function",
  "name": "withdrawToEvm",
  "inputs": [
   {
    "name": "amount",
    "type": "uint256",
    "internalType": "uint256"
   }
  ],
  "outputs": [],
  "stateMutability": "nonpayable"
 },
 {
  "type": "event",
  "name": "Deposit",
  "inputs": [
   {
    "name": "recipient",
    "type": "address",
    "indexed": true,
    "internalType": "address"
   },
   {
    "name": "amount",
    "type": "uint256",
    "indexed": false,
    "internalType": "uint256"
   },
   {
    "name": "destinationDex",
    "type": "uint32",
    "indexed": false,
    "internalType": "uint32"
   }
  ],
  "anonymous": false
 }
] as const;

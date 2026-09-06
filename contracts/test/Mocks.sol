// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Minimal 6-decimal USDC stand-in.
contract MockUSDC {
    string public constant name = "USD Coin";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; }
    function transfer(address to, uint256 amount) external returns (bool) { _move(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }
    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

/// Stand-in for Circle's CoreDepositWallet on HyperEVM: pulls USDC and
/// records the HyperCore credit for the recipient.
contract MockCoreDepositWallet {
    MockUSDC public immutable usdc;
    mapping(address => uint256) public coreBalance; // recipient -> simulated HyperCore perps balance
    event Deposit(address indexed recipient, uint256 amount, uint32 destinationDex);
    constructor(MockUSDC usdc_) { usdc = usdc_; }
    function depositFor(address recipient, uint256 amount, uint32 destinationDex) external {
        require(usdc.transferFrom(msg.sender, address(this), amount), "pull");
        coreBalance[recipient] += amount;
        emit Deposit(recipient, amount, destinationDex);
    }
}

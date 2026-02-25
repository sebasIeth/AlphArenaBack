const { Wallet } = require("ethers");

const wallet = new Wallet("0xf9dd14a90635440ac2308b9d6b3db8b803dbbee1c0a3292ade756c6d4c2348c8");

console.log(wallet.address);
Easiest way but we are not going to do gas sponsorship and we are not going to use helius!

Building Seamless Onchain UX: Native Account Funding
Creating embedded wallets behind the scenes is just the beginning. To truly deliver a seamless app experience, developers must also address account funding and cross-chain liquidity, two of the most common sources of user drop-off. 

Embedded Onramps
The best consumer apps remove friction at every step, including the moment a user needs to fund their wallet.

By embedding fiat on-ramps directly into the app experience, users can purchase SOL or USDC without ever leaving the interface.

Privy’s SDK makes it easy to integrate on-ramp providers like MoonPay and Coinbase Pay, enabling native purchases of Solana assets with just a few clicks.

Native Bridging
Another key unlock is native liquidity bridging. If a user’s Solana wallet is underfunded, developers can configure their Privy wallets to bridge balances from an EVM chain like Ethereum, Base, or Polygon. 

This turns your app into a liquidity sink, pulling assets from wherever your users already are and bringing them directly into your Solana experience. No switching apps. No copying wallet addresses. Just seamless, cross-chain value transfer.

How to Set Up Gasless Transactions with Privy and Helius
Beyond account funding and cross-chain bridging, Privy's wallets offer secure key management and are purpose-built for fee payer setups compared to traditional keypairs.

1. Create a Managed Wallet
To set up gasless transactions for your users, you will need to provision a managed wallet that acts as the “fee payer”.

This wallet will handle gas fees on behalf of your users, providing a seamless and cost-free experience for them. 

Once managed wallets are enabled in your Privy Dashboard, you can programmatically create one server-side using the Privy Node.js SDK.

Using the Privy NodeJS SDK:
Code
Copy
import { PrivyClient } from '@privy-io/server-sdk';

// Initialize the Privy client
const privy = new PrivyClient({
  apiKey: process.env.PRIVY_API_KEY
});

// Create a new Solana managed wallet
async function createFeePayerWallet() {
  const { id, address, chainType } = await privy.walletApi.create({
    chainType: 'solana',
    policyIds: ['optional_policy_id'],
    idempotencyKey: 'unique_request_identifier'
  });
  
  console.log(`Created fee payer wallet with ID: ${id}`);
  console.log(`Wallet address: ${address}`);
  
  return { id, address };
}

// Make sure to fund this wallet with SOL to cover transaction fees
The wallet ID and address will be used in subsequent steps for sponsoring transactions.

2. Implement Sponsored Transactions
Once the managed wallet has been set up and funded, you’re ready to start enabling gasless transactions for the users. 

When a user authenticates, Privy provisions an embedded wallet tied to their login credentials. Users sign transactions as usual, but instead of submitting them to the blockchain, the transaction is sent to your backend, where your managed wallet signs and submits it for them.

Note:
This guide focuses on Privy's embedded wallets. However, the sponsored transaction pattern works with any Solana wallet. A user signs the transaction, while your server covers gas fees and broadcasts the transaction to the network.

This setup unlocks a seamless user experience while keeping users in full control of their keys.

Client-Side Implementation (React with Privy SDK)
Code
Copy
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import {
  TransactionMessage,
  PublicKey,
  VersionedTransaction,
  Connection
} from '@solana/web3.js';

async function sendGaslessTransaction(instructions) {
  // Get user's embedded wallet
  const { wallets } = useSolanaWallets();
  const embeddedWallet = wallets.find(wallet => 
    wallet.walletClientType === 'privy'
  );
  
  if (!embeddedWallet) {
    throw new Error('No embedded wallet found');
  }

  // Connect to Solana via Helius for better performance
  const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY');
  const { blockhash } = await connection.getLatestBlockhash();
  
  // Set your managed wallet as fee payer
  const feePayerAddress = 'YOUR_PRIVY_SERVER_WALLET_ADDRESS';

  // Build transaction with managed wallet as payer
  const message = new TransactionMessage({
    payerKey: new PublicKey(feePayerAddress),
    recentBlockhash: blockhash,
    instructions
  }).compileToV0Message();

  const transaction = new VersionedTransaction(message);
  
  // Have user sign the transaction
  const provider = await embeddedWallet.getProvider();
  const serializedMessage = Buffer.from(
    transaction.message.serialize()
  ).toString('base64');
  
  const { signature } = await provider.request({
    method: 'signMessage',
    params: { message: serializedMessage }
  });
  
  // Add user signature
  const userSignature = Buffer.from(signature, 'base64');
  transaction.addSignature(
    new PublicKey(embeddedWallet.address), 
    userSignature
  );
  
  // Send to your backend for fee payer signature
  const serializedTx = Buffer.from(
    transaction.serialize()
  ).toString('base64');
  
  const response = await fetch('/api/sponsor-transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: serializedTx })
  });
  
  const { transactionHash } = await response.json();
  return transactionHash;
}
Finally, the partially signed transaction is sent from the client to your backend, where it’s verified, signed by the managed wallet, and broadcast to the Solana network.

Backend Implementation (Next.js API Route)
Code
Copy
// pages/api/sponsor-transaction.js
import { VersionedTransaction } from '@solana/web3.js';
import { PrivyClient } from '@privy-io/server-sdk';

// Initialize Privy SDK
const privy = new PrivyClient({
  apiKey: process.env.PRIVY_API_KEY
});
// For App Router (Next.js 13+)
export async function POST(request) {
  try {
    const { transaction: serializedTx } = await request.json();
    
    // Deserialize the transaction to verify it (optional)
    const txBuffer = Buffer.from(serializedTx, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);
    
    // Verify the transaction (check fee payer, validate against policies)
    // ...verification logic here...
    
    // Sign AND send with your Privy managed wallet in one step
    const serverWalletId = process.env.PRIVY_SERVER_WALLET_ID;
    const { hash } = await privy.walletApi.solana.signAndSendTransaction({
      walletId: serverWalletId,
      caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', // Mainnet
      transaction: serializedTx,
      rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_API_KEY',
      options: {
        maxRetries: 5,
        skipPreflight: true
      }
    });
    
    return Response.json({
      transactionHash: hash,
      message: 'Transaction sent successfully'
    }, { status: 200 });
  } catch (error) {
    console.error('Error processing transaction:', error);
    return Response.json({
      error: 'Failed to process transaction',
      details: error.message
    }, { status: 500 });
  }
}
By combining Privy's secure wallets with Helius's optimized transaction infrastructure, you can deliver a seamless, gasless experience for your users, without compromising on reliability or flexibility.

---

## Documentation Index
Fetch the complete documentation index at: https://docs.privy.io/llms.txt
Use this file to discover all available pages before exploring further.

# UI components

> Pre-built UI components for wallet funding, sending, and receiving in React applications

## React

Privy comes with out-of-the-box UIs for signing messages and sending transactions.

These wallet UIs are highly-customizable, allowing your application to communicate relevant context to the user or abstract away the fact that a wallet is being used under the hood.

### Sign message

Below is a sample message signature UI.

![Sign message UI](https://mintcdn.com/privy-c2af3412/YvGXGsI-T4KAqoan/images/Sign.png?fit=max&auto=format&n=YvGXGsI-T4KAqoan&q=85&s=d53afa26ed87352a61dbf1477c651442)

This UI can also be customized by passing a `uiOptions` object of the following type to the method.

#### Parameters

- `showWalletUIs` (boolean): Whether to overwrite the configured wallet UI for the signature prompt. Defaults to `undefined`, which will respect the server-side or SDK configured option.
- `title` (string): The title text for the signature prompt. Defaults to 'Sign message'.
- `description` (string): The description text for the signature prompt. Defaults to 'Signing this message will not cost you any fees.'.
- `buttonText` (string): The description text for the signature prompt. Defaults to 'Sign and continue'.

### Send transaction

Below is a sample transaction UI.

![Send transaction UI](https://mintcdn.com/privy-c2af3412/YvGXGsI-T4KAqoan/images/Trans.png?fit=max&auto=format&n=YvGXGsI-T4KAqoan&q=85&s=e8c2eaf51c49ab7d5bd0bb300a6153f2)

This UI can also be customized by passing a `uiOptions` object of the following type to the method.

#### Parameters

- `showWalletUIs` (boolean): Whether or not to show wallet UIs for this action. Defaults to the wallet UI setting enabled for your app.
- `description` (string): Description of the transaction being sent.
- `buttonText` (string): Text to show on CTA button for Send Transaction screen. Defaults to 'Submit' or 'Approve'.
- `transactionInfo` (Object):
  - `title` (string): Title for transaction details accordion.
  - `action` (string): Short action description (e.g., 'Buy NFT').
  - `contractInfo` (Object):
    - `url` (string): Smart contract information URL.
    - `name` (string): Smart contract name.
    - `imgUrl` (string): Contract image URL.
    - `imgAltText` (string): Alternative text for contract image.
    - `imgSize` ('sm' | 'lg'): Image size for contract ('sm' or 'lg').
- `successHeader` (string): Text displayed at the top of the success screen. Defaults to 'Transaction complete!'.
- `successDescription` (string): Description for the success screen. Defaults to 'You're all set.'.
- `isCancellable` (boolean): Whether to display a cancel button on the confirmation screen.

## React Native

When building an application using the React Native SDK, Privy gives you complete control over the experience and UI.

If you do wish to use Privy's default UIs for message signing or login, make sure you have [properly configured `PrivyElements`](https://docs.privy.io/basics/react-native/advanced/setup-privyelements), and use the hooks exported from `@privy-io/expo/ui`, such as `useLogin`, `useSignMessage`, or `useFundWallet`.

> Note: The React Native SDK does not yet support default UIs for signing typed data or sending transactions. Consumers of the SDK typically attach their own UIs to the Privy SDK methods for signing messages and sending transactions.

| Use case                | Hook                                 |
| ----------------------- | ------------------------------------ |
| Login users             | `useLogin`                           |
| Sign message (Ethereum) | `useSignMessage`                     |
| Sign message (Solana)   | `useSolanaSignMessage`               |
| Fund wallets (Ethereum) | `useFundWallet`                      |
| Fund wallets (Solana)   | `useFundSolanaWallet`                |
| Enroll in MFA           | `useMfaEnrollmentUI`                 |
| Verify MFA              | Set `enableMfaVerificationUIs: true` |

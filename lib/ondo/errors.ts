// Ondo's authentication failures, in language a user can act on.
//
// The repo rule is to surface the upstream message, and auth is the exception,
// for the same reason lib/ondo/withdraw.ts makes one: these codes are the
// difference between "the app is broken", "your wallet is wrong", "you waited
// too long", and "Ondo will not serve you at all", and the raw string
// distinguishes none of them. Before this existed a blocked sign-in rendered as
//
//   Ondo Perps /v1/auth/erc-4361/login/get_challenge: forbidden_country
//
// which tells a user nothing about whether their money is safe or what to do.
//
// **Ondo's published enums are incomplete and this is the second place it has
// bitten.** `forbidden_country` appears nowhere in their OpenAPI spec, exactly
// like `withdrawal_exceeds_chain_deposits`. So the mapping below is open, never
// closed: an unrecognised code always falls through to the upstream text rather
// than being swallowed by a generic message.

export type OndoAuthFailure =
  // Ondo will not serve this account or this network at all. Distinct from the
  // rest because retrying cannot fix it and the UI should stop offering.
  | "unavailable"
  // Something expired or was signed too late. A fresh attempt fixes it.
  | "retry"
  // The session is gone or was never valid. Sign in again.
  | "signed-out"
  // Ondo's side is having a problem. Not the user's fault, worth retrying.
  | "upstream";

export interface OndoAuthError {
  message: string;
  failure: OndoAuthFailure;
  // What to answer the browser with. A refusal is not a 502: Ondo answered
  // correctly and said no, and reporting that as a bad gateway tells the client
  // our server broke when it did not.
  status: number;
  code: string | undefined;
}

export function describeOndoAuthError(
  code: string | undefined,
  fallback: string,
): OndoAuthError {
  switch (code) {
    // Undocumented, and the only one in this list that is terminal. Observed
    // returning for every address, new or already registered, from one IP, so
    // it is not per-account. Unauthenticated reads keep working, which is why
    // the message says what still functions instead of implying a total outage.
    case "forbidden_country":
      return {
        message:
          "Ondo Perps is not available from this location. Market data and prices still load, but signing in, trading and withdrawals are blocked. Nothing on Ondo is affected by this: any collateral and positions you hold are untouched and remain visible from a permitted location.",
        failure: "unavailable",
        status: 403,
        code,
      };

    // The five-minute challenge expiry. Overwhelmingly the most likely reason a
    // real sign-in fails, because it is what happens when someone leaves the
    // wallet prompt open. Retrying the signature does not work; the flow has to
    // start over, and the message has to say so or the user will try again with
    // the same dead challenge.
    case "challenge_not_found":
      return {
        message:
          "The sign-in request expired before it was signed. Ondo's challenges last five minutes. Start again and approve the signature when your wallet prompts.",
        failure: "retry",
        status: 409,
        code,
      };

    case "account_cannot_be_verified":
      return {
        message:
          "Ondo could not verify that signature against the wallet that requested it. Check you approved the prompt with the same wallet you are signed in to Aeras with, then try again.",
        failure: "retry",
        status: 409,
        code,
      };

    case "invite_code_invalid":
    case "invite_code_already_used":
      return {
        message:
          "Ondo rejected the invite code on this request. Aeras does not send one, so this is unexpected: report it rather than retrying.",
        failure: "unavailable",
        status: 409,
        code,
      };

    case "auth_expired":
      return {
        message: "Your Ondo session expired. Sign in to Ondo again to continue.",
        failure: "signed-out",
        status: 401,
        code,
      };

    case "auth_invalid":
    case "auth_missing":
      return {
        message: "Your Ondo session is no longer valid. Sign in to Ondo again.",
        failure: "signed-out",
        status: 401,
        code,
      };

    case "account_not_found":
      return {
        message:
          "Ondo has no account for this wallet yet. Signing in creates one, so try the sign-in again.",
        failure: "retry",
        status: 409,
        code,
      };

    case "trading_disabled":
    case "feature_disabled":
      return {
        message:
          "Ondo has this feature disabled on your account. Your funds are unaffected. Contact Ondo support to find out why.",
        failure: "unavailable",
        status: 409,
        code,
      };

    default:
      return {
        // Not swallowed. An unknown code keeps the upstream text, because
        // Ondo's enums have already proved incomplete twice and a generic
        // message would hide the one clue worth having.
        message: fallback,
        failure: "upstream",
        status: 502,
        code,
      };
  }
}

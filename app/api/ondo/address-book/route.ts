import { NextResponse } from "next/server";

import {
  ondoAddressBook,
  ondoAddressBookComplete,
  ondoRemoveAddressBookEntry,
} from "@/lib/ondo/server";
import { OndoSessionMissing, requireOndoSession } from "@/lib/ondo/session";

export const dynamic = "force-dynamic";

// The registered payout addresses on the account.
//
// Worth reading even when this app only ever registers one address: an account
// used through Ondo's own frontend can carry others, and a withdrawal
// destination the user did not expect is exactly the kind of thing a surface
// like this should show rather than hide.
export async function GET() {
  const session = await session_();
  if (session instanceof NextResponse) return session;

  try {
    const book = await ondoAddressBook(session.token);
    return NextResponse.json({
      addressBook: book.addressBook ?? [],
      ownAddress: session.address,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

// Step 2 of registration: hand Ondo the signature over the challenge issued by
// app/api/ondo/address-book/challenge.
//
// The address is not in this body either. It was fixed when the challenge was
// minted, and Ondo verifies the signature against the message it issued, so
// there is nothing here for a caller to redirect.
export async function POST(request: Request) {
  const session = await session_();
  if (session instanceof NextResponse) return session;

  let payload: { id?: unknown; signature?: unknown; label?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { id, signature, label } = payload;
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "signature is required" }, { status: 400 });
  }

  try {
    await ondoAddressBookComplete(session.token, {
      id,
      signature,
      addressLabel: typeof label === "string" && label.length > 0 ? label : "Aeras wallet",
    });

    // Read the book back rather than reporting success from a 200. Registration
    // is the precondition for every withdrawal, so "Ondo accepted the
    // signature" is not the fact the caller needs; "the address is in the book"
    // is.
    const book = await ondoAddressBook(session.token);
    const registered = (book.addressBook ?? []).some(
      (entry) =>
        entry.withdrawalAddress.toLowerCase() === session.address.toLowerCase(),
    );

    return NextResponse.json({
      registered,
      addressBook: book.addressBook ?? [],
      ownAddress: session.address,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

// Removing an entry. Unlike adding one this needs no signature, which is the
// right asymmetry: removing a payout address can only narrow where money can
// go.
export async function DELETE(request: Request) {
  const session = await session_();
  if (session instanceof NextResponse) return session;

  let payload: { withdrawalAddress?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { withdrawalAddress } = payload;
  if (typeof withdrawalAddress !== "string" || withdrawalAddress.length === 0) {
    return NextResponse.json({ error: "withdrawalAddress is required" }, { status: 400 });
  }

  try {
    await ondoRemoveAddressBookEntry(session.token, withdrawalAddress);
    const book = await ondoAddressBook(session.token);
    return NextResponse.json({
      addressBook: book.addressBook ?? [],
      ownAddress: session.address,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}

async function session_() {
  try {
    return await requireOndoSession();
  } catch (err) {
    if (err instanceof OndoSessionMissing) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}

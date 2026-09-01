import { NextResponse } from "next/server";
import { findUserByEmail, createUser, hashPassword } from "@/backend/auth";
import { db } from "@/backend/db";
import { oauthAccounts, users, organizations, organizationMembers, sessions } from "@/backend/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "@/backend/auth/nanoid";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!code) {
    return NextResponse.redirect(`${appUrl}/auth/login?error=missing_code`);
  }

  try {
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error("[auth/google/callback] Token exchange failed:", tokens.error);
      return NextResponse.redirect(`${appUrl}/auth/login?error=token_exchange_failed`);
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userRes.json();
    if (!googleUser.email) {
      return NextResponse.redirect(`${appUrl}/auth/login?error=no_email`);
    }

    let user = await findUserByEmail(googleUser.email);

    if (!user) {
      const userId = nanoid();
      await db.insert(users).values({
        id: userId,
        email: googleUser.email,
        name: googleUser.name || googleUser.email.split("@")[0],
        avatarUrl: googleUser.picture,
        emailVerifiedAt: new Date(),
      });

      await db.insert(oauthAccounts).values({
        id: nanoid(),
        userId,
        provider: "google",
        providerAccountId: googleUser.id,
        email: googleUser.email,
      });

      const orgId = nanoid();
      const slug = googleUser.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-");

      await db.insert(organizations).values({
        id: orgId,
        name: googleUser.name || googleUser.email.split("@")[0],
        slug,
      });

      await db.insert(organizationMembers).values({
        id: nanoid(),
        organizationId: orgId,
        userId,
        role: "owner",
      });

      user = { id: userId, email: googleUser.email, name: googleUser.name, passwordHash: null, avatarUrl: googleUser.picture, emailVerifiedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    } else {
      const existingAccount = await db.query.oauthAccounts.findFirst({
        where: eq(oauthAccounts.provider, "google"),
      });

      if (!existingAccount) {
        await db.insert(oauthAccounts).values({
          id: nanoid(),
          userId: user.id,
          provider: "google",
          providerAccountId: googleUser.id,
          email: googleUser.email,
        });
      }
    }

    // Create session directly and set cookie on the response
    const sessionId = nanoid();
    const tokenHash = await hashPassword(sessionId);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    const member = await db.query.organizationMembers.findFirst({
      where: eq(organizationMembers.userId, user.id),
    });

    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      tokenHash,
      activeOrganizationId: member?.organizationId || "default",
      expiresAt,
    });

    const response = NextResponse.redirect(`${appUrl}/dashboard`);
    response.cookies.set("session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_MS / 1000,
    });

    return response;
  } catch (error) {
    console.error("[auth/google/callback]", error);
    return NextResponse.redirect(`${appUrl}/auth/login?error=callback_failed`);
  }
}

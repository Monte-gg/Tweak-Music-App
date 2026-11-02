import { createHmac, randomInt } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const emailFrom = process.env.EMAIL_FROM;
const otpHashSecret = process.env.OTP_HASH_SECRET;
const appUrl = process.env.TWEAK_APP_URL ?? "http://localhost:5173";
const port = Number(process.env.PORT ?? "3001");
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173,https://monte-gg.github.io")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const serviceClient =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
const publicClient =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use((request, response, next) => {
  const origin = request.header("origin");
  if (origin && allowedOrigins.has(origin.replace(/\/+$/, ""))) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.vary("Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, apikey",
    );
  }
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "10kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  }),
);

const recoveryRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many recovery requests. Please try again later." },
});

const musicSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many music searches. Please try again shortly." },
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const excludedMusicTerms =
  /\b(?:vlog|interview|behind the scenes|trailer|reaction|podcast|review|tutorial|lesson|dance practice|challenge)\b/i;
const welcomeMessage =
  "Welcome to Tweak — your online discoveries and offline music, all in one place.";
const recoveryRequestMessage =
  "If an account exists, a recovery code has been sent. Check your inbox before trying again.";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function hashRecoveryCode(
  secret: string,
  email: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`${email}:${code}`)
    .digest("hex");
}

function durationInSeconds(duration: string | undefined): number | null {
  const match = duration?.match(
    /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/,
  );
  if (!match) {
    return null;
  }
  return Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0);
}

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
};

app.get("/api/health", (_request, response) => {
  response.json({
    api: "ok",
    musicSearchConfigured: Boolean(process.env.YOUTUBE_API_KEY),
    emailConfigured: Boolean(
      serviceClient &&
        publicClient &&
        resend &&
        emailFrom &&
        otpHashSecret &&
        otpHashSecret.length >= 32,
    ),
  });
});

app.get("/api/music/search", musicSearchLimiter, async (request, response) => {
  const queryValue = request.query.q;
  if (typeof queryValue !== "string") {
    response.status(400).json({ error: "Enter a music search query." });
    return;
  }

  const query = queryValue.trim();
  if (query.length < 2 || query.length > 100) {
    response.status(400).json({
      error: "Search queries must contain between 2 and 100 characters.",
    });
    return;
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    response.status(503).json({
      error: "Online search is not configured. Add YOUTUBE_API_KEY to the API environment.",
    });
    return;
  }

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.search = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    type: "video",
    videoCategoryId: "10",
    order: "relevance",
    safeSearch: "moderate",
    videoEmbeddable: "true",
    maxResults: "25",
    q: query,
  }).toString();

  const searchResponse = await fetch(searchUrl, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!searchResponse.ok) {
    console.error("YouTube music search failed.", {
      status: searchResponse.status,
    });
    response.status(502).json({
      error: "YouTube search is unavailable. Check the API key and quota.",
    });
    return;
  }

  const searchData = (await searchResponse.json()) as {
    items?: YouTubeSearchItem[];
  };
  const candidates = (searchData.items ?? []).filter((item) => {
    const title = item.snippet?.title;
    const channelTitle = item.snippet?.channelTitle;
    return (
      Boolean(item.id?.videoId && title && channelTitle) &&
      !excludedMusicTerms.test(`${title} ${channelTitle}`)
    );
  });
  const videoIds = candidates
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));

  if (videoIds.length === 0) {
    response.json({ results: [] });
    return;
  }

  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.search = new URLSearchParams({
    key: apiKey,
    part: "contentDetails,status",
    id: videoIds.join(","),
  }).toString();
  const detailsResponse = await fetch(detailsUrl, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!detailsResponse.ok) {
    console.error("YouTube music duration lookup failed.", {
      status: detailsResponse.status,
    });
    response.status(502).json({
      error: "YouTube search is unavailable. Check the API key and quota.",
    });
    return;
  }

  const detailsData = (await detailsResponse.json()) as {
    items?: Array<{
      id?: string;
      contentDetails?: { duration?: string };
      status?: { embeddable?: boolean };
    }>;
  };
  const durations = new Map(
    (detailsData.items ?? [])
      .filter((item) => item.status?.embeddable === true)
      .map((item) => [item.id, durationInSeconds(item.contentDetails?.duration)] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          typeof entry[0] === "string" && entry[1] !== null,
      ),
  );
  const allowShortTracks =
    /\b(?:short|under\s+(?:60\s+seconds|1\s+minute)|less than a minute)\b/i.test(query);
  const allowLongTracks =
    /\b(?:long|extended|full album|dj set|live set|over\s+10\s+minutes)\b/i.test(query);

  const results = candidates
    .flatMap((item) => {
      const id = item.id?.videoId;
      const snippet = item.snippet;
      const duration = id ? durations.get(id) : undefined;
      if (!id || !snippet?.title || !snippet.channelTitle || duration === undefined) {
        return [];
      }
      if ((!allowShortTracks && duration < 60) || (!allowLongTracks && duration > 600)) {
        return [];
      }

      const channelTitle = snippet.channelTitle;
      const isTopicChannel = /\s-\sTopic$/i.test(channelTitle);
      return [{
        id,
        title: snippet.title,
        artist: isTopicChannel
          ? channelTitle.replace(/\s-\sTopic$/i, "")
          : channelTitle,
        channelTitle,
        duration,
        thumbnailUrl:
          snippet.thumbnails?.high?.url ??
          snippet.thumbnails?.medium?.url ??
          snippet.thumbnails?.default?.url ??
          "",
        youtubeMusicUrl: `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`,
        isTopicChannel,
      }];
    })
    .sort((left, right) => Number(right.isTopicChannel) - Number(left.isTopicChannel))
    .slice(0, 12)
    .map(({ isTopicChannel: _isTopicChannel, ...result }) => result);

  response.json({ results });
});

function recoveryEmailHtml(code: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#0b0c10;color:#f7f7fb;font-family:Arial,sans-serif">
    <table role="presentation" style="max-width:560px;margin:0 auto;width:100%;border:1px solid #292833;border-radius:18px;background:#15161d;padding:32px">
      <tr><td>
        <p style="margin:0 0 24px;color:#a45bff;font-size:20px;font-weight:700">tweak<span style="color:#00d2ff">.</span></p>
        <h1 style="margin:0 0 12px;font-size:22px">Your recovery code</h1>
        <p style="margin:0;color:#a7a7b5;line-height:1.6">Enter this code in Tweak to reset your password. It expires in 10 minutes.</p>
        <p style="margin:26px 0;padding:16px;border:1px solid #393146;border-radius:12px;background:#1b1924;color:#fff;text-align:center;font-size:32px;font-weight:700;letter-spacing:10px">${escapeHtml(code)}</p>
        <p style="margin:0;color:#777887;font-size:12px;line-height:1.6">If you did not request a password reset, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

app.post("/api/email/welcome", async (request, response) => {
  if (!serviceClient || !publicClient || !resend || !emailFrom) {
    response.status(503).json({
      error: "Welcome email is not configured. Add the server email and Supabase keys to .env.local.",
    });
    return;
  }

  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ error: "Sign in before requesting a welcome email." });
    return;
  }

  const accessToken = authorization.slice("Bearer ".length);
  const {
    data: { user },
    error: authError,
  } = await publicClient.auth.getUser(accessToken);

  if (authError || !user) {
    response.status(401).json({ error: "Your session is invalid or has expired." });
    return;
  }
  if (!user.email || !user.email_confirmed_at) {
    response.status(403).json({ error: "Confirm your email before requesting a welcome email." });
    return;
  }
  if (user.user_metadata.welcome_email_pending !== true) {
    response.status(204).end();
    return;
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("username, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    throw profileError;
  }

  const { error: claimError } = await serviceClient
    .from("welcome_email_events")
    .insert({ user_id: user.id });
  if (claimError?.code === "23505") {
    response.status(204).end();
    return;
  }
  if (claimError) {
    throw claimError;
  }

  const username =
    profile?.username ||
    user.user_metadata.username ||
    profile?.full_name ||
    user.email.split("@")[0];
  const escapedUsername = escapeHtml(String(username));

  try {
    const { error: sendError } = await resend.emails.send({
      from: emailFrom,
      to: user.email,
      subject: "Welcome to Tweak",
      text: `Hi ${username},\n\n${welcomeMessage}\n\nOpen Tweak: ${appUrl}`,
      html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#0b0c10;color:#f7f7fb;font-family:Arial,sans-serif">
    <table role="presentation" style="max-width:560px;margin:0 auto;width:100%;border:1px solid #292833;border-radius:18px;background:#15161d;padding:32px">
      <tr><td>
        <p style="margin:0 0 24px;color:#a45bff;font-size:20px;font-weight:700">tweak<span style="color:#00d2ff">.</span></p>
        <h1 style="margin:0 0 12px;font-size:24px">Welcome, ${escapedUsername}.</h1>
        <p style="margin:0;color:#a7a7b5;line-height:1.7">${welcomeMessage}</p>
        <p style="margin:26px 0 0"><a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:12px 18px;border-radius:9px;background:#7824ce;color:#fff;text-decoration:none;font-weight:700">Explore Tweak</a></p>
      </td></tr>
    </table>
  </body>
</html>`,
    });
    if (sendError) {
      throw new Error(sendError.message);
    }

    response.status(200).json({ sent: true });
  } catch (error) {
    const { error: releaseError } = await serviceClient
      .from("welcome_email_events")
      .delete()
      .eq("user_id", user.id);
    if (releaseError) {
      console.error("Could not release the welcome-email retry claim.", releaseError);
    }
    throw error;
  }
});

app.post(
  "/api/auth/recovery/request",
  recoveryRequestLimiter,
  async (request, response) => {
    if (
      !serviceClient ||
      !resend ||
      !emailFrom ||
      !otpHashSecret ||
      otpHashSecret.length < 32
    ) {
      response.status(503).json({
        error: "Password recovery email is not configured. Add the server email and Supabase keys to .env.local.",
      });
      return;
    }

    const emailValue: unknown = request.body?.email;
    if (typeof emailValue !== "string" || !emailPattern.test(emailValue.trim())) {
      response.status(400).json({ error: "Enter a valid email address." });
      return;
    }

    const email = emailValue.trim().toLowerCase();
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      response.status(200).json({ message: recoveryRequestMessage });
      return;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const now = new Date();
    const { data: issued, error: issueError } = await serviceClient.rpc(
      "issue_password_recovery_code",
      {
        p_email: email,
        p_user_id: profile.id,
        p_code_hash: hashRecoveryCode(otpHashSecret, email, code),
        p_expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        p_requested_at: now.toISOString(),
      },
    );
    if (issueError) {
      throw issueError;
    }
    if (!issued) {
      response.status(200).json({ message: recoveryRequestMessage });
      return;
    }

    const { error: sendError } = await resend.emails.send({
      from: emailFrom,
      to: email,
      subject: "Your Tweak password recovery code",
      text: `Your Tweak recovery code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      html: recoveryEmailHtml(code),
    });
    if (sendError) {
      const { error: deleteError } = await serviceClient
        .from("password_recovery_codes")
        .delete()
        .eq("email", email);
      if (deleteError) {
        console.error("Could not clear an undelivered recovery code.", deleteError);
      }
      throw new Error(sendError.message);
    }

    response.status(200).json({ message: recoveryRequestMessage });
  },
);

app.post("/api/auth/recovery/complete", async (request, response) => {
  if (!serviceClient || !otpHashSecret || otpHashSecret.length < 32) {
    response.status(503).json({
      error: "Password recovery is not configured. Add the Supabase service key and OTP_HASH_SECRET to .env.local.",
    });
    return;
  }

  const emailValue: unknown = request.body?.email;
  const codeValue: unknown = request.body?.code;
  const passwordValue: unknown = request.body?.password;

  if (
    typeof emailValue !== "string" ||
    !emailPattern.test(emailValue.trim()) ||
    typeof codeValue !== "string" ||
    !/^\d{6}$/.test(codeValue) ||
    typeof passwordValue !== "string" ||
    passwordValue.length < 8 ||
    passwordValue.length > 128
  ) {
    response.status(400).json({ error: "Check your email, six-digit code, and new password." });
    return;
  }

  const email = emailValue.trim().toLowerCase();
  const codeHash = hashRecoveryCode(otpHashSecret, email, codeValue);
  const { data: userId, error: verifyError } = await serviceClient.rpc(
    "consume_password_recovery_code",
    { p_email: email, p_code_hash: codeHash },
  );
  if (verifyError) {
    throw verifyError;
  }
  if (!userId) {
    response.status(400).json({ error: "That recovery code is invalid or expired." });
    return;
  }

  const { error: passwordError } = await serviceClient.auth.admin.updateUserById(
    userId,
    { password: passwordValue },
  );
  if (passwordError) {
    throw passwordError;
  }

  response.status(200).json({ message: "Password updated. You can now sign in." });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  console.error("Tweak API request failed.", error);
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(500).json({ error: "The request could not be completed. Please try again." });
};

app.use(errorHandler);

app.listen(port, () => {
  console.info(`Tweak API listening on http://127.0.0.1:${port}`);
});

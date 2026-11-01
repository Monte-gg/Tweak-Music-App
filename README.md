# Tweak

Tweak is a React + Vite music dashboard. Authentication uses Supabase and transactional email uses the Resend API from a small Express backend.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set the Supabase URL and anon key from your project's API settings.
3. Run both SQL files in `supabase/migrations` in filename order in the Supabase SQL Editor.
4. To use Google sign-in, enable Google under **Authentication → Sign In / Providers** in Supabase and enter your Google OAuth client ID and secret. In Google Cloud, add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. In Supabase **Authentication → URL Configuration**, set the local site URL to `http://localhost:5173` and allow `http://localhost:5173/**` and `http://127.0.0.1:5173/**`.
5. Add a Resend API key, a verified sender address, and a random `OTP_HASH_SECRET` of at least 32 characters to `.env.local`.
6. To enable local online music discovery, enable YouTube Data API v3 in Google Cloud and set `YOUTUBE_API_KEY` in `.env.local`. Keep this key server-only.
7. Set `VITE_EMAIL_API_ENABLED=true` in `.env.local`.
8. Start both the frontend and API together with `npm run dev`. The API starts even when optional email or music credentials are absent and reports which feature needs configuration.

The browser anon key is intended for client-side use. Keep `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `OTP_HASH_SECRET` server-only; never prefix them with `VITE_`.

Online search uses the official YouTube Data API v3, and requires a server-only YouTube API key. Results are filtered by music category, excluded-content terms, and duration, with `- Topic` channels prioritized. The browser only receives song metadata and YouTube Music links: it does not embed video or extract audio streams.

## Deploy the YouTube search API to Render

1. Push the repository to GitHub and sign in to [Render](https://render.com/).
2. Select **New → Blueprint**, choose the `Tweak-Music-App` repository, and deploy the checked-in `render.yaml`. This creates the `tweak-music-api` web service.
3. In the Google Cloud project, enable **YouTube Data API v3**, create an API key, and restrict it to that API. In the Render service's **Environment**, set `YOUTUBE_API_KEY` to that key. Do not put this key in GitHub, the frontend, or chat.
4. Wait for the Render service to finish deploying. Its health endpoint (`https://<your-render-service>.onrender.com/api/health`) should return `{"api":"ok",...}`.
5. Add `VITE_API_BASE_URL=https://<your-render-service>.onrender.com` to local `.env.local` if testing a locally hosted frontend. The published frontend defaults to `https://tweak-music-api.onrender.com`; change this via `VITE_API_BASE_URL` when building Pages if Render assigns a different service URL. The Render CORS allowlist already permits the published `https://monte-gg.github.io` origin and local Vite URLs.
6. To rebuild the GitHub Pages site on Windows, set the Render URL if it differs from the default, then build:

   ```powershell
   $env:DEPLOY_TARGET = "github-pages"
   $env:VITE_API_BASE_URL = "https://<your-render-service>.onrender.com"
   npm.cmd run build
   Copy-Item dist\index.html dist\404.html
   New-Item -ItemType File dist\.nojekyll -Force
   ```

   Publish the contents of `dist` to the repository's `gh-pages` branch. The frontend calls the Render API directly; the YouTube key remains on Render.

Render's free service may sleep when idle, so the first search after a quiet period can take longer. GitHub Pages only hosts the frontend; email and other Express API features also need a running backend and their own server-side credentials.

Recovery codes expire after 10 minutes, allow five verification attempts, and are limited to one request per minute and five requests per hour per email. The API also applies per-IP rate limits. If deploying behind a trusted reverse proxy, set `TRUST_PROXY=true`.

In production, serve the built frontend and API on the same origin or configure your host to proxy `/api` requests to the Express server.

The `gh-pages` branch contains the prebuilt GitHub Pages site. To create a Pages build on Windows, set `$env:DEPLOY_TARGET = "github-pages"` before running `npm.cmd run build`; the built assets will use the project-site path. GitHub Pages only hosts static files, so the Express email and music-search API requires a separate server deployment. After enabling Google, allow `https://monte-gg.github.io/Tweak-Music-App/` in Supabase **Authentication → URL Configuration**.

The public preview is at `/`. Signed-in users are routed to `/app`; unauthenticated visits to `/app` return to the preview and open sign-in. Online discovery uses the official YouTube Data API, filters music-category results by title, duration, and disallowed terms, and prioritizes `- Topic` channels. Search results can be added to the queue or opened on YouTube Music. The Data API does not provide direct audio streams, so online tracks are not played inside Tweak; in-app playback requires an authorized audio source.

Signed-in users can import or scan a folder of MP3, FLAC, and WAV files in the Offline Studio. Audio tags are parsed locally in the browser, and the audio file plus editable title, artist, and album details are saved in IndexedDB on that device. Metadata edits do not rewrite the original file, and local audio is never uploaded by the library feature. Browser playback support depends on the selected file format and browser.

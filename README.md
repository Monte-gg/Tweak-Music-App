# Tweak

Tweak is a React + Vite music dashboard. Authentication uses Supabase and transactional email uses the Resend API from a small Express backend.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set the Supabase URL and anon key from your project's API settings.
3. Run both SQL files in `supabase/migrations` in filename order in the Supabase SQL Editor.
4. To use Google sign-in, enable Google under **Authentication → Sign In / Providers** in Supabase and enter your Google OAuth client ID and secret. In Google Cloud, add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI. In Supabase **Authentication → URL Configuration**, set the local site URL to `http://localhost:5173` and allow `http://localhost:5173/**` and `http://127.0.0.1:5173/**`.
5. Add a Resend API key, a verified sender address, and a random `OTP_HASH_SECRET` of at least 32 characters to `.env.local`.
6. To enable online music discovery, enable YouTube Data API v3 in Google Cloud and set `YOUTUBE_API_KEY` in `.env.local`. Keep this key server-only.
7. Set `VITE_EMAIL_API_ENABLED=true` in `.env.local`.
8. Start both the frontend and API together with `npm run dev`. The API starts even when optional email or music credentials are absent and reports which feature needs configuration.

The browser anon key is intended for client-side use. Keep `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `OTP_HASH_SECRET` server-only; never prefix them with `VITE_`.

Online search also requires a YouTube Data API v3 key in `YOUTUBE_API_KEY`. Without it, search shows a setup message instead of an empty JSON parsing error. YouTube search results are metadata links only; YouTube does not provide direct audio streams through this API.

Recovery codes expire after 10 minutes, allow five verification attempts, and are limited to one request per minute and five requests per hour per email. The API also applies per-IP rate limits. If deploying behind a trusted reverse proxy, set `TRUST_PROXY=true`.

In production, serve the built frontend and API on the same origin or configure your host to proxy `/api` requests to the Express server.

GitHub Pages deployment is handled by `.github/workflows/deploy-pages.yml`. Add the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as repository Actions variables so authentication is included in the build. After enabling Google, allow `https://monte-gg.github.io/Tweak-Music-App/` in Supabase **Authentication → URL Configuration** (including its subpaths). GitHub Pages only hosts static files; the Express email and music-search API requires a separate server deployment.

The public preview is at `/`. Signed-in users are routed to `/app`; unauthenticated visits to `/app` return to the preview and open sign-in. Online discovery uses the official YouTube Data API, filters music-category results by title, duration, and disallowed terms, and prioritizes `- Topic` channels. Search results can be added to the queue or opened on YouTube Music. The Data API does not provide direct audio streams, so online tracks are not played inside Tweak; in-app playback requires an authorized audio source.

Signed-in users can import or scan a folder of MP3, FLAC, and WAV files in the Offline Studio. Audio tags are parsed locally in the browser, and the audio file plus editable title, artist, and album details are saved in IndexedDB on that device. Metadata edits do not rewrite the original file, and local audio is never uploaded by the library feature. Browser playback support depends on the selected file format and browser.

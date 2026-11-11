<img width="1208" height="844" alt="image" src="https://github.com/user-attachments/assets/c09666b6-5552-45c5-8df0-b2ddfe26629a" />



## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
4. Open http://localhost:3000 (browsers only allow the microphone on localhost or https)

## Deploy to Vercel

Set these environment variables in your Vercel project settings:

- `GEMINI_API_KEY`: your Gemini API key
- `APP_PASSCODE`: a passcode people must enter before they can connect. This stops strangers from using up your Gemini allowance. If it isn't set, the deployed app refuses all sessions. Locally it's optional; add it to `.env.local` to test it.

The browser remembers the passcode after the first successful connection.

The API key stays on the server. When you connect, the browser asks `/api/token` ([api/token.ts](api/token.ts)) for a single-use Gemini Live token. The token must be used within 1 minute, lasts at most 30 minutes, and only works with this app's model, voice and instructions. During `npm run dev`, Vite serves the same endpoint.

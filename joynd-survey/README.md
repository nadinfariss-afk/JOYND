# JOYND Design Survey: self-hosted

The 13-question JOYND survey, running on your own server. People open your link and answer. **No sign-in, no account, no Claude.**

- **Survey:** `https://your-link/`
- **Results (password):** `https://your-link/results`
- **Spreadsheet download (password):** `https://your-link/api/export.csv?key=YOUR_PASSWORD`

The only requirement is **Node.js 18 or newer**. Nothing else to install.

---

## 1. Try it on your computer (2 minutes)

1. Install Node.js from **nodejs.org** (the "LTS" version).
2. Unzip this folder, then open a terminal in it.
3. Start the server, choosing your own results password:

   **Mac / Linux**
   ```
   RESULTS_KEY=pick-a-password node server.js
   ```
   **Windows (PowerShell)**
   ```
   $env:RESULTS_KEY="pick-a-password"; node server.js
   ```
4. Open **http://localhost:3000** for the survey, and **http://localhost:3000/results** for the results.

Answers are saved in `data/responses.json`. Keep that file: it *is* your results.

---

## 2. Get a public link people can open

Pick one of these:

### A. Quickest: share straight from your computer (free)
Good for a test round with friends. Your computer has to stay on while people answer.

1. Install Cloudflare's free tunnel tool, **cloudflared**
   (Mac: `brew install cloudflared`. Windows/Linux: see developers.cloudflare.com → "cloudflared downloads").
2. With the survey server running, open a second terminal and run:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints a link like `https://something-random.trycloudflare.com`. Send that to people.

The random link changes each time you restart it. For a fixed link, use B or C.

### B. Your own custom link, e.g. `survey.joynd.dk`
1. Buy a domain (any registrar), and add it to a free Cloudflare account.
2. Follow Cloudflare's guide **"Create a locally-managed tunnel"** to point `survey.yourdomain` at `http://localhost:3000`.
3. Same as A: your computer runs the server; the link stays the same.

### C. Always-on hosting with a permanent link (recommended): Railway
Runs 24/7 without your computer. The Hobby plan is about $5/month, and the survey fits well inside it.

1. **Put the files on GitHub** (free): create an account at github.com → **New repository** → name it `joynd-survey` → **Private** → Create. Then click **"uploading an existing file"** and drag in *everything inside* this folder (`server.js`, `package.json`, `README.md`, `public/`, `data/`). Click **Commit changes**.
2. **Create the app on Railway**: go to railway.com → sign in with GitHub → **New Project** → **Deploy from GitHub repo** → pick `joynd-survey`. Railway sees `package.json` and starts it with `node server.js` automatically.
3. **Add a storage disk** so answers survive restarts: on the service, choose **Add Volume** (or right-click the service → *Attach volume*) and set the mount path to **`/data`**.
4. **Set two variables** (service → **Variables**):
   - `RESULTS_KEY` = your results password
   - `DATA_DIR` = `/data`
5. **Get your link**: service → **Settings → Networking → Generate Domain**. You get a permanent address like `joynd-survey.up.railway.app`. Want `survey.joynd.dk` instead? Add it under *Custom Domain* and follow the DNS instructions.
6. Open `https://your-link/results` and enter your password to check it works.

To change the survey later: edit the files on GitHub (or upload new versions). Railway redeploys automatically, and the answers on the `/data` disk are kept.

Other hosts work the same way (Fly.io, Render, a VPS): run `node server.js`, set `RESULTS_KEY`, and give it a persistent disk with `DATA_DIR` pointing to it. Without a disk, many hosts wipe files on restart and you'd lose answers.

---

## Good to know

- **Answering twice:** each browser gets a random id. If someone answers again, their new answers replace the old ones instead of counting twice.
- **Privacy:** no names, emails or IP addresses are stored. Only the answers and a timestamp.
- **Spam protection:** max 20 submissions per network per 10 minutes, and answers are size-limited.
- **Live results:** the Results page checks for new answers every 10 seconds.
- **Back up** `data/responses.json` now and then, or download the CSV.
- **Reset the results:** stop the server, delete `data/responses.json`, start again.

## Debug mode (off in this release)

Debug mode lets you skip and jump between questions when testing. It is **switched off** in this version. To turn it back on for testing, set `const DEBUG = true;` in `public/index.html` and open the link with `?debug` at the end.

## Changing questions

All questions live in one list called `Q` in `public/index.html`. Phone-screen images are the `.webp` files in `public/`.

# Kahaani Baaz — Portfolio Site

## What's in this folder

- `index.html` — the public site.
- `data.json` — the content for name, bio, photos, reel, and music.
- `images/` — uploaded photos, videos, and music files.
- `admin.html` — **local-only tool** to add/edit content. **Do NOT deploy this file.**
- `server.js` — lightweight Node server for serving the site and handling uploads.
- `render.yaml` — deployment config for Render.

The site now runs as a small Node app so uploads can be handled on the server.

---

## 1. Deploying the public site

Only upload these three things to your host: `index.html`, `data.json`, `images/`.

### Option A — GitHub Pages
1. Create a new GitHub repo (e.g. `kahaani-baaz-portfolio`).
2. Upload `index.html`, `data.json`, and the `images/` folder to the repo root.
3. Go to **Settings → Pages**, set source to the `main` branch, root folder.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.

### Option B — Netlify
1. Go to [netlify.com](https://netlify.com), drag the folder containing
   `index.html`, `data.json`, and `images/` onto the "Deploy" area.
2. Netlify gives you a live URL immediately. You can rename it or attach a
   custom domain in site settings.

Either way: **leave `admin.html` out of the upload.** Keep it only on your
own computer.

---

## 2. Adding new projects/photos (the admin tool)

`admin.html` is a password-gated tool that runs entirely in your browser —
it never sends anything to a server. Use it locally, then re-upload the
updated `data.json` (and any new files in `images/`) to your host.

### First time setup
1. Open `admin.html` in **Chrome or Edge** (recommended — see note below).
2. Log in with the default password: `kahaanibaaz2026`
   Change this by opening `admin.html` in a text editor and editing the
   line near the top of the `<script>` section:
   ```js
   const ADMIN_PASSWORD = "kahaanibaaz2026";
   ```
3. Click **"Open Project Folder"** and select the folder containing
   `index.html`, `data.json`, and `images/`.

### Adding a photo
1. Under **Frames**, click the upload box and choose an image.
2. Fill in a caption (e.g. `FRAME_07 — RAINY MARKET DAY`) and alt text.
3. Optionally check "Make this the large featured frame."
4. Click **Add Frame**, then **Save Changes** at the top.
   This writes the image into `images/` and updates `data.json` directly —
   no manual file copying needed.

### Reordering, featuring, or deleting a photo
Each photo in the list has ↑ / ↓ / Set Featured / Delete buttons. Changes
take effect once you click **Save Changes**.

### Updating the reel or music
Same idea — drop a new video or MP3 file in, click **Save Changes**.

### Editing your bio/tagline
Update the **Site Details** fields at the top, then **Save Changes**.

### After saving
Re-upload the updated `data.json` and `images/` folder to GitHub Pages or
Netlify (or just push/redeploy if using Git).

### If you're not on Chrome/Edge
Firefox and Safari don't support direct folder editing. `admin.html` will
fall back to: you upload your current `data.json`, make changes, and it
downloads an updated `data.json` plus any new media files — which you then
manually drop into your project folder before redeploying.

---

## Notes

- The admin password is a light deterrent, not real security — it lives in
  plain text in the file. That's fine as long as `admin.html` stays off
  your public host, which is why it's excluded from deployment above.
- Everything in `data.json` is plain text, so you can also hand-edit it
  directly if you're comfortable with JSON.

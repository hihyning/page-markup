# Page Markup

Pin written notes to a live web page in mobile view, capture it, and publish a scrollable review link anyone can open: no account, no extension.

- **You** use the Chrome extension in `extension/`.
- **Reviewers** open a link like `https://<you>.github.io/page-markup/reviews/<name>.html`, scroll the phone-width page with numbered marks, and click notes to jump to them.

## Install the extension (about a minute)

1. Download this repo (Code → Download ZIP) or `dist/page-markup-extension.zip`, and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the extension, then click its icon to open the side panel.

## Mark up a page

1. Open the page, for example `https://www.nbcnews.com/specials/vaccine-divide/index.html`.
2. In the side panel click **Start markup on this page** and allow access to the site.
3. Click **Phone view** (390px by default). The tab reloads at phone size. Chrome shows a "debugging this browser" bar while it's on; that's expected.
4. Pick a tool and category, then click the page:
   - **Pin**: click a headline or paragraph. The note records its font, size/line height, weight, tracking and margins.
   - **Highlight / Box**: drag over an area.
   - **Arrow**: drag from where the arrow starts to what it points at.
   - **Gap**: click two elements to measure the space between them in CSS px.
   - **Sticker**: pick a sticker (Too tight, Line height, Widow / orphan…) and click.
   - **Browse** (Esc): use the page normally. Drag any mark to move it. Delete removes the selected one.
5. Write each note in the side panel. Use "current → suggested" for exact values.

## Share

1. **Capture page** (scroll and stitch is the default; use "Use my own screenshot" if a page misbehaves).
2. **Publish to GitHub**. The link is copied to your clipboard. Publishing again updates the same link.
3. **Copy Slack list** gives a numbered list with the link at the top.

Pages takes about a minute to show a new or updated review.

### One-time GitHub setup

1. This repo needs GitHub Pages on: Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`.
2. Create a fine-grained token: GitHub → Settings → Developer settings → Fine-grained tokens → Generate. Repository access: **Only select repositories → page-markup**. Permissions: **Contents → Read and write**.
3. In the side panel open **GitHub settings**, fill Owner, Repository `page-markup`, Branch `main`, Folder `reviews`, paste the token and save. It's stored only in your browser.

## Good to know

- Reviews are public web pages with hard-to-guess names. Anyone with the link can view them, and they're visible to anyone browsing this public repo.
- A review is a snapshot: it shows the page as it looked when you captured it.
- Notes added after the last capture are placed from the live page if it's still at the same width; otherwise capture again.
- Pages that scroll inside a container instead of the window may capture only the first screen. Use "Use my own screenshot" for those.

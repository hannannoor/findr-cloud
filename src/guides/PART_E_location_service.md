# Findr — Part E: Amazon Location Service

**Region: `ap-southeast-2` (Sydney)** · **Account: `958202484887`**

Replacing the OpenStreetMap/Leaflet basemap with Amazon Location Service map tiles,
drawn through MapLibre GL JS.

About 25 minutes.

## Why this counts

Your Part 1 map looked good but had nothing to do with AWS — it pulled tiles from
OpenStreetMap via CARTO, a free public service. After this, the basemap is an AWS
service, which means the map page genuinely belongs in your "additional cloud
services" list rather than just looking like it does.

| | Before | After |
|---|---|---|
| Tiles | OpenStreetMap / CARTO | **Amazon Location Service** |
| Library | Leaflet | MapLibre GL JS |
| Auth | none | Location Service API key |
| Pin coordinates | scattered around a zone | real coordinates when the user drops a pin |

> **On the library swap:** Leaflet can't render Location Service's vector tiles, so
> the map is drawn with MapLibre GL JS instead. MapLibre is the open-source renderer
> AWS documents for Location Service. Both are free and open source — the difference
> is raster tiles versus vector tiles, and vector tiles are what Location Service
> serves.

---

## Step 30 — Create the API key

There's no "enable Location Service" step. Creating the key *is* the setup — with
Location Service v2 the `Standard` map style is available directly, so you don't
need to create a Map resource first.

1. Console search → **Amazon Location Service**
2. Left menu → **API keys**
3. **Create API key**
4. **Name:** `findr-map-key`
5. **Resources:** select **Maps**
6. **Actions:** tick the map/tile actions offered for Maps
7. **Expiration:** leave blank, or set a date after **20 August 2026**
8. **Client restrictions:** leave blank for now — we lock it down in Step 34
9. **Create API key**
10. Click **Show API key** and copy the value. It starts with `v1.public.`

📸 `65-location-api-key.png` — the key page (leave the value hidden in the shot)

> **Why an API key rather than Cognito:** Location Service supports both. A key is
> right here because map tiles are public, read-only data — there's nothing
> user-specific to protect. Cognito identity pools would be the answer if the map
> needed per-user data. Worth saying in the report: choosing the simpler auth model
> when the data doesn't need more is a design decision, not laziness.

---

## Step 31 — Paste the key into the site

Open `js/api.js` and find this near the top:

```javascript
const LOCATION_API_KEY = "PASTE_YOUR_LOCATION_API_KEY_HERE";
```

Replace the placeholder with your key:

```javascript
const LOCATION_API_KEY = "REPLACE_WITH_AWS_LOCATION_API_KEY";
```

**That's the only place it goes.** The config lives in `api.js` so both the map page
and the report form read the same value.

Save the file.

---

## Step 32 — Upload everything to S3

**Yes — replace all the files.** Seven changed (`api.js`, `map.js`, `report.js`,
`styles.css`, `map.html`, `report-lost.html`, `report-found.html`), but re-uploading
everything is faster than picking them out, and it avoids the classic mistake of
uploading `map.js` on its own so it lands at the bucket root instead of inside `js/`.

1. **S3** → `findr-site-XXXXXXXX` → **Upload**
2. **Add files** → select all 11 `.html` files
3. **Add folder** → `css`
4. **Add folder** → `js`
5. **Add folder** → `images`
6. **Upload**

---

## Step 33 — Invalidate the CloudFront cache ⚠️

**Do not skip this.** CloudFront caches your files at edge locations for up to 24
hours. Uploading to S3 does *not* update what CloudFront serves — you'll refresh,
see the old site, and conclude the map is broken when it's actually just cached.

1. **CloudFront** → your distribution (`findr-site`)
2. **Invalidations** tab → **Create invalidation**
3. Object paths: `/*`
4. **Create invalidation**

Takes about a minute to complete. Free — 1,000 paths a month at no charge, and `/*`
counts as one.

📸 `66-cloudfront-invalidation.png`

> **From now on, every frontend change follows this loop:**
> upload to S3 → invalidate `/*` → hard-refresh with `Ctrl + Shift + R`.
> Skipping any step means you're looking at stale files.

---

## Step 34 — Test

Open `https://d3d5h347656j6.cloudfront.net/map.html` and hard-refresh.

**What you should see:**

- A map of the Temasek Polytechnic campus, rendered by Amazon Location Service
- Photo pins for each report, red ring for lost, green for found
- Clicking a pin opens the detail card
- The All / Lost / Found chips filter the pins
- The list drawer slides in and out

**Then check the report form** — `report-lost.html`, scroll to the map, click to drop
a pin. The pin should appear where you clicked and the hint text should change.

📸 `67-location-map-campus.png` — the map with pins showing
📸 `68-location-map-popup.png` — a pin's detail card open
📸 `69-location-pin-drop.png` — the pin-drop map on the report form

### If it doesn't work

| What you see | Cause |
|---|---|
| "Map not configured" | The key is still the placeholder in `api.js` |
| "Map couldn't load — Location Service rejected the request" | Key is wrong, expired, or missing map actions |
| Blank grey box | MapLibre didn't load — check the browser console |
| Old Leaflet map still showing | You skipped the CloudFront invalidation |

Open **F12 → Console** for the real error. A `403` from `maps.geo.ap-southeast-2.amazonaws.com`
means the key's actions are wrong; fix them on the key and try again.

---

## Step 35 — Lock the key down *(optional, do it if time allows)*

An API key with no restrictions works from anywhere. Restricting it to your domain
is a quick least-privilege win and a good line in the report.

1. **Amazon Location Service** → **API keys** → `findr-map-key` → **Edit**
2. **Client restrictions** → add:
   ```
   https://d3d5h347656j6.cloudfront.net/*
   ```
3. Save

📸 `70-location-key-restricted.png`

> ⚠️ Once restricted, the map stops working from anywhere else — including opening
> the HTML file locally. Only do this after everything works, and remember it if you
> later wonder why the local copy has no map.

---

## ✅ Part E checklist

- [ ] API key created, actions set for Maps
- [ ] **API key value saved somewhere:** `v1.public.____________`
- [ ] Key pasted into `js/api.js`
- [ ] All files re-uploaded to S3
- [ ] CloudFront invalidated with `/*`
- [ ] Map loads on `map.html` with pins
- [ ] Pin popups open
- [ ] Filter chips work
- [ ] Pin drop works on the report form
- [ ] Client restriction added *(optional)*
- [ ] Screenshots 65–70 saved

---

## What to say about this

> The campus map originally used OpenStreetMap tiles through Leaflet, which meant
> the map feature sat outside AWS entirely. It now renders Amazon Location Service
> vector tiles through MapLibre GL JS, authenticated with a scoped API key.
>
> Reports carry real coordinates when the user drops a pin on the report form; where
> no pin was dropped, the item is placed deterministically near its stated campus
> zone so that the same report always appears in the same position rather than
> jumping between page loads.
>
> The key is restricted to map read actions only and, in the deployed version, to
> requests originating from the CloudFront domain.

That last sentence is worth saying out loud in the demo — it shows the same
least-privilege thinking as the IAM policy and the private buckets, applied
consistently rather than in one place.

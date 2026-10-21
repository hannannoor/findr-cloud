"""
fetch_dataset.py
downloads training images for the findr rekognition custom labels model

makes this structure, ready to upload straight to s3:
    findr-dataset/
        Bottle/  Wallet/  Phone/  Laptop/
        Bag/     Keys/    Umbrella/  Clothing/

setup (one time):
    pip install ddgs pillow requests

run:
    python fetch_dataset.py

if a category comes out short, just run it again - it skips what it already has.
"""

import os
import time
import hashlib
import requests
from io import BytesIO

try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        raise SystemExit("Missing package. Run:  pip install ddgs pillow requests")

from PIL import Image

OUT_DIR = "findr-dataset"
PER_LABEL = 50          # how many images you want per category
MIN_SIDE = 200          # bin anything tiny
MAX_SIDE = 1600         # shrink anything huge, keeps the upload quick

# several queries per label on purpose. one query gives 20 near identical
# photos and the model ends up learning the background instead of the object
QUERIES = {
    "Bottle": [
        "water bottle on desk", "stainless steel flask", "plastic water bottle table",
        "sports water bottle", "thermos flask photo",
    ],
    "Wallet": [
        "leather wallet on table", "bifold wallet open", "card holder wallet",
        "wallet flat lay", "wallet in hand",
    ],
    "Phone": [
        "smartphone on desk", "mobile phone on table", "phone face down desk",
        "android phone in hand", "smartphone on floor",
    ],
    "Laptop": [
        "laptop on desk", "closed laptop on table", "notebook computer desk",
        "laptop in backpack", "laptop on bed",
    ],
    "Bag": [
        "backpack on floor", "school bag on chair", "tote bag on table",
        "rucksack photo", "handbag on seat",
    ],
    "Keys": [
        "keys on table", "keychain with lanyard", "bunch of keys photo",
        "car keys on desk", "keys in hand",
    ],
    "Umbrella": [
        "umbrella on floor", "folding umbrella closed", "black umbrella on table",
        "compact umbrella photo", "umbrella leaning against wall",
    ],
    "Clothing": [
        "jacket on chair", "hoodie on bench", "folded jumper on table",
        "sweater on floor", "windbreaker jacket photo",
    ],
}

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


def already_have(folder):
    if not os.path.isdir(folder):
        return 0
    return len([f for f in os.listdir(folder) if f.lower().endswith((".jpg", ".png"))])


def save_image(url, folder, seen_hashes):
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        if r.status_code != 200 or len(r.content) < 4000:
            return False

        # skip exact duplicates, different searches turn up the same photo a lot
        digest = hashlib.md5(r.content).hexdigest()
        if digest in seen_hashes:
            return False

        img = Image.open(BytesIO(r.content))
        img = img.convert("RGB")

        w, h = img.size
        if min(w, h) < MIN_SIDE:
            return False
        if max(w, h) > MAX_SIDE:
            scale = MAX_SIDE / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        seen_hashes.add(digest)
        path = os.path.join(folder, f"{digest[:12]}.jpg")
        img.save(path, "JPEG", quality=88)
        return True
    except Exception:
        return False


def fetch_label(label, queries):
    folder = os.path.join(OUT_DIR, label)
    os.makedirs(folder, exist_ok=True)

    have = already_have(folder)
    if have >= PER_LABEL:
        print(f"  {label}: already has {have}, skipping")
        return have

    seen_hashes = set()
    need = PER_LABEL - have
    # spread the requirement across the queries, ask for extra since many fail
    per_query = max(3, (need // len(queries)) + 3)

    print(f"  {label}: need {need} more")

    with DDGS() as ddgs:
        for query in queries:
            if already_have(folder) >= PER_LABEL:
                break
            try:
                results = ddgs.images(query, max_results=per_query * 3)
            except Exception as e:
                print(f"    search failed for '{query}': {e}")
                continue

            got = 0
            for r in results:
                if already_have(folder) >= PER_LABEL or got >= per_query:
                    break
                url = r.get("image") or r.get("thumbnail")
                if url and save_image(url, folder, seen_hashes):
                    got += 1

            print(f"    '{query}' -> {got}")
            time.sleep(1.5)   # be polite, avoid getting rate limited

    total = already_have(folder)
    print(f"  {label}: {total} images")
    return total


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Downloading into ./{OUT_DIR}/ ({PER_LABEL} per category)\n")

    counts = {}
    for label, queries in QUERIES.items():
        counts[label] = fetch_label(label, queries)
        print()

    print("=" * 40)
    for label, n in counts.items():
        flag = "OK " if n >= 15 else "LOW"
        print(f"  {flag}  {label:8} {n}")
    print("=" * 40)

    low = [l for l, n in counts.items() if n < 15]
    if low:
        print(f"\nShort on: {', '.join(low)} - run the script again to top them up.")
    else:
        print("\nAll good. Now open each folder and delete anything that looks wrong,")
        print("then upload the six folders to S3.")


if __name__ == "__main__":
    main()
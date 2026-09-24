# Anveshak — Two-Laptop Prototype

## 1. What your notebook actually does

Your `Anveshak.ipynb` is a Google Colab training notebook. Step by step:

1. Installs `ultralytics` (YOLOv8), `roboflow`, `opencv`.
2. Downloads a flood/disaster image dataset from Roboflow (project `flood-cka5z-qffgh`).
3. Splits it into train/valid/test (80/10/10).
4. Builds a YOLO data config with 5 classes (car, house, person, etc.).
5. Loads a starting model `yolov8n.pt` (the "n" = nano, smallest/fastest YOLOv8).
6. **Trains** it for 30 epochs on your flood dataset → this is where it *becomes* Anveshak instead of generic YOLO.
7. Saves the trained weights to Google Drive as **`Anveshak_best.pt`** (best-performing checkpoint) and `Anveshak_last.pt` (last epoch).
8. Loads `best.pt` back and runs it on a test image, counting boxes where `class_id == 4` ("person") as **potential survivors**.

## 2. What `best.pt` actually is (super simple)

Think of training as teaching a student. `best.pt` is that student's **finished, memorized knowledge** — a file full of numbers (weights) that represent "what a person/car/house looks like from a drone."

You never touch those numbers directly. You just hand the file to YOLO and ask it to look at a photo:

```python
from ultralytics import YOLO

model = YOLO("best.pt")          # load the trained brain
results = model("photo.jpg")     # ask it: what do you see here?
```

That's the entire pattern. Everything in the code below is just this, wrapped with:
- counting how many of each class (person / fire / flood / vehicle) were found
- sending that to a live map the rescue team can look at

**Where to put your file:** copy `Anveshak_best.pt` from your Google Drive down to your computer, rename it (or not) to `best.pt`, and put it directly in the `LAPTOP1_field_node/` folder. (It's already there in the zip you're sharing.)

---

## 3. The two-laptop architecture

Laptop 2 is now split into two pieces of its own: a small **relay server**
(the bridge Laptop 1 talks to) and a **React + Leaflet map dashboard** (the
page you actually look at). Both still run on your one machine.

```
┌───────────────────────────────┐  HTTP POST /trigger        ┌──────────────────────────────┐
│ LAPTOP 1 (Field, friend)       │ ── (per detection) ──────▶ │ LAPTOP 2 (Command, you)      │
│ LAPTOP1_field_node/            │                            │ LAPTOP2_command_center/      │
│ "Project Drishti" — upload UI  │                            │                              │
│                                │                            │  relay_server.py (port 8000) │
│  She uploads a drone/field     │                            │  receives /trigger, forwards │
│  image in her browser          │                            │  it to every connected map   │
│         │                     │                            │  browser over /ws            │
│         ▼                     │                            │         │                    │
│  FastAPI backend (port 8000)   │                            │         ▼                    │
│  YOLO(best.pt) finds people/   │                            │  frontend/ — React + Leaflet │
│  fire/flood/vehicles, draws    │                            │  map dashboard (port 5173)   │
│  boxes, shows it on her screen │                            │  drone sim, hazard/rescue    │
│         │                     │                            │  markers, "Safe Path" line   │
│         ▼                     │                            │                              │
│   requests.post(/trigger) ─────┼───────────────────────────▶│  (if offline: saved to       │
│   (if offline: saved to        │                            │   offline_queue.jsonl on     │
│    offline_queue.jsonl,        │                            │   Laptop 1, retried later)   │
│    retried on reconnect)       │                            │                              │
└───────────────────────────────┘                            └──────────────────────────────┘
```

**Why this answers "what if the rescue team has no internet access":**
Nothing here uses the internet. Laptop 2's relay is a normal local server
(`uvicorn ... --host 0.0.0.0 --port 8000`). Any device on the same WiFi —
including a phone hotspot with no internet plan, or a router with no WAN
cable plugged in at all — can reach `http://<laptop2's-LAN-IP>:8000`. That's
the whole trick: LAN traffic doesn't need internet, only internet *access*
needs internet.

### The Safe Path is a simulation, not real navigation

The dashboard draws a dashed line from a fixed **Home Base** marker to the
newest detection, and bends it around any earlier fire/flood marker sitting
close to that line. This is explicitly a **prototype decision-support
visualization** — it shows what a future real path-planner *would* do, using
flat-plane geometry and a single perpendicular offset. It is not
physics-checked, not obstacle-aware beyond hazard markers you've already
seen, and not a certified flight route. The dashboard labels it as such in
the sidebar and in the line's popup — don't remove that label if you extend
this further.

---

## 4. How to run the two-laptop prototype

Both machines only need to be on the **same WiFi network** (a phone hotspot
with zero mobile data works fine — no internet required anywhere in this
chain). The moment Laptop 1 detects something, it POSTs it to Laptop 2's
relay, which instantly forwards it to the map dashboard over a WebSocket —
no refreshing, no polling.

### Step 0 — get the project onto both laptops

The folders are already named so it's obvious who runs what:

```
anveshak/
├── LAPTOP1_field_node/       ← YOUR FRIEND runs this ("Project Drishti" upload UI)
│   ├── QUICKSTART.txt         (just for her — copy/paste commands)
│   ├── backend/                (FastAPI + YOLO — the AI brain)
│   ├── frontend/                (React upload page she opens in her browser)
│   ├── best.pt                 (already included in the zip)
│   └── requirements.txt
└── LAPTOP2_command_center/   ← YOU run this (the relay + map dashboard)
    ├── QUICKSTART.txt         (just for you — copy/paste commands)
    ├── relay_server.py
    ├── requirements.txt
    └── frontend/               (React + Leaflet map dashboard)
```

You only need to send your friend the **`LAPTOP1_field_node`** folder — zip
just that one and send it via Google Drive link, WeTransfer, Discord/WhatsApp
file share, USB stick, whatever's easiest. She doesn't need to see your
`LAPTOP2_command_center` code at all. (A full-project zip with both folders
also sits next to this one, in case you want her to have the whole thing for
reference.)

Each folder has its own `QUICKSTART.txt` with copy-paste-ready commands — so
you can literally tell your friend "open `LAPTOP1_field_node`, read
`QUICKSTART.txt`" and she's done, no need to read this whole README.

### Step 1 — YOU start the relay + map dashboard first (Laptop 2)

This is two terminals (your `QUICKSTART.txt` has the exact commands):

```bash
# Terminal A — the relay server
cd anveshak/LAPTOP2_command_center
pip install -r requirements.txt
python -m uvicorn relay_server:app --host 0.0.0.0 --port 8000

# Terminal B — the map dashboard
cd anveshak/LAPTOP2_command_center/frontend
npm install
npm run dev
```

Open the address `npm run dev` prints (usually `http://localhost:5173`) —
that's your map. Then **deploy a mission**: click "Select Region on Map",
click 4 points to draw a box, click "Deploy UAV Mission". Only once a
mission is active does the dashboard listen for live alerts.

Find your laptop's LAN IP so your friend can reach it:
- Windows: `ipconfig` → look for "IPv4 Address" (something like `192.168.1.20`)
- Mac/Linux: `ifconfig` or `ip addr`

### Step 2 — connect BOTH laptops to the same WiFi

Same router, or your friend joins a hotspot you create — either way, both
machines need to be able to reach that IP address you found above. (If
you're both remote — not physically together — plain WiFi won't do it; see
the note at the end of this section.)

### Step 3 — YOUR FRIEND runs Project Drishti (Laptop 1)

Also two terminals (her `QUICKSTART.txt` has the exact commands):

```bash
# Terminal A — the AI backend
cd anveshak/LAPTOP1_field_node
pip install -r requirements.txt
set DASHBOARD_URL=http://<your-ip>:8000        (Windows cmd.exe)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Terminal B — the upload web page
cd anveshak/LAPTOP1_field_node/frontend
npm install
npm run dev
```

She opens the address `npm run dev` prints (usually `http://localhost:5173`),
uploads a drone/field image, and clicks **DETECT OBJECTS**. Replace
`<your-ip>` with the IP you found in Step 1 — note it's port **8000** (her
`DASHBOARD_URL` points at your *relay*, not the map page itself on 5173).

### What "live update" actually means here

The moment she clicks Detect, her backend runs YOLO (`best.pt`) on the
image, draws boxes, shows the annotated result on her own screen — and in
the same request, POSTs the detection to your `relay_server.py` at
`/trigger`. Your relay immediately forwards that same JSON to every map
browser connected over `/ws` — including yours. Your browser doesn't ask
"anything new?" every few seconds; the relay *pushes* to it the instant it
happens. That's the whole "no polling" trick. New markers (rescue targets in
red, hazards in orange/blue) appear on the map immediately, and the Safe
Path line redraws to the newest one.

If her laptop briefly loses the connection to yours (WiFi hiccup, your relay
isn't running yet, or you haven't deployed a mission so no dashboard is
listening), that detection queues up locally in `offline_queue.jsonl` on her
machine and gets sent automatically the next time her backend reconnects —
nothing is lost. There's no persistence on the Laptop 2 side though — this
relay doesn't log to a database, so only detections sent *while* your map is
connected and a mission is active will ever appear.

### If you're NOT on the same physical WiFi (remote / different locations)

Plain LAN traffic only works when both machines can route to each other,
which normally means the same network. If you're testing this remotely, the
simplest fix without touching cloud infra is a peer-to-peer tunnel — e.g. run
`ngrok http 8000` (or `tailscale`/`zrok`) on your (Laptop 2) machine, and have
your friend point `DASHBOARD_URL` at the public URL ngrok gives you instead
of your LAN IP. Ask me and I can wire that up if you want it.

---

## 5. Moving from "Laptop 1" to a real Raspberry Pi + Hailo-8L

This is the natural next step once the two-laptop version works, because the
code doesn't change conceptually — only *where the model runs* changes.

1. **Convert the model once, ahead of time (on any laptop, not the Pi):**
   - `best.pt` (PyTorch) → export to ONNX: `model.export(format="onnx")`
   - ONNX → Hailo's `.hef` format using the **Hailo Dataflow Compiler** (Hailo's
     own toolchain — runs on a Linux PC, not on the Pi itself).
   - This step is a one-time "compile for this specific chip" step, same idea
     as compiling C++ code for a specific CPU.

2. **On the Raspberry Pi (with the Hailo-8L board attached via M.2/HAT):**
   - Install `hailo-platform` / `hailort` runtime instead of full PyTorch — much
     lighter, and the Hailo-8L chip does the heavy math (not the Pi's CPU).
   - `backend/detector.py`'s structure stays almost identical — you'd swap the
     `YOLO("best.pt")` + `model.predict(...)` lines for Hailo's inference call
     (`HailoRT` Python API loading the `.hef` file), but everything downstream —
     `dashboard_link.py`'s `build_dashboard_event()`, `send_to_dashboard()`, the
     offline queue — stays exactly the same.

3. **Why Hailo-8L specifically helps here:** it's built to run YOLO-style models
   at real-time speed using only a few watts, which is what lets a
   battery-powered drone or a solar field unit run continuous detection instead
   of draining a laptop battery in 30 minutes.

4. **On-device flagging still makes sense**: even without the old
   CRITICAL/HIGH/LOW rule, a Pi hanging off a drone with zero connectivity
   could still locally blink an LED / sound a buzzer the instant its own
   `counts["person"] > 0`, before the detection ever reaches a laptop or map.

5. **Syncing back to Laptop 2:** identical to the two-laptop version — the Pi
   POSTs to the same relay `/trigger` endpoint over WiFi when it's in range,
   and queues locally (`offline_queue.jsonl`) when it isn't.

---

## 6. Files in this project

```
anveshak/
├── README.md                          (this file — the full explanation)
├── LAPTOP1_field_node/                 (send only this folder to your friend)
│   ├── QUICKSTART.txt                 (her copy-paste instructions)
│   ├── best.pt                        (the trained model)
│   ├── requirements.txt               (backend Python deps)
│   ├── backend/
│   │   ├── main.py                    (FastAPI app — /detect, /health, /ws)
│   │   ├── detector.py                (loads best.pt, runs YOLO)
│   │   ├── config.py                  (model path, classes, DASHBOARD_URL)
│   │   ├── dashboard_link.py          (POSTs each detection to Laptop 2's relay)
│   │   ├── database.py                (local SQLite log of her uploads)
│   │   └── websocket_manager.py       (powers the in-page live map view)
│   └── frontend/                      (the "Project Drishti" upload page)
│       ├── package.json
│       ├── vite.config.js
│       └── src/                       (React components — upload, map, etc.)
└── LAPTOP2_command_center/             (keep and run this one yourself)
    ├── QUICKSTART.txt                 (your copy-paste instructions)
    ├── relay_server.py                (FastAPI bridge — /trigger in, /ws out)
    ├── requirements.txt
    └── frontend/                      (React + Leaflet map dashboard)
        ├── package.json
        ├── vite.config.js
        ├── tailwind.config.js
        └── src/
            ├── App.jsx
            └── components/
                └── Dashboard.jsx      (the map: drone sim, markers, Safe Path)
```

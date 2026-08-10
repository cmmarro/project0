# Getting Castaway running

No programming needed. Two steps: get the folder onto your computer, then
double-click one file.

---

## Step 1 — get the folder

### The easy way (no git required)

1. Go to <https://github.com/cmmarro/project0/tree/claude/llm-game-characters-gyqubv>
2. Click the green **Code** button → **Download ZIP**
3. Find the ZIP in your Downloads, right-click → **Extract All** (Windows) or
   double-click it (Mac)
4. Drag the extracted folder onto your **Desktop**
5. Rename it to `castaway` if you like — the name doesn't matter

### Or, if you have git

Open a terminal and paste this:

```bash
cd ~/Desktop
git clone -b claude/llm-game-characters-gyqubv https://github.com/cmmarro/project0.git castaway
```

---

## Step 2 — start it

### Windows

Open the folder and **double-click `run.bat`**.

A black window appears and does some setup — that's normal, and it only happens
the first time. After a minute your browser opens with the game in it.

> If Windows says *"Python isn't installed"*: get it from
> <https://www.python.org/downloads/>, and **tick the "Add python.exe to PATH"
> box on the very first screen of the installer**. That checkbox is easy to miss
> and nothing works without it. Then double-click `run.bat` again.

> If Windows SmartScreen warns about running the file, click **More info** →
> **Run anyway**. It's a text file you can read.

### Mac or Linux

Open Terminal, then paste these two lines:

```bash
cd ~/Desktop/castaway
./run.sh
```

If it says *permission denied*, run `chmod +x run.sh` once and try again.

---

## Step 3 — tell it who plays the survivors

The game opens with a settings box, because it doesn't know yet.

### Using LM Studio (free, runs on your own PC)

1. Open **LM Studio**
2. Load a model (any instruct model works — something like a 7B or 8B is plenty)
3. Go to LM Studio's **Developer** / **Local Server** tab and click **Start Server**
4. Back in the game's settings box:
   - Backend: **Local / OpenAI-compatible**
   - Click the **LM Studio** button (fills in the address for you)
   - Click **refresh** — your loaded model appears in the list
   - Click **Test connection** — it should say *Connected to …*
   - Click **Save & play**

### Using Claude instead

- Backend: **Anthropic API**
- Paste your API key from <https://console.anthropic.com>
- **Test connection**, then **Save & play**

### Just looking around

Leave it on **Offline**. The game works, but the survivors only say a handful of
canned lines. Fine for seeing how it moves; not worth playing.

---

## Step 4 — play

- **WASD** or **arrow keys** to walk
- **E** gather · **Q** drink · **F** eat · **R** rest
- **Enter** jumps to the text box — whatever you type is *said out loud*, and
  only people standing near you can hear it

You start alone and you don't know whether anyone else survived. Walk around
until you find someone. The log on the right tells you what you're hearing.

To stop the game, close the black window (or press **Ctrl+C** in it).

---

## When something goes wrong

**The browser didn't open.** Type `http://127.0.0.1:5000` into it yourself.

**"Test connection" says it can't reach the server.** LM Studio's server isn't
running. In LM Studio, go to the Developer/Local Server tab and press Start. Check
the port matches — LM Studio usually uses `1234`.

**"Malformed LM Studio API token provided".** LM Studio has authentication
switched on. Either turn it off (LM Studio → Developer → Settings), or copy the
token it shows you — it starts with `lms-` — and paste that into the game's
**API key** box. Don't invent a value: leave the box completely empty if auth is
off, because LM Studio checks the shape of whatever you send.

**"'response_format.type' must be 'json_schema' or 'text'".** You're on an older
build of this game — `git pull` (or re-download the ZIP) and try again. LM Studio
has no JSON-object mode, which the game used to try as a fallback.

**"Test connection" says no model is loaded.** Load a model in LM Studio first,
then press **refresh** in the game's settings.

**The survivors say something and then go quiet.** Small models sometimes run out
of room mid-sentence. Open settings (click the badge in the top-left) and raise
**Max tokens** to 2000.

**The survivors are slow.** That's your local model thinking. A smaller model, or
Claude, will be faster. The game keeps running while they think — the clock
doesn't wait for anybody.

**It says the port is in use.** Something else is on 5000. Close it, or start the
game with a different port: `PORT=5050 ./run.sh` (Mac/Linux) or
`set PORT=5050 && run.bat` (Windows).

**I want a different island.** Stop the game and start it again — a new island
and a new set of survivors are generated every time.

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

## Updating later

**Double-click `update.bat`** (Windows) or run `./update.sh` (Mac/Linux). It
downloads the latest version, drops it over the top, and starts the game.

Your settings and your installed packages are kept — settings live in
`%APPDATA%\castaway` on Windows and `~/.config/castaway` on Mac/Linux, *outside*
the game folder, precisely so that replacing the folder can't lose them.

> **`git pull` doesn't work for me.** If you got this as a ZIP, there's no git
> repository in the folder for git to pull into — nothing to do with being
> logged in. `update.bat` is the ZIP equivalent, and it's one click.

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
- **T** gets everyone nearby to **stop and have a proper conversation**. They
  stand still until you break it up, so you can go back and forth instead of
  shouting one line at someone who's already walking away.
  In a group, **say someone's name** and only they answer — *"Ike, where's the
  water?"* Clicking their name at the top types it for you. Otherwise whoever
  you're nearest takes it, and the others chip in if they feel like it.
- **G** stops you where you stand and shows **what you know** — who you've met,
  what they make of you, what the raft still needs. The survivors have the same
  verb; when they use it they go back through their own memory instead.
- The small buttons under the actions are **emotes**. Most only reach people
  standing near you. **Scream** carries right across the island — it's the only
  way to reach someone you haven't found yet, and everybody hears it.

**Tell them your name.** To them you're "the stranger" until you say otherwise.
Type *"I'm Jo"* and everyone in earshot will remember it and start using it.

**Don't die of thirst.** The strip under the map always tells you where you are
and what to press. Walk to the spring, press **E** a few times to fill up, then
**Q** to drink. You start with two waters, which is enough to get there.

You start alone and you don't know whether anyone else survived. Walk around
until you find someone — the log tells you when something's near. The chat panel
shows what everyone says; **talk only** filters out the world events.

If you die, there's a button to wash up on a fresh island.

To stop the game, close the black window (or press **Ctrl+C** in it).

---

## When something goes wrong

**The browser didn't open.** Type `http://127.0.0.1:5000` into it yourself.

**It says setup failed and I have to install things by hand.** Fixed — but if
you have a half-built `.venv` folder from an older version, that was the cause:
the launcher checked for the *folder* rather than the Python inside it, so once
setup failed once it failed forever. It now notices and rebuilds. If it still
can't, it prints the real error and falls back to your main Python.

**Careful:** "Setup failed" and the game's **offline** badge are different
things. Setup is packages; **offline** is just which model plays the survivors,
which you pick in the browser. The old launcher said *"Are you online?"* when
pip failed, which made these look like the same problem. Sorry about that.

**It forgot my LM Studio settings after I updated.** It won't any more —
settings moved out of the game folder for exactly this reason. If you have an
old `settings.json` sitting next to `run.bat`, that one still wins; delete it
once and the per-user copy takes over.

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

**A smarter model fails but a small one works.** Almost always a reasoning
model. With structured output on, generation is locked to the schema from the
first token, so the model can't produce its `<think>` block and the request dies.
Leave **"Tell reasoning models not to think"** ticked in settings (it is by
default), or turn thinking off in LM Studio. The game also strips `<think>`
blocks if they arrive anyway.

**Survivors recite their own description instead of talking.** That's a small
model repeating its prompt. The game strips the worst of it, and **Prompt size:
auto** already sends local models a much shorter brief. If it's still bad, a 7B
instruct model behaves far better than a 2B.

**Somebody answered with "I can't help with that."** That's the model falling
out of the character and back into being a chat assistant. Those lines are
dropped now. It happened most when you opened with a bare "hello" — the game
forbids greeting somebody twice, which left nothing legal to say, so a
contentless greeting now tells them to say what's actually on their mind
instead.

**They keep saying hello, or repeating each other.** Also a small model. The
game now refuses greetings between people who've already met, and drops a reply
that's just an echo of the line before it — but the smaller the model, the more
often it has nothing else to offer. A 7B fixes it properly.

**The log is all muttering and I can't find what anyone said.** Click **talk**
at the top of the log. **+ events** adds what happened, **+ thoughts** adds
their inner monologue — that last one is off by default for exactly this reason.

**"Test connection" says no model is loaded.** Load a model in LM Studio first,
then press **refresh** in the game's settings.

**The survivors say something and then go quiet.** Small models sometimes run out
of room mid-sentence. Open settings (click the badge in the top-left) and raise
**Max tokens** to 2000.

**The survivors are slow.** That's your local model thinking, and the island now
slows down to match — the HUD shows `world ×0.5` when it does, so a slow model
costs you real minutes but not in-game daylight. If it's slower than you'd like:
drop **Max tokens** to around 500, and check the model actually fits in your
VRAM (once it spills to CPU, everything takes several times longer). Past about
eight seconds a reply the game also stops re-rolling lines that look like
repeats, since a second attempt doubles the wait.

**It says the port is in use.** Something else is on 5000. Close it, or start the
game with a different port: `PORT=5050 ./run.sh` (Mac/Linux) or
`set PORT=5050 && run.bat` (Windows).

**I want a different island.** Stop the game and start it again — a new island
and a new set of survivors are generated every time.

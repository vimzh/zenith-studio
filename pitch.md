

You already use Codex to build your games. Now you can let it design your game assets too.

This is Zenith Studio, running inside Codex’s browser. Through WebMCP, Codex can create, inspect, edit, animate, and export artwork directly on the same canvas I’m using. every tool you have, it has as well


## 1. Create a Character

Use Zenith Studio’s WebMCP tools to create a project called Moss Hollow.
pixels 128x128 a small knight with a moss-green helmet, bright red scarf, brown boots, and a short steel sword.
Full body, facing right, readable human proportions, clear separation between arms and legs.

Name the asset Moss Knight and classify it as a character.

**Voiceover:**

“I describe the character, and Codex creates an editable asset inside the project—not just an image attached to a chat.”

**Recording note:** Record the real generation. Cut or accelerate the wait, with an on-screen label.

## 2. Make a Precise Edit

**Prompt to Codex:**

```text
Use Zenith Studio’s WebMCP tools to recolor the open knight’s sword blade purple, with dark violet shading and a pale lavender highlight. Preserve its shape, outline, hilt, and the rest of the artwork.

```

**Voiceover:**

“Here’s where WebMCP matters. Codex reads the actual pixels, makes a targeted change, and checks the result.”

**On screen:** Manually undo and redo the edit.

**Voiceover:**

“And I still control the artwork. The agent’s edit is in my undo history.”

## 3. Animate the Character

**Prompt to Codex:**

```text
Use animate_procedural to add a subtle four-frame idle bob with a two-pixel amplitude.
Set every frame in the resulting animation to 250 milliseconds—four frames per second.

```

**Voiceover:**

“For simple motion, Codex uses deterministic animation tools. It doesn’t need to buy another generated image.”

**On screen:** Click Play manually. Playback control is not currently exposed through WebMCP.

## 4. Export the Finished Asset

**Prompt to Codex:**

```text
Export the animation as a GIF at 4× scale, preserving its authored frame timing.

Retrieve the complete file through read_export and save it as moss-knight-idle.gif in the workspace.

Also retrieve and save a Zenith project backup.
```

**Voiceover:**

“Codex can retrieve the finished files, so the workflow continues from designing the asset to using it in the game.”

## Optional: Generate a Matching Asset

**Prompt to Codex:**

```text
Use Moss Knight as a project style reference.

Generate a closed wooden treasure chest with moss, iron bands, and a brass lock.

Match the project’s palette and pixel-art treatment. Make it a separate item asset with a transparent background.

Keep the knight unchanged.
```

**Voiceover:**

“The project also provides a shared art direction, so I can build a collection of assets instead of starting from scratch each time.”

## Closing

**Voiceover:**

“Zenith Studio gives Codex a way to work directly inside a creative tool, while keeping the artist in control.

One canvas, editable assets, and a workflow from the first idea to the exported file.”

**On screen:** Show the finished animation, verified live URL, and public repository URL.

## Submission Notes

- Keep the submission video under three minutes.
- Publish it publicly on YouTube with audible narration.
- Show genuine external WebMCP calls causing visible canvas changes.
- Prioritize: character → precise edit → human undo → animation → export.
- Skip the optional matching-asset section if time is tight.
- Do not present accelerated generation as real-time performance.

[Official hackathon rules](https://webmcp.devpost.com/rules)
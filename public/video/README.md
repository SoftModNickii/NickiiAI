# The sequences

Drop the files here, named exactly as `config.js` lists them.

- `calm.mp4` — the 30 minute loop. The default state, with sound.
- `response-1.mp4` … `response-4.mp4` — the 5 minute answers, played in rotation
  when a visitor holds the button.

Shoot them **plain**: head and shoulders, even light, plain background, the same
framing as the live performance. Do not grade them and do not add the NICKII AI
look. The iPad applies the identical render pass the live feed uses, which is
what makes calm, response and live indistinguishable and lets the whole look be
retuned later from `config.render` without reshooting anything.

H.264 in an .mp4, at the resolution `config.capture` asks OBS for (1920x1080 by
default, or portrait if the iPad is mounted portrait). AAC audio.

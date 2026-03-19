# Champ Sage

## The problem

Every League tool out there (Mobalytics, Blitz, U.GG, Porofessor) works the same way: static win rates and tier lists decided before you queue up. They don't know what items you have, what the enemy team looks like, what augments you've already picked, or that your early choices just made an unconventional build path suddenly optimal. The "best" pick always depends on context, and no existing tool considers any of it.

On top of that, if you're not playing ranked Summoner's Rift, you're an afterthought. ARAM, Mayhem, Arena: these modes have their own decision complexity (especially augment-based modes), but tool support ranges from bare minimum to nonexistent. And none of them let you ask a question mid-game and get an answer back.

## What Champ Sage does

It's a voice-first AI coach that runs alongside League and actually knows what's happening in your game.

Press a hotkey, say "I got Typhoon, Quantum Computing, and Self Destruct, which should I pick?" and get a recommendation that factors in your champion, your items, your other augments, the enemy team comp, and mode-specific balance changes. No alt-tabbing. No generic tier lists. Or ask "what should I buy next?" and get an answer that knows your full build context. You can also just talk to it mid-game. "Their Vayne is shredding me, what should I adjust?" and get an actual answer, not a generic guide.

## How it works

Desktop app with an always-on-top window on your second monitor. Voice input via global hotkey (understands League terminology even when speech-to-text mangles it), or text if you'd rather type. Conversational, so you can ask follow-ups. Blunt by default, because you need a clear answer fast.

Under the hood, it automatically tracks your game state via the Riot API: your champion, items, gold, level, runes, stats, and the full enemy team, all in real time. For things the API doesn't expose (like augment choices), you just tell it. Instead of looking up a win rate, it sends your full game context to an AI model and gets back a recommendation that accounts for everything: your champion's kit, your build, the enemy team, and how they all interact.

## What's coming

The first version targets ARAM Mayhem with augment and item recommendations. After that: in-game overlay, augment set tracking, cross-game memory ("last game you went full AP against tanks and it didn't work out"), more modes (Arena, regular ARAM, Summoner's Rift), TTS so you can hear advice during a teamfight, and coaching style options.

## Why I'm building it

I've been playing a lot of ARAM Mayhem lately and really enjoying it, but I wanted a way to experiment with different ideas and playstyles, to ask "what if I tried this?" and get an answer that actually accounts for what's happening in the game. That tool doesn't exist, so I'm building one. It's a fun project, a chance to combine two things I enjoy spending time on.

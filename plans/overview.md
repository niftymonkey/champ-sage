# Champ Sage

## The problem

Every League tool out there (Mobalytics, Blitz, U.GG, Porofessor) works the same way: static win rates and tier lists decided before you queue up. They don't know what items you have, what the enemy team looks like, what augments you've already picked, or that your early choices just made an unconventional build path suddenly optimal. The "best" pick always depends on context, and no existing tool considers any of it.

On top of that, if you're not playing ranked Summoner's Rift, you're an afterthought. ARAM, Mayhem, Arena: these modes have their own decision complexity (especially augment-based modes), but tool support ranges from bare minimum to nonexistent. And none of them let you ask a question mid-game and get an answer back.

## What Champ Sage does

It's a voice-first AI coach that runs alongside League and actually knows what's happening in your game.

Press a hotkey, say "I got Typhoon, Quantum Computing, and Self Destruct, which should I pick?" and get a recommendation that factors in your champion, your items, your other augments, the enemy team comp, and mode-specific balance changes. No alt-tabbing. No generic tier lists. Or ask "what should I buy next?" and get an answer that knows your full build context.

It works because it combines two things:

1. **It watches your game.** The Riot API tells it your champion, items, gold, level, runes, stats, and the full enemy team, all automatically and in real time. For things the API doesn't expose (like augment choices), you just tell it.

2. **It reasons about context.** Instead of looking up a win rate, it sends your full game state to an AI model and gets back a recommendation that accounts for everything: your champion's kit, your build, the enemy team, and how they all interact.

You can also just talk to it mid-game. "Their Vayne is shredding me, what should I adjust?" It knows your full build and the enemy comp, so it gives you an actual answer, not a generic guide.

## How it works

- **Desktop app** that sits in an always-on-top window on your second monitor (and eventually as an in-game overlay)
- **Voice input** with a global hotkey. It understands League terminology (champion names, item names, augment names) even when speech-to-text mangles them
- **Text input** too, for when you don't want to talk
- **Automatic game tracking** by polling the Riot API every few seconds so it always knows the current state
- **Conversational.** It remembers what it told you earlier in the game, so you can ask follow-ups
- **Blunt by default.** Gives you a clear answer fast, not a hedged analysis

## What's coming

The first version targets ARAM Mayhem with augment and item recommendations. After that:

- **In-game overlay** so you don't need a second monitor
- **Mode-specific features** like augment set tracking, where it factors in whether completing a synergy set is worth taking a weaker individual pick
- **Cross-game memory** so it can say "last game you went full AP against a tank comp and it didn't work out"
- **More modes** like Arena, regular ARAM, even Summoner's Rift where it could advise based on how the game is progressing, how the enemy team is building, what objectives are in play
- **TTS** so you can hear recommendations without looking away during a teamfight
- **Coaching style options** like blunt, educational, whatever fits how you want to learn

## Why I'm building it

I've been playing a lot of ARAM lately and really enjoying it, but I wanted a way to experiment with different ideas and playstyles, to ask "what if I tried this?" and get an answer that actually accounts for what's happening in the game. That tool doesn't exist. The knowledge is out there, scattered across Reddit posts and YouTube videos, but nobody has built something that reasons about it in real time.

So I'm building one.

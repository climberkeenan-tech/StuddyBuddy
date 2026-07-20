/**
 * Bundled sample lecture powering StuddyBuddy's zero-setup demo mode.
 *
 * This is real teaching content — a natural, spoken Biology 101 lecture on DNA
 * replication — authored so that every downstream feature has something honest
 * to chew on with no microphone, no API keys, and no recording. The simulated
 * transcription provider replays these utterances on real timers, and
 * {@link importDemoLecture} turns them into a fully-structured transcript.
 *
 * The speech is deliberately varied so the heuristic pipeline has real signal:
 * definition sentences ("X is …"), explicit exam-emphasis cues, rhetorical
 * teacher questions, an analogy, a personal story, and natural topic shifts
 * that begin with discourse markers so the heading heuristic can carve the
 * lecture into sections.
 */

/** One spoken utterance with the timing needed to build a time-aligned transcript. */
export interface DemoUtterance {
  /** The professor's spoken words for this utterance. */
  text: string;
  /** How long the utterance takes to say, in milliseconds (~2.5–7s). */
  durationMs: number;
  /** Silence following the utterance before the next one begins, in milliseconds. */
  gapMs: number;
}

export interface DemoLecture {
  title: string;
  /** Course this demo belongs to, used when seeding a demo course. */
  courseHint: string;
  utterances: DemoUtterance[];
}

/**
 * "Biology 101 — DNA Replication". ~65 utterances, roughly 6–7 minutes of
 * spoken material. Larger gaps (>2.2s) sit at topic boundaries so the pause
 * and paragraph heuristics have something to detect; five utterances open with
 * discourse markers so the heading heuristic produces real sections.
 */
export const DEMO_LECTURE: DemoLecture = {
  title: 'Biology 101 — DNA Replication',
  courseHint: 'Biology 101',
  utterances: [
    // ——— Introduction ———
    {
      text: "Welcome back, everyone — settle in, because today we're tackling one of the most elegant processes in all of biology.",
      durationMs: 5600,
      gapMs: 700,
    },
    {
      text: 'Every single time one of your cells divides, it has to copy its entire genome — all three billion base pairs — with almost perfect accuracy.',
      durationMs: 6200,
      gapMs: 600,
    },
    {
      text: 'So how does a cell copy three billion base pairs quickly without making a mess?',
      durationMs: 4200,
      gapMs: 2600,
    },

    // ——— DNA Replication (heading 1) ———
    { text: "Okay, let's talk about DNA replication.", durationMs: 2800, gapMs: 700 },
    {
      text: 'The first big idea, the one everything else hangs on, is that replication is semiconservative.',
      durationMs: 5200,
      gapMs: 500,
    },
    {
      text: 'That means each new double helix keeps one old strand and one brand-new strand.',
      durationMs: 4600,
      gapMs: 600,
    },
    {
      text: 'This was shown by the famous Meselson and Stahl experiment back in nineteen fifty-eight.',
      durationMs: 5000,
      gapMs: 700,
    },
    {
      text: 'If you remember one thing from today, remember that replication is semiconservative.',
      durationMs: 5000,
      gapMs: 500,
    },
    {
      text: "It's the reason your DNA stays stable, generation after generation of cells.",
      durationMs: 4600,
      gapMs: 2600,
    },

    // ——— The enzymes (heading 2) ———
    {
      text: "Now let's meet the enzymes that actually make replication happen.",
      durationMs: 4000,
      gapMs: 600,
    },
    {
      text: 'Replication begins at specific spots on the chromosome that we call origins of replication.',
      durationMs: 5200,
      gapMs: 500,
    },
    {
      text: 'Helicase is the enzyme that unwinds the double helix at the replication fork.',
      durationMs: 4600,
      gapMs: 600,
    },
    {
      text: 'Think of the double helix like a zipper: helicase is the little slider that pulls the two halves apart as it travels along.',
      durationMs: 6400,
      gapMs: 700,
    },
    {
      text: 'As helicase unzips the strands, it opens up a Y-shaped region we call the replication fork.',
      durationMs: 5000,
      gapMs: 500,
    },
    {
      text: 'But single-stranded DNA is unstable, so binding proteins swoop in to keep the strands from snapping back together.',
      durationMs: 5800,
      gapMs: 800,
    },
    {
      text: "Now, here's the catch: DNA polymerase, the enzyme that actually builds the new strand, cannot start from scratch.",
      durationMs: 5800,
      gapMs: 600,
    },
    {
      text: 'It can only add nucleotides onto an existing piece — it needs something to build on.',
      durationMs: 4800,
      gapMs: 500,
    },
    { text: "And that is where primase comes in.", durationMs: 2600, gapMs: 500 },
    {
      text: 'Primase lays down a short RNA primer that gives polymerase a place to start.',
      durationMs: 4800,
      gapMs: 700,
    },
    {
      text: 'When I was a grad student, I once ran a replication assay overnight and forgot the primer entirely — and nothing copied at all, because polymerase had nowhere to begin.',
      durationMs: 6800,
      gapMs: 2600,
    },

    // ——— Leading strand (stays in the enzymes section) ———
    {
      text: 'With the primer in place, DNA polymerase gets to work, adding nucleotides one at a time.',
      durationMs: 5000,
      gapMs: 500,
    },
    {
      text: 'Polymerase can only build in one direction, from the five-prime end toward the three-prime end.',
      durationMs: 5200,
      gapMs: 600,
    },
    {
      text: 'On one of the two template strands, that direction points right toward the fork.',
      durationMs: 4600,
      gapMs: 500,
    },
    {
      text: 'That strand gets copied smoothly and continuously, and we call it the leading strand.',
      durationMs: 4800,
      gapMs: 600,
    },
    {
      text: 'The leading strand is the easy one: a single primer, and polymerase just cruises along.',
      durationMs: 4800,
      gapMs: 2600,
    },

    // ——— The lagging strand (heading 3) ———
    { text: 'Alright, moving on to the lagging strand.', durationMs: 3000, gapMs: 700 },
    {
      text: 'The other template strand runs in the opposite direction, and that causes a real headache.',
      durationMs: 5200,
      gapMs: 500,
    },
    {
      text: 'Polymerase cannot run continuously toward the fork here — it has to work backwards, away from it.',
      durationMs: 5400,
      gapMs: 600,
    },
    {
      text: 'So it builds the new strand in short, choppy pieces instead of one smooth run.',
      durationMs: 4600,
      gapMs: 500,
    },
    {
      text: 'An Okazaki fragment is a short stretch of DNA synthesized discontinuously on the lagging strand.',
      durationMs: 5600,
      gapMs: 600,
    },
    {
      text: 'Each Okazaki fragment needs its own RNA primer, so primase stays very busy on this strand.',
      durationMs: 5200,
      gapMs: 700,
    },
    {
      text: 'And why do we even bother caring about Okazaki fragments?',
      durationMs: 3600,
      gapMs: 800,
    },
    {
      text: "Because they're where a lot of exam questions, and a lot of real mutations, come from.",
      durationMs: 5000,
      gapMs: 600,
    },
    {
      text: 'Once the fragments are made, those RNA primers have to be removed and replaced with DNA.',
      durationMs: 5200,
      gapMs: 500,
    },
    {
      text: 'But that leaves tiny gaps, little nicks, sitting between neighboring fragments.',
      durationMs: 4600,
      gapMs: 600,
    },
    {
      text: 'Now, who can tell me what would happen if those nicks were never sealed?',
      durationMs: 4400,
      gapMs: 800,
    },
    {
      text: "You'd end up with a strand full of breaks — genetically, that's a disaster.",
      durationMs: 4400,
      gapMs: 500,
    },
    {
      text: 'DNA ligase is the enzyme that seals those nicks, joining the fragments into one continuous strand.',
      durationMs: 5800,
      gapMs: 600,
    },
    { text: 'So ligase is basically the molecular glue of replication.', durationMs: 3800, gapMs: 2600 },

    // ——— Proofreading (heading 4) ———
    { text: "Next, let's talk about proofreading and fidelity.", durationMs: 3400, gapMs: 700 },
    {
      text: "Here's something genuinely amazing: replication makes only about one mistake in ten billion bases.",
      durationMs: 5800,
      gapMs: 500,
    },
    { text: 'What on earth could make replication that accurate?', durationMs: 3400, gapMs: 700 },
    {
      text: "That accuracy doesn't come for free — it comes from proofreading.",
      durationMs: 4200,
      gapMs: 600,
    },
    {
      text: 'Many DNA polymerases carry a built-in proofreading function called three-prime to five-prime exonuclease activity.',
      durationMs: 6200,
      gapMs: 600,
    },
    {
      text: 'In plain English, when polymerase adds the wrong nucleotide, it can back up, snip it out, and try again.',
      durationMs: 5600,
      gapMs: 500,
    },
    {
      text: "It's like a careful typist who checks each letter and hits backspace the instant they mistype.",
      durationMs: 5200,
      gapMs: 600,
    },
    {
      text: 'This will be on the exam, so make sure you can explain how proofreading lowers the error rate.',
      durationMs: 5800,
      gapMs: 500,
    },
    {
      text: 'And after replication, separate repair systems come along and fix most of the mistakes that still slip through.',
      durationMs: 5800,
      gapMs: 2600,
    },

    // ——— PCR (heading 5) ———
    { text: 'Okay, moving on to why any of this matters — PCR.', durationMs: 3600, gapMs: 700 },
    {
      text: 'Everything we just described, the cell does naturally, but we can hijack the whole thing in the lab.',
      durationMs: 5400,
      gapMs: 500,
    },
    {
      text: 'PCR, the polymerase chain reaction, is basically DNA replication in a test tube.',
      durationMs: 5000,
      gapMs: 600,
    },
    { text: 'We use heat to separate the strands instead of helicase.', durationMs: 3600, gapMs: 500 },
    {
      text: 'We add short DNA primers ourselves instead of relying on primase.',
      durationMs: 4000,
      gapMs: 500,
    },
    {
      text: 'And we use a heat-stable polymerase called Taq that survives those high temperatures.',
      durationMs: 5000,
      gapMs: 600,
    },
    {
      text: 'Then we just cycle the temperature up and down, and the amount of DNA doubles every single round.',
      durationMs: 5400,
      gapMs: 500,
    },
    {
      text: "PCR is how we run COVID tests, paternity tests, forensics — honestly, it's everywhere.",
      durationMs: 5000,
      gapMs: 700,
    },
    {
      text: 'So the same four steps — unwind, prime, extend, seal — power both your cells and a huge chunk of modern biotech.',
      durationMs: 6400,
      gapMs: 2600,
    },

    // ——— Wrap-up (stays in the PCR section) ———
    { text: 'Let me pull all of this together before we run out of time.', durationMs: 3800, gapMs: 500 },
    {
      text: 'Replication is semiconservative: one old strand, one new strand, every time.',
      durationMs: 4400,
      gapMs: 500,
    },
    {
      text: 'Helicase unwinds, primase primes, polymerase extends, and ligase seals.',
      durationMs: 4600,
      gapMs: 500,
    },
    {
      text: 'The leading strand is continuous, while the lagging strand is built in Okazaki fragments.',
      durationMs: 5000,
      gapMs: 500,
    },
    {
      text: 'Proofreading keeps the error rate absurdly low, and PCR turns the whole process into a lab tool.',
      durationMs: 5400,
      gapMs: 600,
    },
    {
      text: 'For next class, read chapter twelve and try sketching the replication fork from memory.',
      durationMs: 5000,
      gapMs: 500,
    },
    {
      text: 'That sketch, by the way, is exactly the kind of thing I like to put on a test.',
      durationMs: 4600,
      gapMs: 500,
    },
    {
      text: "And that's replication — really nice work today, everyone; I'll see you Thursday.",
      durationMs: 4600,
      gapMs: 0,
    },
  ],
};

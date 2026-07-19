import { z } from "zod";


export const PHRASE_GRAMMAR_SCHEMA = "vocaloid-phrase-grammar/v1" as const;
export const PHRASE_GRAMMAR_VERSION = "1.0.0" as const;

export const PhraseGrammarCategorySchema = z.enum([
  "role",
  "entry",
  "contour",
  "rhythm",
  "motion",
  "cadence",
  "development",
  "allocation",
  "articulation",
  "space",
]);

export type PhraseGrammarCategory = z.infer<typeof PhraseGrammarCategorySchema>;

const PhraseGrammarIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);

export const PhraseGrammarComponentSchema = z.object({
  id: PhraseGrammarIdSchema,
  category: PhraseGrammarCategorySchema,
  label: z.string().min(1).max(96),
  use: z.string().min(1).max(320),
  invariants: z.array(z.string().min(1).max(240)).min(1).max(8),
  misuse_risks: z.array(z.string().min(1).max(240)).max(6).default([]),
  tags: z.array(z.string().min(1).max(48)).max(16).default([]),
  provenance: z.enum(["theory_curated", "listening_validated", "local_library_abstraction"]),
}).strict();

export type PhraseGrammarComponent = z.infer<typeof PhraseGrammarComponentSchema>;

function component(
  category: PhraseGrammarCategory,
  id: string,
  label: string,
  use: string,
  invariants: readonly string[],
  tags: readonly string[] = [],
  misuseRisks: readonly string[] = [],
): PhraseGrammarComponent {
  return PhraseGrammarComponentSchema.parse({
    id: `${category}.${id}`,
    category,
    label,
    use,
    invariants,
    misuse_risks: misuseRisks,
    tags,
    provenance: "theory_curated",
  });
}

export const PHRASE_GRAMMAR_COMPONENTS: readonly PhraseGrammarComponent[] = [
  component("role", "statement", "Statement", "Present one complete thought without requiring a melodic answer.", ["Give the phrase a perceivable destination.", "Do not imply closure solely through a high final note."], ["exposition"]),
  component("role", "continuation", "Continuation", "Carry the previous phrase forward while postponing full closure.", ["Preserve at least one recognizable relation to the source phrase.", "Use an open cadence or incomplete rhythmic release."], ["form", "open"]),
  component("role", "answer", "Answer", "Respond to a preceding phrase with a distinct destination or register.", ["Make the source phrase relation audible through rhythm, contour, or cadence.", "Change at least one structural dimension."], ["call-response"]),
  component("role", "contrast", "Contrast", "Break an established pattern to expose a new formal function.", ["Name the dimension being contrasted.", "Keep unrelated dimensions stable enough for the contrast to remain legible."], ["form", "variation"]),
  component("role", "lift", "Lift", "Increase forward pressure into the next section without spending the final climax.", ["Leave a remaining destination after the phrase.", "Avoid making every lift a simple continuous ascent."], ["pre-chorus", "transition"]),
  component("role", "release", "Release", "Resolve accumulated rhythmic, registral, or harmonic pressure.", ["Lengthen, simplify, descend, or leave space in a measurable way.", "Do not equate release with tonic closure in every case."], ["resolution"]),
  component("role", "hook", "Hook", "Establish the short identity-bearing cell intended to return.", ["Limit the cell to a recognizable bounded unit.", "Plan at least one later transformation instead of exact repetition everywhere."], ["motif", "chorus"]),
  component("role", "tag", "Tag / afterthought", "Add a short phrase after an apparent cadence or statement.", ["Be shorter or sparser than the phrase it follows.", "Use the offset or cadence to make the afterthought relationship clear."], ["coda", "afterthought"]),

  component("entry", "downbeat", "Downbeat entry", "Begin on the section or measure downbeat for a firm formal edge.", ["Reserve repeated downbeat entries for phrases that need that firmness."], ["strong"]),
  component("entry", "pickup-short", "Short pickup", "Enter one subdivision before the structural beat.", ["Land a meaningful syllable or target tone on the destination beat."], ["anacrusis", "flow"]),
  component("entry", "pickup-long", "Long pickup", "Begin a multi-note lead-in before the structural boundary.", ["Keep the pickup subordinate to its landing.", "Avoid treating the first pickup note as the phrase climax by accident."], ["anacrusis", "longline"]),
  component("entry", "delayed", "Delayed entry", "Leave space after the boundary before the first vocal onset.", ["The preceding tail or silence must remain audible.", "The delayed onset must still fit the lyric phrase."], ["space", "restraint"]),
  component("entry", "offbeat", "Offbeat entry", "Begin on a weak subdivision without functioning as a conventional pickup.", ["Maintain a perceivable pulse reference.", "Confirm consonant timing at the displaced onset."], ["syncopation"]),

  component("contour", "level", "Level / narrow", "Stay within a narrow band, using rhythm and text rather than pitch span for differentiation.", ["Include repeated or neighboring pitches.", "Declare where the eventual departure from the band occurs."], ["recitative", "restrained"]),
  component("contour", "rising", "Predominantly rising", "Move toward a higher destination with local interruptions allowed.", ["Identify the destination rather than merely accumulating steps.", "Avoid using the same rise for every preparatory phrase."], ["directional"]),
  component("contour", "falling", "Predominantly falling", "Move toward a lower destination or register release.", ["Shape the descent around target tones.", "Do not make every cadence a scalar fall."], ["directional", "release"]),
  component("contour", "arch", "Arch", "Rise to an interior peak and return toward the opening register.", ["Choose a meaningful peak window.", "Vary the ascent/descent proportions when the archetype returns."], ["balanced"], ["Overuse produces the rise-fall staircase cliché."]),
  component("contour", "valley", "Valley / inverted arch", "Descend to an interior low point, then recover.", ["Make the low point structurally audible.", "Do not duplicate the timing of an adjacent arch phrase."], ["inverted"]),
  component("contour", "plateau-fall", "Plateau then fall", "Hold a narrow upper or middle band before a later descent.", ["Use repeated pitches or small neighbors on the plateau.", "Delay the descent until a declared lyric or cadence point."], ["plateau", "release"]),
  component("contour", "rise-plateau", "Rise then plateau", "Reach the main register early and sustain it rather than immediately descending.", ["The plateau needs rhythmic or harmonic motion.", "Avoid extending high tessitura beyond the selected voice's comfort."], ["plateau", "chorus"]),
  component("contour", "early-peak", "Early peak", "Place the phrase maximum in the first third, then spend the phrase recovering or reframing it.", ["Do not exceed the early peak later in the phrase.", "Give the remaining phrase an independent destination."], ["asymmetric"]),
  component("contour", "late-peak", "Delayed peak", "Withhold the maximum until the last third.", ["Prepare the late peak through rhythm, harmony, or register.", "Do not assign this archetype to most phrases in the same section."], ["asymmetric", "climax"]),
  component("contour", "terrace-up", "Ascending terraces", "Move between two or more pitch plateaus rather than tracing a smooth scale.", ["Each terrace must persist long enough to be perceived.", "Use a clear transition event between levels."], ["sequence", "plateau"]),
  component("contour", "terrace-down", "Descending terraces", "Step down between stable pitch bands.", ["Preserve a repeated rhythmic or motivic identity across levels.", "End with an intentional cadence rather than running out of range."], ["sequence", "plateau"]),
  component("contour", "leap-hold-release", "Leap, hold, release", "Use one earned leap into a held target, followed by bounded recovery.", ["Prepare or contextualize the leap.", "Hold the destination long enough to differ from passing leaps.", "Recover or deliberately leave it unresolved."], ["anchor", "contrast"]),
  component("contour", "pendulum", "Pendulum", "Alternate around one or two anchor tones.", ["Keep the anchor perceptible.", "Vary interval size or rhythm before the pattern becomes mechanical."], ["oscillation", "motif"]),
  component("contour", "recitative-pedal", "Recitative over a pitch pedal", "Use repeated pitch with small inflections to privilege speech rhythm.", ["Let prosody determine onset and duration variation.", "Plan one departure tone for semantic or formal focus."], ["speech", "repeated-tone"]),
  component("contour", "asymmetric-wave", "Asymmetric wave", "Use unequal directional spans instead of repeated symmetric rise/fall arcs.", ["The two directional spans must differ in duration, range, or destination.", "Avoid repeating the same normalized wave in adjacent phrases."], ["variation"]),

  component("rhythm", "syllabic-even", "Even syllabic grid", "Place one lyric unit per regular subdivision for clarity.", ["Use only when diction or motor rhythm is the active purpose.", "Introduce duration contrast before it becomes the whole-song default."], ["clear", "grid"]),
  component("rhythm", "long-short-contrast", "Long/short contrast", "Alternate anchor durations with faster connecting material.", ["Long values must coincide with structural or semantic targets.", "Keep consonant-heavy units out of undersized cells."], ["contrast"]),
  component("rhythm", "syncopated-ties", "Syncopated ties", "Carry selected vowels across strong beats while onsets occur off the beat.", ["Tie vowels rather than re-triggering consonants.", "Retain enough pulse evidence in accompaniment or neighboring notes."], ["syncopation", "legato"]),
  component("rhythm", "pickup-flow", "Pickup flow", "Use anacrustic short values that resolve into a longer beat-aligned target.", ["The landing must be longer or otherwise stronger than the pickup.", "Do not repeat identical pickups at every line."], ["anacrusis"]),
  component("rhythm", "repeated-anchor", "Repeated-note anchor rhythm", "Repeat one pitch with changing durations or accents.", ["At least two repetitions must share pitch identity.", "Vary duration, lyric stress, or harmony under the anchor."], ["hook", "repeated-tone"]),
  component("rhythm", "sparse-breath", "Sparse breath-led rhythm", "Separate a few longer lyric gestures with meaningful rests.", ["Rests align with syntax, delivery, or form.", "Do not replace phrase-internal legato with uniform micro-gaps."], ["space", "slow"]),
  component("rhythm", "accelerating", "Local acceleration", "Shorten successive onset intervals toward a target.", ["Name the target and stop the acceleration there.", "Keep the shortest cells singable for the selected phonemes."], ["trajectory"]),
  component("rhythm", "decelerating", "Local deceleration", "Lengthen successive values into a release or destination.", ["Make the final lengthening perceptible.", "Avoid adding equal terminal rests to every phrase."], ["trajectory", "release"]),
  component("rhythm", "compound-lilt", "Compound-meter lilt", "Group subdivisions to expose 6/8, 9/8, or 12/8 pulse rather than a flat small-note grid.", ["Declare the grouping pattern.", "Align lyric stress with at least some group heads."], ["compound-meter"]),
  component("rhythm", "hemiola", "Hemiola", "Temporarily project a competing grouping across the notated meter.", ["Bracket the hemiola with a stable pulse before or after.", "Use it as a local event, not an unexplained meter error."], ["cross-rhythm"]),
  component("rhythm", "anticipatory-rest", "Anticipatory rest", "Leave a rest immediately before the phrase's focus event.", ["The rest must be large enough to hear.", "Do not compensate by over-accenting every following parameter."], ["space", "focus"]),
  component("rhythm", "sustained-tail", "Sustained tail", "Spend the final portion of the phrase on one held vowel or tied target.", ["Choose an extendable vowel.", "Reserve vibrato or fall-away decisions for durations that can carry them."], ["release", "vowel"]),

  component("motion", "stepwise", "Stepwise field", "Use mostly seconds within a bounded pitch collection.", ["Combine with repeated tones, target leaps, or rhythmic contrast when used across several phrases."], ["singable"]),
  component("motion", "repeated-tone", "Repeated-tone field", "Use unison repetitions as real melodic material.", ["Change duration, accent, harmony, or lyric function across repetitions.", "Avoid identical machine-like articulation unless explicitly selected."], ["speech", "anchor"]),
  component("motion", "leap-recovery", "Prepared leap and recovery", "Use a leap as a bounded event followed by stepwise or contrary recovery.", ["Identify preparation and recovery events.", "Keep the leap rare enough to retain identity."], ["contrast"]),
  component("motion", "chord-outline", "Chord-tone outline", "Project harmony through selected arpeggiated chord tones.", ["Connect outlines with singable voice leading.", "Avoid turning every syllable into a chord-tone arpeggio."], ["harmonic"]),
  component("motion", "neighbor-tone", "Neighbor-tone cell", "Orbit a stable pitch with upper or lower neighbors.", ["Return to or deliberately evade the anchor.", "Vary rhythm or neighbor direction on repetition."], ["ornament", "motif"]),
  component("motion", "appoggiatura", "Appoggiatura emphasis", "Approach a stable tone with one accented non-chord tone and resolve.", ["The dissonance and resolution must be temporally legible.", "Do not apply to every semantic focus."], ["dissonance", "resolution"]),
  component("motion", "pentatonic-gap", "Pentatonic gap motion", "Use skips implied by a pentatonic collection instead of filling every scale step.", ["Declare the active pitch collection.", "Check the skipped motion against vocal tessitura and harmony."], ["pentatonic", "modal"]),
  component("motion", "modal-pivot", "Modal pivot tone", "Use one stable common tone while harmony or surrounding scale color changes.", ["Keep the pivot audible through duration or repetition.", "Document the local pitch context rather than treating it as an arbitrary chromatic note."], ["modal", "pedal"]),
  component("motion", "sequence-cell", "Sequential cell", "Transpose a short interval/rhythm cell through two or more levels.", ["Bound the cell length.", "Change or break the sequence at its destination."], ["sequence", "development"]),

  component("cadence", "tonic-closed", "Closed tonic cadence", "End with strong tonal and rhythmic closure.", ["Reserve repeated strong closure for formal endpoints.", "Confirm the final lyric and breath support closure."], ["closed"]),
  component("cadence", "third-soft", "Soft third cadence", "End on a stable chord third rather than the root.", ["Confirm chord membership and register.", "Leave enough harmonic context to hear stability."], ["soft", "closed"]),
  component("cadence", "dominant-open", "Dominant/open cadence", "End with dominant-function or scale-degree tension that asks for continuation.", ["Provide a later continuation or resolution.", "Avoid using an exposed leading tone without context."], ["open"]),
  component("cadence", "suspended-open", "Suspended open cadence", "End on a held suspension or added tone without immediate resolution.", ["Make the supporting harmony explicit.", "Decide whether the resolution occurs in the next phrase or remains absent."], ["open", "color"]),
  component("cadence", "deceptive", "Deceptive cadence", "Redirect an expected close into a different harmonic destination.", ["Establish enough expectation for the redirection to register.", "Do not use merely as a surprising chord label."], ["redirect"]),
  component("cadence", "plagal", "Plagal release", "Use subdominant-to-tonic or related modal release.", ["Preserve voice-leading clarity.", "Differentiate it from the main dominant close."], ["release", "modal"]),
  component("cadence", "breath-cut", "Breath-cut cadence", "End through a deliberately short release and following silence rather than tonal finality.", ["The cut is a phrase-level event, not a micro-gap after every note.", "Keep the following silence audible."], ["space", "open"]),
  component("cadence", "downward-release", "Downward release cadence", "Resolve through a bounded descending gesture into a stable or intentionally open target.", ["Avoid cloning the same scalar descent across adjacent phrases.", "Name the destination scale degree or chord role."], ["release"]),

  component("development", "new", "New material", "Introduce a phrase without claiming derivation from a previous motif.", ["Keep its formal role explicit.", "Do not label arbitrary variation as new merely to bypass comparison."], ["origin"]),
  component("development", "exact-repeat", "Exact repeat", "Repeat pitch and rhythm deliberately as a recognizable return.", ["Bind the source phrase ID.", "Use sparingly and preserve lyric/prosody compatibility."], ["repeat"]),
  component("development", "varied-repeat", "Varied repeat", "Retain a recognizable cell while changing one or two declared dimensions.", ["Bind the source phrase ID.", "Name preserved and changed dimensions."], ["repeat", "variation"]),
  component("development", "sequence-up", "Sequence upward", "Transpose a source cell upward while preserving its identity.", ["Bind the source phrase ID.", "Set a destination and stop condition."], ["sequence"]),
  component("development", "sequence-down", "Sequence downward", "Transpose a source cell downward while preserving its identity.", ["Bind the source phrase ID.", "Set a destination and stop condition."], ["sequence"]),
  component("development", "fragment", "Fragmentation", "Reuse only a bounded sub-cell of the source phrase.", ["Bind the source phrase ID and fragment boundary.", "Place the fragment in a new formal context."], ["motif", "variation"]),
  component("development", "augmentation", "Rhythmic augmentation", "Lengthen the source rhythm while preserving pitch or interval identity.", ["Bind the source phrase ID.", "Declare the augmentation relation approximately or exactly."], ["rhythm", "variation"]),
  component("development", "diminution", "Rhythmic diminution", "Shorten the source rhythm while preserving identity.", ["Bind the source phrase ID.", "Recheck consonant and onset density budgets."], ["rhythm", "variation"]),
  component("development", "rhythmic-displacement", "Rhythmic displacement", "Move a source cell to a different metrical position.", ["Bind the source phrase ID.", "Preserve enough cell identity for comparison."], ["rhythm", "syncopation"]),
  component("development", "inversion", "Interval inversion", "Invert the direction of a bounded interval cell.", ["Bind the source phrase ID and cell.", "Allow diatonic adjustment when strict inversion harms the active harmony."], ["pitch", "variation"]),

  component("allocation", "syllabic", "Syllabic allocation", "Use one lyric unit per sounded note.", ["Phrase-internal connections should not create uniform micro-gaps.", "Use duration contrast rather than one grid value everywhere."], ["diction"]),
  component("allocation", "focus-melisma", "Focus melisma", "Repeat one lyric unit across several notes at a declared focus.", ["Use an extendable vowel.", "Keep the melisma bounded and semantically located."], ["focus", "vowel"]),
  component("allocation", "held-vowel", "Held vowel", "Lengthen one lyric vowel without adding pitch events.", ["Budget the consonant before the held vowel.", "Select a duration that supports the intended tuning gesture."], ["legato", "vowel"]),
  component("allocation", "consonant-pickup", "Consonant pickup", "Place a consonant-bearing lyric onset before its target beat so the vowel lands on it.", ["Keep the audible vowel destination aligned.", "Verify the target voicebank's consonant timing by audition."], ["diction", "anacrusis"]),
  component("allocation", "tied-vowel", "Tied vowel continuation", "Carry an existing vowel into another rhythmic cell without retriggering the lyric.", ["Use explicit repeated lyric index / continuation phoneme.", "Do not tie consonant-final units that cannot sustain."], ["legato", "syncopation"]),
  component("allocation", "repeated-mora", "Repeated mora articulation", "Repeat a lyric unit as a deliberate rhythmic or rhetorical event.", ["Differentiate deliberate repetition from accidental duplicate alignment.", "Audit consonant density."], ["repetition"]),
  component("allocation", "sparse-text", "Sparse text setting", "Use fewer lyric onsets and spend more time on selected vowels or rests.", ["Preserve intelligible syntax.", "Do not stretch every unit uniformly."], ["space", "longline"]),

  component("articulation", "legato-flow", "Legato flow", "Connect phrase-internal vowels with near-continuous energy.", ["Use 98–100% gate or explicit tied-vowel behavior inside the legato span.", "Place audible breaths only at declared boundaries."], ["connected"]),
  component("articulation", "connected-accent", "Connected with selective accents", "Keep the line connected while emphasizing only named events.", ["Accent density remains bounded.", "Do not shorten every unaccented note."], ["connected", "focus"]),
  component("articulation", "detached", "Detached articulation", "Use audible separation as a deliberate local texture.", ["Declare the span and minimum gap.", "Do not apply globally by default.", "Compare against a connected rendering at equal loudness."], ["staccato"]),
  component("articulation", "breath-led", "Breath-led onset", "Allow selected onsets to begin with audible breath energy.", ["Bind the effect to specific phrase positions.", "Keep broad-band breath from being mistaken for mix noise through dry audition."], ["breath", "voicebank"]),
  component("articulation", "delayed-vibrato", "Delayed vibrato", "Keep the note plain before vibrato enters late.", ["Use only on notes long enough to expose both phases.", "Do not use vibrato as a substitute for phrase shape."], ["tuning", "sustain"]),
  component("articulation", "plain-tone", "Plain-tone sustain", "Hold a stable tone without earned vibrato or pitch ornament.", ["Support interest through harmony, lyric, dynamics, or space.", "Confirm the voice does not become static unintentionally."], ["tuning", "restrained"]),

  component("space", "no-internal-rest", "Continuous span", "Use no explicit rest inside the selected phrase span.", ["Keep breath feasibility and gate continuity under review."], ["longline"]),
  component("space", "semantic-breath", "Semantic breath", "Place a breath at a syntax or meaning boundary.", ["Bind the rest to a lyric boundary.", "Use a perceptible rest rather than a micro-gap after each mora."], ["breath", "syntax"]),
  component("space", "mid-phrase-caesura", "Mid-phrase caesura", "Split one phrase into two audible clauses.", ["The second clause must answer, continue, or reframe the first.", "Vary caesura placement across neighboring lines."], ["clause", "contrast"]),
  component("space", "delayed-entry-space", "Boundary silence", "Use silence before the first onset as part of the phrase.", ["Preserve the prior tail or room tone.", "Do not fill the space automatically with extra accompaniment."], ["entry", "silence"]),
  component("space", "tail-rest", "Tail rest", "Leave a measured rest after the final vocal event.", ["Choose its length from form and handoff needs.", "Avoid identical terminal rests on every line."], ["release", "handoff"]),
  component("space", "interruption", "Interrupted phrase", "Stop before the expected completion and resume later or leave it absent.", ["Establish enough expectation for the interruption to register.", "Bind the continuation if one exists."], ["open", "dramatic"]),
] as const;

const ComponentById = new Map(PHRASE_GRAMMAR_COMPONENTS.map((entry) => [entry.id, entry]));

export const PhraseGrammarBundleSchema = z.object({
  id: PhraseGrammarIdSchema,
  label: z.string().min(1).max(96),
  scope: z.enum(["voice", "genre", "delivery", "form", "hybrid"]),
  description: z.string().min(1).max(480),
  option_component_ids: z.array(PhraseGrammarIdSchema).min(4).max(48),
  variation_axes: z.array(PhraseGrammarCategorySchema).min(1).max(10),
  avoid_as_default: z.array(z.string().min(1).max(240)).max(8),
  selection_policy: z.literal("unordered_option_pool"),
  melody_material: z.literal("absent"),
  provenance: z.enum(["theory_curated", "listening_validated", "local_library_abstraction"]),
}).strict();

export type PhraseGrammarBundle = z.infer<typeof PhraseGrammarBundleSchema>;

function bundle(
  id: string,
  label: string,
  scope: PhraseGrammarBundle["scope"],
  description: string,
  componentIds: readonly string[],
  variationAxes: readonly PhraseGrammarCategory[],
  avoidAsDefault: readonly string[],
): PhraseGrammarBundle {
  return PhraseGrammarBundleSchema.parse({
    id,
    label,
    scope,
    description,
    option_component_ids: componentIds,
    variation_axes: variationAxes,
    avoid_as_default: [
      "This bundle is an unordered option pool; never apply every listed component as one phrase template.",
      ...avoidAsDefault,
    ],
    selection_policy: "unordered_option_pool",
    melody_material: "absent",
    provenance: "theory_curated",
  });
}

export const PHRASE_GRAMMAR_BUNDLES: readonly PhraseGrammarBundle[] = [
  bundle("ia.transparent-longline", "IA transparent long line", "voice", "Connected, vowel-aware IA writing with selective pitch departure and audible phrase space; a palette of choices, not an automatic voice recipe.", ["role.statement", "entry.pickup-short", "contour.plateau-fall", "rhythm.long-short-contrast", "motion.repeated-tone", "motion.stepwise", "cadence.third-soft", "development.varied-repeat", "allocation.held-vowel", "articulation.legato-flow", "articulation.plain-tone", "space.semantic-breath"], ["entry", "contour", "cadence", "space"], ["Do not select legato, plateau, and soft cadence for every phrase.", "Do not infer emotional success from voice identity."]),
  bundle("ia.rocks-forward", "IA_ROCKS forward articulation", "voice", "Forward onsets, bounded leap events, and rhythmic contrast suitable for testing IA_ROCKS without globally detaching every mora.", ["role.hook", "entry.pickup-short", "contour.leap-hold-release", "rhythm.syncopated-ties", "rhythm.repeated-anchor", "motion.leap-recovery", "motion.chord-outline", "cadence.tonic-closed", "development.rhythmic-displacement", "allocation.consonant-pickup", "articulation.connected-accent", "space.tail-rest"], ["role", "entry", "rhythm", "articulation"], ["Detached articulation is local and must be A/B tested.", "Do not boost presence merely because the voice is IA_ROCKS."]),
  bundle("ia.close-confession", "Close IA confession", "delivery", "Speech-shaped, narrow-register writing that derives motion from prosody, harmony, and one selective departure tone.", ["role.statement", "entry.delayed", "contour.recitative-pedal", "rhythm.sparse-breath", "motion.repeated-tone", "motion.neighbor-tone", "cadence.suspended-open", "development.varied-repeat", "allocation.sparse-text", "articulation.breath-led", "articulation.plain-tone", "space.semantic-breath"], ["cadence", "motion", "space"], ["Breath-led tone must be checked in dry audio.", "Narrow register does not justify identical rhythm fingerprints."]),
  bundle("jpop.hook-contrast", "J-pop hook contrast", "genre", "Phrase-to-phrase contrast built from pickup, repeated anchor, and transformed return rather than a sequence of identical arches.", ["role.hook", "entry.pickup-short", "contour.rise-plateau", "rhythm.repeated-anchor", "rhythm.long-short-contrast", "motion.sequence-cell", "motion.repeated-tone", "cadence.tonic-closed", "development.varied-repeat", "allocation.syllabic", "articulation.connected-accent", "space.tail-rest"], ["contour", "rhythm", "development", "cadence"], ["Do not make every chorus line a rising arch.", "Return identity should survive at least one transformed version."]),
  bundle("rock.call-response", "Rock call and response", "genre", "Alternating firm statements and displaced answers with bounded leaps and contrasting cadence strength.", ["role.answer", "entry.offbeat", "contour.terrace-up", "rhythm.syncopated-ties", "motion.chord-outline", "motion.leap-recovery", "cadence.dominant-open", "development.sequence-up", "allocation.consonant-pickup", "articulation.connected-accent", "space.mid-phrase-caesura"], ["role", "entry", "cadence", "development"], ["Do not duplicate the call's register and cadence in the answer."]),
  bundle("ballad.suspended-release", "Suspended ballad release", "genre", "Long values, withheld resolution, and asymmetrical release without requiring constant upward motion.", ["role.release", "entry.delayed", "contour.early-peak", "rhythm.sustained-tail", "rhythm.decelerating", "motion.appoggiatura", "motion.stepwise", "cadence.plagal", "development.augmentation", "allocation.held-vowel", "articulation.delayed-vibrato", "space.delayed-entry-space"], ["contour", "cadence", "articulation", "space"], ["Long notes need harmonic and lyric support.", "Delayed vibrato is earned, not a global preset."]),
  bundle("compound.floating", "Compound-meter floating line", "hybrid", "6/8–12/8 grouping, pickup flow, and tied vowels that expose compound pulse without filling every subdivision.", ["role.continuation", "entry.pickup-long", "contour.asymmetric-wave", "rhythm.compound-lilt", "rhythm.syncopated-ties", "motion.pentatonic-gap", "cadence.suspended-open", "development.rhythmic-displacement", "allocation.tied-vowel", "articulation.legato-flow", "space.semantic-breath"], ["entry", "rhythm", "motion", "cadence"], ["Declare grouping instead of relying on a flat 120-tick grid."]),
  bundle("wa.modal-narrative", "Wa/modal narrative", "genre", "Pentatonic or modal pitch gaps, pivot tones, and speech-shaped timing without treating scale labels as surface decoration.", ["role.statement", "entry.pickup-short", "contour.terrace-down", "rhythm.long-short-contrast", "motion.pentatonic-gap", "motion.modal-pivot", "cadence.plagal", "development.fragment", "allocation.syllabic", "articulation.plain-tone", "space.mid-phrase-caesura"], ["motion", "cadence", "rhythm", "space"], ["Declare pitch material and harmony explicitly.", "Do not imitate a reference melody or ornamental stereotype."]),
  bundle("electronic.motoric", "Electronic motoric phrase", "genre", "Grid identity and repeated anchors with planned breaks, displacement, and one contrasting sustained event.", ["role.hook", "entry.offbeat", "contour.pendulum", "rhythm.syllabic-even", "rhythm.repeated-anchor", "motion.repeated-tone", "motion.sequence-cell", "cadence.breath-cut", "development.rhythmic-displacement", "allocation.repeated-mora", "articulation.detached", "space.interruption"], ["entry", "rhythm", "articulation", "space"], ["Detached gate is local, measured, and not a default for the rest of the song.", "Include a break or duration contrast before repetition becomes inert."]),
  bundle("night.sparse-distance", "Sparse distant nightscape", "hybrid", "Delayed entries, narrow plateaus, open cadences, and audible gaps suited to large perceived space without prescribing sadness or a source song.", ["role.continuation", "entry.delayed", "contour.plateau-fall", "rhythm.sparse-breath", "motion.repeated-tone", "motion.modal-pivot", "cadence.suspended-open", "development.varied-repeat", "allocation.sparse-text", "articulation.legato-flow", "articulation.plain-tone", "space.delayed-entry-space", "space.tail-rest"], ["role", "contour", "cadence", "space"], ["Do not use the same late peak and terminal rest on every line.", "Space belongs in note/rest structure before reverb is added."]),
] as const;

for (const selectedBundle of PHRASE_GRAMMAR_BUNDLES) {
  for (const componentId of selectedBundle.option_component_ids) {
    if (!ComponentById.has(componentId)) {
      throw new Error(`Phrase-grammar bundle ${selectedBundle.id} references unknown component ${componentId}`);
    }
  }
}

const BundleById = new Map(PHRASE_GRAMMAR_BUNDLES.map((entry) => [entry.id, entry]));

const CategorySelectionSchema = z.object({
  role: PhraseGrammarIdSchema,
  entry: PhraseGrammarIdSchema,
  contour: z.array(PhraseGrammarIdSchema).min(1).max(2),
  rhythm: z.array(PhraseGrammarIdSchema).min(1).max(3),
  motion: z.array(PhraseGrammarIdSchema).min(1).max(3),
  cadence: PhraseGrammarIdSchema,
  development: PhraseGrammarIdSchema,
  allocation: z.array(PhraseGrammarIdSchema).min(1).max(3),
  articulation: z.array(PhraseGrammarIdSchema).min(1).max(3),
  space: z.array(PhraseGrammarIdSchema).min(1).max(3),
}).strict();

export const PhraseGrammarBlueprintSchema = z.object({
  schema: z.literal(PHRASE_GRAMMAR_SCHEMA).default(PHRASE_GRAMMAR_SCHEMA),
  id: PhraseGrammarIdSchema,
  melody_authorship: z.enum(["agent_composed", "human_composed", "co_composed"]).default("agent_composed"),
  bundle_usage: z.literal("selection_only").default("selection_only"),
  components: CategorySelectionSchema,
  source_bundle_ids: z.array(PhraseGrammarIdSchema).max(8).default([]),
  source_phrase_id: PhraseGrammarIdSchema.optional(),
  preserve_dimensions: z.array(PhraseGrammarCategorySchema).max(10).default([]),
  change_dimensions: z.array(PhraseGrammarCategorySchema).max(10).default([]),
  limits: z.object({
    range_semitones: z.tuple([z.number().int().min(0).max(48), z.number().int().min(0).max(48)]).optional(),
    peak_window: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    repeated_pitch_ratio: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    stepwise_ratio: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
    maximum_leap_semitones: z.number().int().min(0).max(24).optional(),
    maximum_consecutive_direction: z.number().int().min(1).max(32).optional(),
  }).strict().default({}),
  note: z.string().min(1).max(1000).optional(),
}).strict().superRefine((blueprint, context) => {
  const expected: Array<[PhraseGrammarCategory, readonly string[]]> = [
    ["role", [blueprint.components.role]],
    ["entry", [blueprint.components.entry]],
    ["contour", blueprint.components.contour],
    ["rhythm", blueprint.components.rhythm],
    ["motion", blueprint.components.motion],
    ["cadence", [blueprint.components.cadence]],
    ["development", [blueprint.components.development]],
    ["allocation", blueprint.components.allocation],
    ["articulation", blueprint.components.articulation],
    ["space", blueprint.components.space],
  ];
  for (const [category, ids] of expected) {
    for (const id of ids) {
      const selected = ComponentById.get(id);
      if (!selected) {
        context.addIssue({ code: "custom", path: ["components", category], message: `Unknown phrase-grammar component ${id}` });
      } else if (selected.category !== category) {
        context.addIssue({ code: "custom", path: ["components", category], message: `${id} is ${selected.category}, not ${category}` });
      }
    }
  }
  for (const id of blueprint.source_bundle_ids) {
    if (!BundleById.has(id)) context.addIssue({ code: "custom", path: ["source_bundle_ids"], message: `Unknown phrase-grammar bundle ${id}` });
  }
  for (const [name, pair] of Object.entries(blueprint.limits)) {
    if (Array.isArray(pair) && pair.length === 2 && pair[0]! > pair[1]!) {
      context.addIssue({ code: "custom", path: ["limits", name], message: `${name} lower bound must not exceed upper bound` });
    }
  }
  const relational = blueprint.components.development !== "development.new";
  if (relational && !blueprint.source_phrase_id) {
    context.addIssue({ code: "custom", path: ["source_phrase_id"], message: `${blueprint.components.development} requires source_phrase_id` });
  }
  if (blueprint.components.articulation.includes("articulation.detached")
    && blueprint.components.articulation.includes("articulation.legato-flow")) {
    context.addIssue({ code: "custom", path: ["components", "articulation"], message: "Select detached or legato-flow for one blueprint span, not both" });
  }
  if (blueprint.components.space.includes("space.no-internal-rest")
    && blueprint.components.space.some((id) => ["space.semantic-breath", "space.mid-phrase-caesura", "space.interruption"].includes(id))) {
    context.addIssue({ code: "custom", path: ["components", "space"], message: "space.no-internal-rest conflicts with an internal rest component" });
  }
});

export type PhraseGrammarBlueprint = z.infer<typeof PhraseGrammarBlueprintSchema>;

export function phraseGrammarIndex() {
  const categoryCounts = Object.fromEntries(PhraseGrammarCategorySchema.options.map((category) => [
    category,
    PHRASE_GRAMMAR_COMPONENTS.filter((entry) => entry.category === category).length,
  ]));
  return {
    schema: PHRASE_GRAMMAR_SCHEMA,
    version: PHRASE_GRAMMAR_VERSION,
    boundary: {
      purpose: "A deterministic vocabulary for agent-selected phrase plans; it never generates the next note.",
      bundle_semantics: "Every bundle is an unordered option pool. Component order is meaningless and selecting a bundle never fills a phrase blueprint.",
      melody_authorship: "The agent composes concrete pitch, scale-degree, onset, and duration material from intent, lyrics/prosody, harmony, and form.",
      runtime_corpus_access: "forbidden",
      local_library_role: "Offline analysis may motivate a new human-reviewed component or bundle, but production agents receive only this versioned DSL.",
      copying: "No source title, path, melody, chord sequence, lyric, nearest neighbor, or reconstructive contour belongs in a component.",
      judgement: "A blueprint is a hypothesis. Symbolic analysis tests measurable limits; loudness-matched listening decides whether it serves the phrase intent.",
    },
    categories: categoryCounts,
    total_components: PHRASE_GRAMMAR_COMPONENTS.length,
    bundles: PHRASE_GRAMMAR_BUNDLES.map((entry) => ({
      id: entry.id,
      label: entry.label,
      scope: entry.scope,
      description: entry.description,
      variation_axes: entry.variation_axes,
    })),
  };
}

export interface ListPhraseGrammarOptions {
  category?: PhraseGrammarCategory;
  bundleId?: string;
  query?: string;
  offset: number;
  limit: number;
}

export function listPhraseGrammar(options: ListPhraseGrammarOptions) {
  const bundleSelection = options.bundleId ? BundleById.get(options.bundleId) : undefined;
  if (options.bundleId && !bundleSelection) throw new Error(`Unknown phrase-grammar bundle ${options.bundleId}`);
  const bundleIds = bundleSelection ? new Set(bundleSelection.option_component_ids) : undefined;
  const query = options.query?.trim().toLocaleLowerCase("en-US");
  const selected = PHRASE_GRAMMAR_COMPONENTS.filter((entry) => {
    if (options.category && entry.category !== options.category) return false;
    if (bundleIds && !bundleIds.has(entry.id)) return false;
    if (!query) return true;
    return [entry.id, entry.label, entry.use, ...entry.tags].join(" ").toLocaleLowerCase("en-US").includes(query);
  });
  const items = selected.slice(options.offset, options.offset + options.limit);
  return {
    schema: PHRASE_GRAMMAR_SCHEMA,
    total: selected.length,
    count: items.length,
    offset: options.offset,
    has_more: options.offset + items.length < selected.length,
    ...(options.offset + items.length < selected.length ? { next_offset: options.offset + items.length } : {}),
    ...(bundleSelection ? { bundle: bundleSelection } : {}),
    items,
  };
}

export function validatePhraseGrammarBlueprint(input: unknown) {
  const parsed = PhraseGrammarBlueprintSchema.parse(input);
  const selectedIds = [
    parsed.components.role,
    parsed.components.entry,
    ...parsed.components.contour,
    ...parsed.components.rhythm,
    ...parsed.components.motion,
    parsed.components.cadence,
    parsed.components.development,
    ...parsed.components.allocation,
    ...parsed.components.articulation,
    ...parsed.components.space,
  ];
  const components = selectedIds.map((id) => ComponentById.get(id)!);
  return {
    schema: PHRASE_GRAMMAR_SCHEMA,
    valid: true as const,
    blueprint: parsed,
    selected_components: components,
    selected_bundles: parsed.source_bundle_ids.map((id) => BundleById.get(id)!),
    review_questions: [
      "Did the agent compose the concrete melody from intent, lyric prosody, harmony, and form rather than expand the bundle as a template?",
      "Which selected dimension gives this phrase a different formal job from its neighbors?",
      "Are repetition and variation bound to stable source phrase IDs rather than asserted from memory?",
      "Do actual note allocation, gate, rests, and cadence materialize the selected components?",
      "Does a loudness-matched audition support the phrase's existing listening question?",
    ],
  };
}

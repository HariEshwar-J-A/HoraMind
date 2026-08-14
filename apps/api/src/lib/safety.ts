/**
 * Guard rails around the model.
 *
 * `agent_config/agent.md` and `prediction-method.md` already state the rules —
 * no medical, legal or financial determinations, no death or illness
 * predictions, no fatalism — and those rules are in the system prompt. This
 * file exists because a rule in a prompt is a request, not a constraint. A
 * model that ignores it produces text indistinguishable from text that
 * followed it, and nothing downstream notices.
 *
 * Two screens, deliberately different in kind:
 *
 *   - `screenQuestion` runs on the way in and is about *instructions*. User
 *     text is quoted into a prompt alongside retrieved verses and stored
 *     memories, so a question can try to address the model rather than ask it
 *     something.
 *   - `screenAnswer` runs on the way out and is about *claims*. It is the only
 *     thing standing between a plausible sentence about someone's death and a
 *     user reading it.
 *
 * Both are conservative on purpose. A false positive costs a regenerated
 * paragraph; a false negative is the failure mode this product cannot have.
 */

/**
 * Phrases that try to reach past the question and address the model.
 *
 * Matching on intent rather than on the word "ignore": the aim is to catch the
 * shape of an instruction, because the vocabulary changes weekly and the shape
 * does not.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
    { re: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|system|all)\b/i,
      why: 'attempts to discard earlier instructions' },
    { re: /\b(you are now|from now on you|act as|pretend to be|roleplay as)\b/i,
      why: 'attempts to reassign the assistant a new role' },
    { re: /\b(system|developer)\s*(prompt|message|instructions?)\b/i,
      why: 'refers to the system prompt' },
    { re: /\b(reveal|show|print|repeat|output)\b[^.]{0,30}\b(prompt|instructions?|rules)\b/i,
      why: 'asks for the instructions to be disclosed' },
    { re: /<\/?(system|assistant|user|tool)>/i,
      why: 'contains role markup that could be read as a turn boundary' },
];

/**
 * Claims the reading must never make.
 *
 * Each carries the reason so a rejection can be logged usefully. The wording is
 * drawn from `prediction-method.md`: the boundary is a *determination* about a
 * regulated domain, not any mention of it. "Saturn's transit often coincides
 * with a period of reassessment about health" is a legitimate reading; "you
 * will develop a heart condition in March" is the thing being blocked.
 */
const PROHIBITED: ReadonlyArray<{ re: RegExp; why: string }> = [
    { re: /\byou (will|are going to|shall) (die|pass away|not survive)\b/i,
      why: 'predicts death' },
    { re: /\b(your|the) death\b[^.]{0,30}\b(will|is likely|occurs?|expected)\b/i,
      why: 'predicts death' },
    { re: /\byou (will|are going to) (develop|contract|suffer from|be diagnosed with)\b/i,
      why: 'predicts a medical diagnosis' },
    { re: /\b(cancer|tumou?r|stroke|heart attack|terminal)\b[^.]{0,40}\b(will|imminent|certain|inevitable)\b/i,
      why: 'predicts a specific illness' },
    { re: /\b(buy|sell|invest in|short)\b[^.]{0,25}\b(stock|shares?|crypto|bitcoin|property)\b/i,
      why: 'gives specific investment advice' },
    { re: /\byou (will|are certain to) (win|lose) (the|your) (case|lawsuit|trial)\b/i,
      why: 'predicts a legal outcome' },
    { re: /\b(cursed|doomed|fated to|no escape from|nothing can be done)\b/i,
      why: 'is fatalistic' },
    { re: /\bstop taking\b[^.]{0,25}\b(medication|medicine|treatment|prescription)\b/i,
      why: 'advises stopping medical treatment' },
];

export interface Screening {
    ok: boolean;
    /** Machine-readable reasons, safe to log — they name the rule, not the text. */
    reasons: string[];
}

const PASS: Screening = { ok: true, reasons: [] };

/**
 * Screen a user question before it reaches a prompt.
 *
 * Returns rather than throws: the caller decides whether a suspicious question
 * is refused outright or answered with the injection stripped, and that policy
 * belongs at the route, not here.
 */
export function screenQuestion(question: string): Screening {
    const reasons: string[] = [];
    for (const { re, why } of INJECTION_PATTERNS) {
        if (re.test(question)) reasons.push(why);
    }
    return reasons.length === 0 ? PASS : { ok: false, reasons };
}

/**
 * Screen generated prose before it reaches a user.
 *
 * The empty check is not a formality. An empty answer has already caused a 502
 * in this codebase when a provider returned a hollow 200, and an interpretation
 * screen that passes "" would render a blank reading as a successful one.
 */
export function screenAnswer(answer: string): Screening {
    if (answer.trim().length === 0) return { ok: false, reasons: ['is empty'] };

    const reasons: string[] = [];
    for (const { re, why } of PROHIBITED) {
        if (re.test(answer)) reasons.push(why);
    }
    return reasons.length === 0 ? PASS : { ok: false, reasons };
}

/**
 * The sentence appended when a regeneration still fails.
 *
 * Returning the offending text with a warning would defeat the point, and
 * returning an error tells the user the app is broken when it is in fact
 * working exactly as intended.
 */
export const REFUSAL =
    'That question runs into something this app will not answer — a medical, '
    + 'legal or financial determination, or a claim about how long someone has. '
    + 'The chart can describe a period\'s texture, not decide those. Try asking '
    + 'about the shape of the time rather than the outcome.';

/**
 * What the client actually receives.
 *
 * Screening and presentation used to live only in the route, so a test that
 * the refusal reaches the user had to spin up Postgres, a session and a model.
 * This is the one function that route calls; asserting it is asserting the
 * contract.
 */
export function presentAnswer(answer: string): string {
    return screenAnswer(answer).ok ? answer : REFUSAL;
}

/**
 * A per-user daily ceiling on model spend, in tokens.
 *
 * Distinct from the request quota, which counts *questions*. One user with a
 * long conversation and several tool rounds can cost more than twenty short
 * ones, so a question count alone does not bound the bill. Generous enough that
 * no ordinary use meets it, low enough that a loop cannot run all night.
 */
export const DAILY_TOKEN_CEILING: Record<string, number> = {
    free: 120_000,
    plus: 600_000,
    pro: 2_000_000,
};

export function ceilingFor(tier: string): number {
    return DAILY_TOKEN_CEILING[tier] ?? DAILY_TOKEN_CEILING.free!;
}

import { useNavigate } from 'react-router-dom';
import { Screen, Button, Txt, Box } from '../components/primitives.js';
import { Reveal, Stagger, StaggerItem } from '../components/motion.js';
import { HeroChart } from '../components/landing/HeroChart.js';
import { Panel, Rule, Section } from '@horamind/ui';
import { t } from '../lib/i18n.js';
import { brass, colors, fonts, space } from '../theme/tokens.js';

/**
 * Marketing page. Rendered at `/` when signed out.
 *
 * The hero is a live chart of the visitor's sky, not a screenshot. That is
 * the strongest thing the product can show: the diagram is real and being
 * computed while they watch. Everything below it is a claim the README
 * already makes, restated so someone who has not read the README can leave
 * knowing what they would be signing up for.
 */
export function Landing() {
    const navigate = useNavigate();
    const go = () => navigate('/sign-in');

    return (
        <Screen>
            <Reveal>
                <Box style={{ marginTop: space.xl, marginBottom: space.xl, textAlign: 'center' }}>
                    <Txt as="h1" style={{
                        fontSize: 42, fontWeight: '600', fontFamily: fonts.display,
                        color: brass.light, letterSpacing: 1,
                    }}>
                        {t('app.name')}
                    </Txt>
                    <Txt style={{
                        fontSize: 20, lineHeight: 28, marginTop: space.md, color: colors.text,
                    }}>
                        {t('landing.hero')}
                    </Txt>
                    <Txt style={{
                        fontSize: 14, color: colors.textMuted, marginTop: space.sm,
                    }}>
                        {t('app.tagline')}
                    </Txt>
                </Box>
            </Reveal>

            <Reveal delay={0.08}>
                <HeroChart />
            </Reveal>

            <Reveal delay={0.16}>
                <Box style={{ marginTop: space.xl, marginBottom: space.lg }}>
                    <Button label={t('landing.cta')} onPress={go} />
                    <Button
                        variant="ghost"
                        label={t('landing.signin')}
                        onPress={go}
                        style={{ marginTop: space.sm }}
                    />
                </Box>
            </Reveal>

            <Stagger delay={0.2}>
                <StaggerItem>
                    <Section title="Why this, not another app">
                        <Panel tone="lit">
                            <Diff title={t('landing.diff.ephemeris')} body={t('landing.diff.ephemeris.body')} />
                            <Rule />
                            <Diff title={t('landing.diff.corpus')} body={t('landing.diff.corpus.body')} />
                            <Rule />
                            <Diff title={t('landing.diff.model')} body={t('landing.diff.model.body')} />
                        </Panel>
                    </Section>
                </StaggerItem>

                <StaggerItem>
                    <Section title={t('landing.example.label')}>
                        <Panel>
                            <Txt style={{
                                fontSize: 12, fontFamily: fonts.mono, color: brass.mid,
                                marginBottom: space.sm,
                            }}>
                                {t('landing.example.q')}
                            </Txt>
                            <Txt style={{ fontSize: 16, lineHeight: 26, marginBottom: space.md }}>
                                {t('landing.example.answer')}
                            </Txt>
                            <Txt style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textFaint }}>
                                {t('landing.example.dasha')}
                            </Txt>
                            <Txt style={{
                                fontSize: 12, fontFamily: fonts.mono, color: colors.textFaint,
                                marginTop: space.xs,
                            }}>
                                {t('landing.example.cite')}
                            </Txt>
                        </Panel>
                    </Section>
                </StaggerItem>

                <StaggerItem>
                    <Section title="Privacy, plainly">
                        <Panel>
                            <Txt style={{ fontSize: 15, lineHeight: 24, color: colors.textMuted }}>
                                {t('landing.privacy')}
                            </Txt>
                        </Panel>
                    </Section>
                </StaggerItem>
            </Stagger>

            <Reveal delay={0.4}>
                <Box style={{ marginTop: space.lg, marginBottom: space.xxxl }}>
                    <Button label={t('landing.cta')} onPress={go} />
                </Box>
            </Reveal>
        </Screen>
    );
}

function Diff({ title, body }: { title: string; body: string }) {
    return (
        <Box>
            <Txt style={{ fontSize: 16, fontWeight: '600', marginBottom: space.sm }}>{title}</Txt>
            <Txt style={{ fontSize: 14, lineHeight: 22, color: colors.textMuted }}>{body}</Txt>
        </Box>
    );
}

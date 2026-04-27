import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useI18n } from '../../i18n/i18n'
import { supabase } from '../../lib/supabase'
import { SignalGateBackdrop } from './SignalGateBackdrop'
import { useAuth } from './AuthProvider'

export function LoginPage() {
  const { isLoading, session } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const redirectTo =
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof location.state.from === 'object' &&
    location.state.from !== null &&
    'pathname' in location.state.from &&
    typeof location.state.from.pathname === 'string'
      ? location.state.from.pathname
      : '/today'

  if (isLoading) {
    return (
      <div className="sg-loading">
        <div className="sg-loading-card">{t('auth.loadingSession')}</div>
      </div>
    )
  }

  if (session) {
    return <Navigate to={redirectTo} replace />
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setIsSubmitting(true)
    setErrorMessage(null)

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) setErrorMessage(error.message)
    setIsSubmitting(false)
  }

  return (
    <div className="sg-stage">
      <style>{signalGateStyles}</style>

      <SignalGateBackdrop />

      <main className="sg-shell">
        <section className="sg-copy" aria-label="SprintCRM product introduction">
          <div className="sg-eyebrow">
            <span />
            Quiet Operator Console
          </div>

          <h1>SprintCRM</h1>

          <p className="sg-subtitle">
            A focused outbound workspace for importing leads, managing daily actions, and keeping pipeline work under
            control.
          </p>

          <div className="sg-modules">
            <article className="sg-module">
              <h3>Import</h3>
              <p>Clean intake, mapping, dedup and rollback.</p>
            </article>

            <article className="sg-module">
              <h3>Today</h3>
              <p>Focused daily queue for next actions.</p>
            </article>

            <article className="sg-module">
              <h3>Pipeline</h3>
              <p>Controlled follow-up without noise.</p>
            </article>
          </div>

          <div className="sg-stance">
            <small>Product stance</small>
            Calm business tool. Controlled motion. Manual operator workflow. AI assistance later — never gimmicky.
          </div>
        </section>

        <section className="sg-login-wrap" aria-label={t('auth.signIn')}>
          <div className="sg-card-aura" />

          <div className="sg-login-float">
            <div className="sg-login-shell">
              <div className="sg-card-top-line" />

              <form onSubmit={onSubmit} className="sg-login-inner">
                <div className="sg-login-head">
                  <div>
                    <div className="sg-micro">Private access</div>
                    <h2>{t('auth.signIn')}</h2>
                  </div>

                  <div className="sg-version">v1 core</div>
                </div>

                <p className="sg-login-copy">{t('auth.credentialsHint')}</p>

                <div className="sg-form-fields">
                  <label>
                    <span>{t('auth.email')}</span>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      autoComplete="email"
                    />
                  </label>

                  <label>
                    <span>{t('auth.password')}</span>
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                </div>

                {errorMessage ? <p className="sg-error">{errorMessage}</p> : null}

                <button type="submit" disabled={isSubmitting} className="sg-submit">
                  <span>{isSubmitting ? t('auth.signingIn') : t('auth.signIn')}</span>
                </button>

                <div className="sg-login-footer">
                  <span>No auto-send</span>
                  <span>Manual control only</span>
                </div>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

const signalGateStyles = `
.sg-stage {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
  background: #09090b;
  color: #f4f4f5;
}

.sg-canvas,
.sg-fallback,
.sg-shade,
.sg-grain,
.sg-ambient-lines {
  position: absolute;
  inset: 0;
}

.sg-canvas {
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.sg-fallback {
  z-index: 0;
  opacity: 0;
  transition: opacity 300ms ease;
  background:
    radial-gradient(circle at 72% 34%, rgba(92, 122, 187, 0.2), transparent 30%),
    radial-gradient(circle at 26% 45%, rgba(255, 255, 255, 0.06), transparent 28%),
    linear-gradient(135deg, #07080c, #0b0d12 45%, #09090b);
}

.sg-fallback.is-visible {
  opacity: 1;
}

.sg-shade {
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(7, 8, 12, 0.08), rgba(9, 9, 11, 0.58)),
    radial-gradient(circle at 50% 55%, transparent 0, transparent 36%, rgba(0, 0, 0, 0.22) 78%);
}

.sg-top-line {
  position: absolute;
  z-index: 2;
  inset: 0 0 auto;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.22), transparent);
}

.sg-ambient-lines {
  z-index: 2;
  pointer-events: none;
  opacity: 0.75;
}

.sg-ambient-lines::before {
  content: "";
  position: absolute;
  left: 12%;
  top: 24%;
  width: 390px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(160, 185, 232, 0.36), transparent);
  filter: blur(0.2px);
  animation: sg-drift-line 12s ease-in-out infinite;
}

.sg-ambient-lines::after {
  content: "";
  position: absolute;
  right: 13%;
  top: 30%;
  width: 180px;
  height: 180px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  animation: sg-pulse-ring 12s ease-in-out infinite;
}

.sg-grain {
  z-index: 3;
  pointer-events: none;
  opacity: 0.18;
  mix-blend-mode: soft-light;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.13) 0 1px, transparent 1px),
    radial-gradient(circle at 70% 60%, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px);
  background-size: 3px 3px, 4px 4px;
}

.sg-shell {
  position: relative;
  z-index: 4;
  min-height: 100svh;
  width: min(1500px, 100%);
  margin: 0 auto;
  padding: 48px clamp(28px, 4.5vw, 84px);
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(420px, 470px);
  align-items: center;
  gap: clamp(54px, 7vw, 118px);
}

.sg-copy {
  max-width: 650px;
  animation: sg-fade-rise 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.sg-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.045);
  color: rgba(244, 244, 245, 0.78);
  font-size: 12px;
  line-height: 1;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(18px);
}

.sg-eyebrow span {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #34d399;
  box-shadow: 0 0 22px rgba(52, 211, 153, 0.86);
}

.sg-copy h1 {
  margin: 34px 0 0;
  font-size: clamp(58px, 7vw, 96px);
  line-height: 0.9;
  letter-spacing: -0.065em;
  font-weight: 660;
  text-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
}

.sg-subtitle {
  margin: 28px 0 0;
  max-width: 620px;
  color: rgba(228, 228, 231, 0.86);
  font-size: clamp(18px, 1.65vw, 24px);
  line-height: 1.62;
  letter-spacing: -0.018em;
}

.sg-modules {
  margin-top: 48px;
  max-width: 600px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.sg-module {
  position: relative;
  overflow: hidden;
  min-height: 116px;
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.028));
  padding: 20px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(18px);
  animation: sg-fade-rise 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.sg-module:nth-child(1) {
  animation-delay: 150ms;
}

.sg-module:nth-child(2) {
  animation-delay: 230ms;
}

.sg-module:nth-child(3) {
  animation-delay: 310ms;
}

.sg-module::before {
  content: "";
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.12), transparent 42%);
  transition: opacity 350ms ease;
}

.sg-module:hover::before {
  opacity: 1;
}

.sg-module h3 {
  position: relative;
  margin: 0;
  font-size: 14px;
  color: #fafafa;
  font-weight: 620;
  letter-spacing: -0.01em;
}

.sg-module p {
  position: relative;
  margin: 9px 0 0;
  color: rgba(212, 212, 216, 0.63);
  font-size: 12px;
  line-height: 1.65;
}

.sg-stance {
  margin-top: 26px;
  max-width: 600px;
  border-radius: 30px;
  border: 1px solid rgba(255, 255, 255, 0.085);
  background: rgba(255, 255, 255, 0.032);
  padding: 22px;
  color: rgba(212, 212, 216, 0.78);
  font-size: 14px;
  line-height: 1.75;
  backdrop-filter: blur(18px);
  animation: sg-fade-rise 900ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 390ms;
}

.sg-stance small {
  display: block;
  margin-bottom: 10px;
  color: rgba(161, 161, 170, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 11px;
}

.sg-login-wrap {
  position: relative;
  width: 100%;
  animation: sg-fade-rise 1000ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 120ms;
}

.sg-card-aura {
  position: absolute;
  inset: -34px -32px;
  border-radius: 56px;
  background:
    radial-gradient(circle at 50% 40%, rgba(118, 148, 220, 0.24), transparent 42%),
    radial-gradient(circle at 62% 78%, rgba(255, 255, 255, 0.07), transparent 36%);
  filter: blur(28px);
  opacity: 0.9;
  animation: sg-aura-breathe 9s ease-in-out infinite;
}

.sg-login-float {
  position: relative;
  animation: sg-float-card 9s ease-in-out infinite;
}

.sg-login-shell {
  position: relative;
  overflow: hidden;
  border-radius: 40px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: linear-gradient(180deg, rgba(19, 19, 22, 0.9), rgba(13, 14, 18, 0.85));
  padding: 9px;
  box-shadow:
    0 42px 120px rgba(0, 0, 0, 0.64),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(26px);
}

.sg-login-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 0%, rgba(255, 255, 255, 0.09), transparent 31%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.045), transparent 42%, transparent 62%, rgba(255, 255, 255, 0.025));
  pointer-events: none;
}

.sg-login-shell::after {
  content: "";
  position: absolute;
  left: -35%;
  top: 0;
  width: 30%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
  transform: skewX(-18deg);
  animation: sg-panel-sheen 9s ease-in-out infinite;
  pointer-events: none;
}

.sg-card-top-line {
  position: absolute;
  left: 42px;
  right: 42px;
  top: 0;
  height: 1px;
  z-index: 2;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.38), transparent);
}

.sg-login-inner {
  position: relative;
  border-radius: 32px;
  border: 1px solid rgba(255, 255, 255, 0.085);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.057), rgba(255, 255, 255, 0.022));
  padding: 34px;
}

.sg-login-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.sg-micro {
  color: rgba(113, 113, 122, 0.96);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
}

.sg-login-inner h2 {
  margin: 12px 0 0;
  font-size: 42px;
  line-height: 1;
  letter-spacing: -0.045em;
  font-weight: 650;
}

.sg-version {
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.105);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.052);
  padding: 6px 11px;
  color: rgba(212, 212, 216, 0.62);
  font-size: 12px;
  box-shadow: 0 12px 26px rgba(0, 0, 0, 0.22);
}

.sg-login-copy {
  margin: 22px 0 0;
  max-width: 340px;
  color: rgba(180, 180, 188, 0.82);
  font-size: 15px;
  line-height: 1.75;
}

.sg-form-fields {
  margin-top: 34px;
  display: grid;
  gap: 18px;
}

.sg-form-fields label {
  display: grid;
  gap: 10px;
  color: rgba(228, 228, 231, 0.8);
  font-size: 13px;
}

.sg-form-fields input {
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.105);
  border-radius: 20px;
  outline: none;
  background: rgba(0, 0, 0, 0.29);
  color: #fafafa;
  padding: 15px 16px;
  font-size: 14px;
  transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease;
}

.sg-form-fields input:focus {
  border-color: rgba(244, 244, 245, 0.38);
  background: rgba(0, 0, 0, 0.37);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.035);
}

.sg-error {
  margin: 16px 0 0;
  color: #fca5a5;
  font-size: 13px;
  line-height: 1.5;
}

.sg-submit {
  position: relative;
  overflow: hidden;
  width: 100%;
  margin-top: 26px;
  border: 0;
  border-radius: 21px;
  background: #f4f4f5;
  color: #09090b;
  padding: 16px 18px;
  font-size: 14px;
  font-weight: 660;
  cursor: pointer;
  box-shadow: 0 22px 48px rgba(244, 244, 245, 0.14);
  transition: transform 250ms ease, background 250ms ease, box-shadow 250ms ease, opacity 250ms ease;
}

.sg-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  background: #ffffff;
  box-shadow: 0 26px 58px rgba(244, 244, 245, 0.2);
}

.sg-submit:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.sg-submit::after {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 32%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.85), transparent);
  transform: translateX(-130%);
  animation: sg-shimmer 3s linear infinite;
}

.sg-submit span {
  position: relative;
  z-index: 1;
}

.sg-login-footer {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  color: rgba(113, 113, 122, 0.95);
  font-size: 12px;
}

.sg-loading {
  min-height: 100svh;
  display: grid;
  place-items: center;
  background: #09090b;
  color: #f4f4f5;
}

.sg-loading-card {
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.045);
  padding: 16px 18px;
  color: rgba(244, 244, 245, 0.75);
  font-size: 14px;
  backdrop-filter: blur(16px);
}

@keyframes sg-fade-rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes sg-float-card {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-9px);
  }
}

@keyframes sg-aura-breathe {
  0%,
  100% {
    opacity: 0.65;
    transform: scale(0.98);
  }

  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes sg-pulse-ring {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.96);
  }

  50% {
    opacity: 0.9;
    transform: scale(1.08);
  }
}

@keyframes sg-drift-line {
  0%,
  100% {
    transform: translateX(-34px);
    opacity: 0.22;
  }

  50% {
    transform: translateX(48px);
    opacity: 0.48;
  }
}

@keyframes sg-panel-sheen {
  0%,
  76% {
    transform: translateX(-130%) skewX(-18deg);
    opacity: 0;
  }

  82% {
    opacity: 0.85;
  }

  100% {
    transform: translateX(520%) skewX(-18deg);
    opacity: 0;
  }
}

@keyframes sg-shimmer {
  from {
    transform: translateX(-130%);
  }

  to {
    transform: translateX(340%);
  }
}

@media (max-width: 980px) {
  .sg-stage {
    min-height: 100svh;
    overflow-y: auto;
  }

  .sg-shell {
    min-height: 100svh;
    grid-template-columns: 1fr;
    padding: 28px 20px;
  }

  .sg-copy {
    display: none;
  }

  .sg-login-wrap {
    max-width: 470px;
    margin: 0 auto;
  }

  .sg-login-inner {
    padding: 28px;
  }

  .sg-login-inner h2 {
    font-size: 34px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sg-stage *,
  .sg-stage *::before,
  .sg-stage *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
  }
}
`
